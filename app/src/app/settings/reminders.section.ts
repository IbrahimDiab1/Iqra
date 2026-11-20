import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { CLOCK } from '../core/clock';
import type { ReminderSettings } from '../core/models';
import { SettingsService } from '../core/settings.service';
import { ReminderService } from '../reminders/reminder.service';
import { REMINDER_DEFAULTS, reminderSlots } from '../reminders/schedule';
import { SheetComponent } from '../ui/sheet.component';
import { ToastService } from '../ui/toast.service';
import { describeCalendarError } from '../reminders/calendar-errors';
import { SETTINGS_COPY } from './settings-copy';

const DEBOUNCE_MS = 600;
type Day = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Reading reminders in Google Calendar: days and time. The quote is always a built-in one. */
@Component({
  selector: 'iqra-reminders-section',
  imports: [SheetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="row toggle">
      <span class="grow">
        <span class="lbl">{{ c.master }}</span>
        <span class="sub">{{ c.calendarNote }}</span>
      </span>
      <input type="checkbox" role="switch" data-testid="reminders-switch" [checked]="enabled()" [disabled]="connecting()" (change)="toggle($event)" />
    </label>
    @if (connecting()) {
      <p class="sub status" role="status">{{ c.connecting }}</p>
    }
    @if (message(); as m) {
      <p class="sub err" role="alert" data-testid="reminders-message">{{ m }}</p>
      @if (detail(); as d) {
        <p class="sub detail" data-testid="reminders-detail" dir="ltr">{{ d }}</p>
      }
    }

    @if (service.needsPermission()) {
      <div class="row">
        <p class="grow sub err" role="alert" data-testid="needs-permission">{{ c.needsPermission }}</p>
        <button type="button" class="btn" data-testid="reconnect" [disabled]="connecting()" (click)="reconnect()">{{ c.reconnect }}</button>
      </div>
    }

    @if (enabled()) {
      <span class="cap" id="rem-days">{{ c.days }}</span>
      <div class="days" role="group" aria-labelledby="rem-days">
        @for (d of dayOrder(); track d) {
          <button type="button" class="day" data-testid="reminder-day" [attr.aria-pressed]="view().days.includes(d)" [attr.aria-label]="c.dayLong[d]" (click)="toggleDay(d)">{{ c.dayShort[d] }}</button>
        }
      </div>

      <label class="row time">
        <span class="grow lbl">{{ c.time }}</span>
        <input type="time" class="timebox" data-testid="reminder-time" [value]="view().time" (change)="setTime($event)" />
      </label>

      <div class="row">
        <p class="grow status" data-testid="next-reminder">{{ nextText() }}</p>
      </div>
    }

    <f-sheet [open]="confirming()" [title]="c.confirmTitle" (closed)="confirming.set(false)">
      <div sheet-foot class="foot-row">
        <button type="button" class="btn" data-testid="remove-no" (click)="turnOff(false)">{{ c.no }}</button>
        <span class="spacer"></span>
        <button type="button" class="btn solid" data-testid="remove-yes" (click)="turnOff(true)">{{ c.yes }}</button>
      </div>
    </f-sheet>
  `,
  styles: `
    :host { display: block; }
    .row { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-top: 1px solid var(--line); }
    .row:first-child { border-top: 0; }
    .grow { flex: 1; min-width: 0; }
    .lbl { display: block; font-size: 15px; }
    .sub { display: block; font-size: 13px; color: var(--muted); margin: 0; }
    .status { margin: 0; font-size: 14px; }
    .err { color: var(--danger); }
    .toggle { cursor: pointer; }
    .toggle input { width: 40px; height: 24px; flex: none; accent-color: var(--accent); }
    .cap { display: block; margin: 14px 0 6px; font-size: 12px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
    .days { display: flex; gap: 4px; }
    .day { flex: 1; min-width: 40px; min-height: 40px; border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--surface); color: var(--muted); font: 600 13px var(--ui); cursor: pointer; }
    .day[aria-pressed='true'] { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
    .timebox, .textbox { min-height: 40px; padding: 0 10px; border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--surface); color: var(--fg); font: 15px var(--ui); }
    .seg { display: flex; background: var(--surface-2); border-radius: var(--radius-control); padding: 3px; gap: 2px; }
    .seg button { flex: 1; min-height: 40px; border: 0; background: none; border-radius: 9px; font: 500 13px var(--ui); color: var(--muted); cursor: pointer; }
    .seg button[aria-pressed='true'] { background: var(--surface); color: var(--fg); box-shadow: 0 1px 3px rgba(0, 0, 0, .12); }
    .btn { min-height: 40px; min-width: 40px; padding: 0 14px; border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--surface); color: var(--fg); font: 600 14px var(--ui); cursor: pointer; }
    .btn:disabled { opacity: .55; cursor: default; }
    .btn.solid { background: var(--danger); border-color: var(--danger); color: var(--accent-fg); }
    button:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .foot-row { display: flex; align-items: center; gap: 8px; width: 100%; }
    .spacer { flex: 1; }
  `,
})
export class RemindersSection implements OnDestroy {
  protected readonly service = inject(ReminderService);
  private readonly settings = inject(SettingsService);
  private readonly clock = inject(CLOCK);
  private readonly toast = inject(ToastService);

  protected readonly c = SETTINGS_COPY.reminders;
  protected readonly connecting = signal(false);
  protected readonly confirming = signal(false);
  protected readonly message = signal<string | null>(null);
  /** Google's status and reason for the message above, e.g. `403 accessNotConfigured`. */
  protected readonly detail = signal<string | null>(null);

  /** Edits made in the last 600 ms, shown at once and saved together. */
  private readonly pending = signal<Partial<ReminderSettings>>({});
  private timer: ReturnType<typeof setTimeout> | undefined;

  private readonly merged = computed(() => ({ ...(this.settings.settings().reminders ?? {}), ...this.pending() }));
  protected readonly enabled = computed(() => this.merged().enabled === true);
  protected readonly view = computed(() => {
    const r = this.merged();
    return {
      days: r.days ?? REMINDER_DEFAULTS.days,
      time: r.time ?? REMINDER_DEFAULTS.time,
    };
  });

  protected readonly dayOrder = computed(() => {
    const start = this.settings.settings().weekStartsOn;
    return Array.from({ length: 7 }, (_, i) => ((start + i) % 7) as Day);
  });

  protected readonly nextText = computed(() => {
    const slot = reminderSlots(new Date(this.clock.now()), { ...this.merged(), ...this.view() })[0];
    if (!slot) return this.c.none;
    const day = new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(slot);
    const two = (n: number) => String(n).padStart(2, '0');
    return this.c.next(`${day} ${two(slot.getHours())}:${two(slot.getMinutes())}`);
  });

  ngOnDestroy(): void {
    clearTimeout(this.timer);
  }

  protected async toggle(event: Event): Promise<void> {
    const box = event.target as HTMLInputElement;
    this.clearMessage();
    if (!box.checked) {
      box.checked = true; // stays on until the owner answers the question
      this.confirming.set(true);
      return;
    }
    this.connecting.set(true);
    try {
      const result = await this.service.enable();
      if (result === 'denied') this.message.set(this.c.denied);
      if (result !== 'ok') box.checked = false;
    } catch (e) {
      this.report(e);
      box.checked = false;
    } finally {
      this.connecting.set(false);
    }
  }

  protected async turnOff(removeEvents: boolean): Promise<void> {
    this.confirming.set(false);
    await this.flush();
    await this.service.disable({ removeEvents });
  }

  protected toggleDay(day: Day): void {
    const days = this.view().days;
    const next = days.includes(day) ? days.filter((d) => d !== day) : [...days, day];
    this.change({ days: next.sort((a, b) => a - b) });
  }

  protected setTime(event: Event): void {
    const time = (event.target as HTMLInputElement).value;
    if (time) this.change({ time });
  }

  protected async reconnect(): Promise<void> {
    this.clearMessage();
    this.connecting.set(true);
    try {
      if ((await this.service.reconnect()) === 'denied') this.message.set(this.c.denied);
    } catch (e) {
      this.report(e);
    } finally {
      this.connecting.set(false);
    }
  }

  /** Shows the edit now; saves and rebuilds the calendar once edits have paused for 600 ms. */
  private change(patch: Partial<ReminderSettings>): void {
    this.pending.update((p) => ({ ...p, ...patch }));
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush().then(() => this.rebuild()), DEBOUNCE_MS);
  }

  private async flush(): Promise<void> {
    clearTimeout(this.timer);
    const patch = this.pending();
    if (!Object.keys(patch).length) return;
    await this.service.save(patch);
    this.pending.update((p) => Object.fromEntries(Object.entries(p).filter(([k]) => !(k in patch) || (p as Record<string, unknown>)[k] !== (patch as Record<string, unknown>)[k])));
  }

  private async rebuild(): Promise<void> {
    if (Object.keys(this.pending()).length) return; // a newer edit has its own timer
    try {
      await this.service.rebuild();
    } catch (e) {
      this.report(e);
    }
  }

  private clearMessage(): void {
    this.message.set(null);
    this.detail.set(null);
  }

  /** Shows what went wrong with Google Calendar, with Google's status and reason, and logs it. */
  private report(e: unknown): void {
    const problem = describeCalendarError(e);
    console.warn('Google Calendar request failed', problem.status, problem.reason, e);
    this.message.set(problem.message);
    this.detail.set([problem.status, problem.reason].filter(Boolean).join(' ') || null);
  }
}
