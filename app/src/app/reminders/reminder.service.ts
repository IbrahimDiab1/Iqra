import { Injectable, inject, signal } from '@angular/core';
import { FAKE_DRIVE } from '../../environments/environment';
import { AuthApi, AuthCancelledError } from '../auth/auth.service';
import { ScopeDeniedError } from '../auth/scope-grant';
import { CLOCK } from '../core/clock';
import { DB } from '../core/db';
import type { ReminderSettings } from '../core/models';
import { SettingsService } from '../core/settings.service';
import { SyncEngine } from '../sync/sync-engine';
import { BUILTIN_QUOTES } from './builtin-quotes';
import { CALENDAR_API, CALENDAR_SCOPE, CalendarAuthError, type CalendarApi, type CalendarEvent } from './calendar-api';
import { exposeE2eHandles } from '../e2e-hooks';
import { FakeCalendar } from './fake-calendar';
import { GoogleCalendar } from './google-calendar';
import { pickQuote } from './quotes';
import { REMINDER_DEFAULTS, SLOT_EVENT_ID, eventId, reminderSlots } from './schedule';

const EVENT_MINUTES = 15;
/** Slot events and test events: everything Iqra puts in the calendar. */
const OUR_EVENT_ID = /^iqra(test)?\d+$/;

export interface FillResult {
  created: number;
  removed: number;
}

/** e2e builds only: lets tests read the in-memory calendar. */
function exposeFakeCalendar(calendar: FakeCalendar): FakeCalendar {
  exposeE2eHandles({ __iqraCalendar: calendar });
  return calendar;
}

/** Local time as ISO 8601 with the UTC offset, e.g. 2026-11-21T21:30:00+03:00. */
function isoWithOffset(d: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return (
    `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}` +
    `${sign}${two(Math.floor(abs / 60))}:${two(abs % 60)}`
  );
}

/** Whole local days since 1970: the quote seed for a slot. */
function dayNumber(d: Date): number {
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
}

/** Keeps the owner's Iqra calendar filled with reading reminders. Lazy: import it only when needed. */
@Injectable({ providedIn: 'root' })
export class ReminderService {
  private readonly db = inject(DB);
  private readonly auth = inject(AuthApi);
  private readonly clock = inject(CLOCK);
  private readonly settings = inject(SettingsService);
  private readonly sync = inject(SyncEngine);
  private readonly calendar: CalendarApi =
    inject(CALENDAR_API, { optional: true }) ?? (FAKE_DRIVE ? exposeFakeCalendar(new FakeCalendar()) : new GoogleCalendar((scope) => this.auth.scopeToken(scope)));

  /** True when Calendar permission has to be granted again (after a reload or a revoke). */
  readonly needsPermission = signal(false);

  /**
   * User gesture: asks for Calendar access, picks up a calendar another device may have created,
   * switches reminders on and fills. Reconnecting after a revoke is the same call.
   *
   * The calendar id is stored in the synced Settings. A second device must let Settings sync before
   * enabling, or it creates a second "Iqra" calendar (Iqra cannot search the owner's calendars with
   * the app-created scope). So a sync pass runs first.
   */
  async enable(): Promise<'ok' | 'denied' | 'cancelled'> {
    try {
      await this.auth.requestScope(CALENDAR_SCOPE);
    } catch (e) {
      if (e instanceof AuthCancelledError) return 'cancelled';
      if (e instanceof ScopeDeniedError) return 'denied';
      throw e;
    }
    try {
      await this.sync.syncNow();
    } catch {
      // Offline or Drive trouble: carry on with what this device knows.
    }
    // Calendar errors are not swallowed here: the screen names them (API off, scope not granted, network, status and reason).
    const calendarId = await this.calendar.ensureCalendar((await this.current()).calendarId);
    await this.save({ enabled: true, calendarId });
    this.needsPermission.set(false);
    await this.fill();
    return 'ok';
  }

