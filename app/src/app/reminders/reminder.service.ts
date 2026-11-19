import { Injectable, inject, signal } from '@angular/core';
import { FAKE_DRIVE } from '../../environments/environment';
import { AuthApi, AuthCancelledError } from '../auth/auth.service';
import { CLOCK } from '../core/clock';
import { DB } from '../core/db';
import type { ReminderSettings } from '../core/models';
import { SettingsService } from '../core/settings.service';
import { BUILTIN_QUOTES } from './builtin-quotes';
import { CALENDAR_API, CALENDAR_SCOPE, CalendarAuthError, type CalendarApi, type CalendarEvent } from './calendar-api';
import { FakeCalendar } from './fake-calendar';
import { GoogleCalendar } from './google-calendar';
import { pickQuote } from './quotes';
import { REMINDER_DEFAULTS, SLOT_EVENT_ID, eventId, reminderSlots } from './schedule';

const EVENT_MINUTES = 15;

export interface FillResult {
  created: number;
  removed: number;
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
  private readonly calendar: CalendarApi =
    inject(CALENDAR_API, { optional: true }) ?? (FAKE_DRIVE ? new FakeCalendar() : new GoogleCalendar((scope) => this.auth.scopeToken(scope)));

  /** True when Calendar permission has to be granted again (after a reload or a revoke). */
  readonly needsPermission = signal(false);

  /** User gesture: asks for Calendar access, creates the calendar, switches reminders on and fills. */
  async enable(): Promise<'ok' | 'denied' | 'cancelled'> {
    try {
      await this.auth.requestScope(CALENDAR_SCOPE);
    } catch (e) {
      return e instanceof AuthCancelledError ? 'cancelled' : 'denied';
    }
    try {
      const calendarId = await this.calendar.ensureCalendar((await this.current()).calendarId);
      await this.save({ enabled: true, calendarId });
    } catch (e) {
      if (e instanceof CalendarAuthError) return 'denied';
      throw e;
    }
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

  /** Keeps the 14-day window filled. Uses the cached Calendar token only. Safe to repeat. */
  async fill(): Promise<FillResult | 'needs-permission'> {
    const r = await this.current();
    if (!r.enabled) return { created: 0, removed: 0 };
    if (!(await this.token())) {
      this.needsPermission.set(true);
      return 'needs-permission';
    }
    try {
      const calendarId = await this.calendar.ensureCalendar(r.calendarId);
      if (calendarId !== r.calendarId) await this.save({ calendarId });
      const result = await this.sync(calendarId, r, false);
      this.needsPermission.set(false);
      return result;
    } catch (e) {
      return this.failed(e);
    }
  }

  /** After a settings change: removes all future Iqra events, then fills. */
  async rebuild(): Promise<FillResult | 'needs-permission'> {
    const r = await this.current();
    if (!r.enabled) return { created: 0, removed: 0 };
    if (!(await this.token())) {
      this.needsPermission.set(true);
      return 'needs-permission';
    }
    try {
      const calendarId = await this.calendar.ensureCalendar(r.calendarId);
      if (calendarId !== r.calendarId) await this.save({ calendarId });
      const result = await this.sync(calendarId, r, true);
      this.needsPermission.set(false);
      return result;
    } catch (e) {
      return this.failed(e);
    }
  }

  /** User gesture after a reload: asks again for Calendar access and fills. */
  async reconnect(): Promise<'ok' | 'denied' | 'cancelled'> {
    try {
      await this.auth.requestScope(CALENDAR_SCOPE);
    } catch (e) {
      return e instanceof AuthCancelledError ? 'cancelled' : 'denied';
    }
    this.needsPermission.set(false);
    const r = await this.fill();
    return r === 'needs-permission' ? 'denied' : 'ok';
  }

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

  private async removeAll(calendarId: string): Promise<number> {
    const existing = await this.calendar.listFutureEvents(calendarId);
    const ours = existing.filter((e) => SLOT_EVENT_ID.test(e.id));
    for (const e of ours) await this.calendar.remove(calendarId, e.id);
    return ours.length;
  }

  private async sync(calendarId: string, r: ReminderSettings, clearFirst: boolean): Promise<FillResult> {
    let removed = 0;
    if (clearFirst) removed = await this.removeAll(calendarId);
    const now = new Date(this.clock.now());
    const slots = reminderSlots(now, r);
    const wanted = new Set(slots.map(eventId));
    const existing = clearFirst ? [] : await this.calendar.listFutureEvents(calendarId);
    const have = new Set<string>();
    for (const e of existing) {
      if (!SLOT_EVENT_ID.test(e.id)) continue;
      if (wanted.has(e.id)) have.add(e.id);
      else {
        await this.calendar.remove(calendarId, e.id);
        removed++;
      }
    }
    const missing = slots.filter((s) => !have.has(eventId(s)));
    let created = 0;
    if (missing.length) {
      const ctx = await this.context(r);
      for (const slot of missing) {
        if ((await this.calendar.insert(calendarId, this.buildEvent(slot, ctx))) === 'created') created++;
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