  /** Switches reminders off, optionally removing the upcoming Iqra events from the calendar. */
  async disable(opts: { removeEvents: boolean } = { removeEvents: false }): Promise<void> {
    const r = await this.current();
    await this.save({ enabled: false });
    this.needsPermission.set(false);
    if (opts.removeEvents && r.calendarId && (await this.token())) {
      try {
        await this.removeAll(r.calendarId);
      } catch {
        // The events stay in the calendar; reminders are off either way.
      }
    }
  }

  /** Keeps the 14-day window filled and matching the settings. Uses the cached Calendar token only. Safe to repeat. */
  fill(): Promise<FillResult | 'needs-permission'> {
    return this.serialize();
  }

  /** After a settings change: brings the calendar in line with the settings (same diff as fill). */
  rebuild(): Promise<FillResult | 'needs-permission'> {
    return this.serialize();
  }

  /** Same as enable(): asks again for Calendar access. */
  reconnect(): Promise<'ok' | 'denied' | 'cancelled'> {
    return this.enable();
  }

  private running: Promise<FillResult | 'needs-permission'> | null = null;
  private followUp: Promise<FillResult | 'needs-permission'> | null = null;

  /** One run at a time. A request made during a run queues exactly one follow-up that all such callers share. */
  private serialize(): Promise<FillResult | 'needs-permission'> {
    if (!this.running) {
      const run = this.run().finally(() => {
        if (this.running === run) this.running = null;
      });
      this.running = run;
      return run;
    }
    this.followUp ??= this.running
      .catch(() => undefined)
      .then(() => {
        this.followUp = null;
        return this.serialize();
      });
    return this.followUp;
  }

  private async run(): Promise<FillResult | 'needs-permission'> {
    const r = await this.current();
    if (!r.enabled) return { created: 0, removed: 0 };
    if (!(await this.token())) {
      this.needsPermission.set(true);
      return 'needs-permission';
    }
    try {
      const calendarId = await this.calendar.ensureCalendar(r.calendarId);
      if (calendarId !== r.calendarId) await this.save({ calendarId });
      const result = await this.reconcile(calendarId, r);
      this.needsPermission.set(false);
      return result;
    } catch (e) {
      return this.failed(e);
    }
  }

  /** Refused permission turns reminders off and leaves needsPermission set, so the screen can explain and offer Reconnect. */
  private async failed(e: unknown): Promise<'needs-permission'> {
    if (!(e instanceof CalendarAuthError)) throw e;
    await this.save({ enabled: false });
    this.needsPermission.set(true);
    return 'needs-permission';
  }

  /** The cached token, or one obtained without a popup; null when a gesture is needed. */
  private async token(): Promise<string | null> {
    const cached = this.auth.scopeToken(CALENDAR_SCOPE);
    if (cached) return cached;
    try {
      return await this.auth.requestScope(CALENDAR_SCOPE, { silent: true });
    } catch {
      return null;
    }
  }

  private async current(): Promise<ReminderSettings> {
    return ((await this.db.settings.get('settings'))?.reminders as ReminderSettings | null) ?? {};
  }

  /** Saves the given reminder fields over the current ones. */
  async save(patch: Partial<ReminderSettings>): Promise<void> {
    await this.settings.update({ reminders: { ...(await this.current()), ...patch } });
  }

  /** Removes the upcoming Iqra events (slot and test ones). Cancelled ones are already gone. */
  private async removeAll(calendarId: string): Promise<number> {
    const ours = (await this.calendar.listFutureEvents(calendarId)).filter((e) => e.status === 'confirmed' && OUR_EVENT_ID.test(e.id));
    for (const e of ours) await this.calendar.remove(calendarId, e.id);
    return ours.length;
  }

  /**
   * Makes the calendar match the slots by diffing on the deterministic event ids. Google keeps a
   * deleted event's id reserved, so an id is never deleted and inserted again: a wanted id that is
   * cancelled is restored by update, a live one is updated only when its content changed, and only
   * ids missing altogether are inserted.
   */
  private async reconcile(calendarId: string, r: ReminderSettings): Promise<FillResult> {
    const slots = reminderSlots(new Date(this.clock.now()), r);
    const wanted = new Map(slots.map((s) => [eventId(s), s]));
    const existing = new Map((await this.calendar.listFutureEvents(calendarId)).filter((e) => SLOT_EVENT_ID.test(e.id)).map((e) => [e.id, e]));
    let created = 0;
    let removed = 0;
    for (const e of existing.values()) {
      if (e.status === 'confirmed' && !wanted.has(e.id)) {
        await this.calendar.remove(calendarId, e.id);
        removed++;
      }
    }
    if (!wanted.size) return { created, removed };
    const ctx = await this.context(r);
    for (const [id, slot] of wanted) {
      const event = this.buildEvent(slot, ctx);
      const have = existing.get(id);
      if (!have) {
        if ((await this.calendar.insert(calendarId, event)) === 'created') created++;
      } else if (have.status === 'cancelled') {
        await this.calendar.update(calendarId, event);
        created++;
      } else if (have.title !== event.title || have.description !== event.description || new Date(have.start).getTime() !== new Date(event.startsAt).getTime()) {
        await this.calendar.update(calendarId, event);
      }
    }
    return { created, removed };
  }

  /** Adds one event two minutes from now so the owner can see the popup. */
  async sendTest(): Promise<'ok' | 'needs-permission'> {
    const r = await this.current();
    if (!(await this.token())) {
      this.needsPermission.set(true);
      return 'needs-permission';
    }
    try {
      const calendarId = await this.calendar.ensureCalendar(r.calendarId);
      if (calendarId !== r.calendarId) await this.save({ calendarId });
      const start = new Date(this.clock.now() + 2 * 60_000);
      const event = this.buildEvent(start, await this.context(r));
      await this.calendar.insert(calendarId, { ...event, id: `iqratest${start.getTime()}` });
      return 'ok';
    } catch (e) {
      await this.failed(e);
      return 'needs-permission';
    }
  }

  private async context(r: ReminderSettings) {
    const books = (await this.db.books.toArray()).filter((b) => !b.deleted);
    const reading = books.filter((b) => b.status === 'reading').sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))[0];
    const source = r.quoteSource ?? REMINDER_DEFAULTS.quoteSource;
    let highlights: { quote: string; bookTitle: string; page: number }[] = [];
    if (source !== 'builtin') {
      const titles = new Map(books.map((b) => [b.id, b.title]));
      highlights = (await this.db.annotations.toArray())
        .filter((a) => !a.deleted && a.type === 'highlight' && a.text?.quote && titles.has(a.bookId))
        .map((a) => ({ quote: a.text!.quote, bookTitle: titles.get(a.bookId)!, page: a.page ?? a.text!.page }));
    }
    return { reading, source, highlights, custom: r.customQuotes ?? [] };
  }

  private buildEvent(slot: Date, ctx: Awaited<ReturnType<ReminderService['context']>>): CalendarEvent {
    const quote = pickQuote({ source: ctx.source, custom: ctx.custom, highlights: ctx.highlights, builtin: BUILTIN_QUOTES, seed: dayNumber(slot) });
    const link = `${location.origin}/read/${ctx.reading?.id ?? ''}`;
    const lines = [quote.text];
    if (quote.source) lines.push(`— ${quote.source}`);
    if (ctx.reading) lines.push('', link);
    return {
      id: eventId(slot),
      startsAt: isoWithOffset(slot),
      endsAt: isoWithOffset(new Date(slot.getTime() + EVENT_MINUTES * 60_000)),
      title: ctx.reading ? `Time to read · ${ctx.reading.title}` : 'Time to read',
      description: lines.join('\n'),
    };
  }
}
