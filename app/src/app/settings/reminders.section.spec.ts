import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthApi } from '../auth/auth.service';
import { FakeAuthService } from '../auth/fake-auth.service';
import { CLOCK } from '../core/clock';
import { DB, IqraDb } from '../core/db';
import { newId } from '../core/ids';
import { SettingsService } from '../core/settings.service';
import { CALENDAR_API } from '../reminders/calendar-api';
import { FakeCalendar } from '../reminders/fake-calendar';
import { fillRemindersOnOpen } from '../reminders/open-fill';
import { ReminderService } from '../reminders/reminder.service';
import { SyncEngine } from '../sync/sync-engine';
import { reminderSlots } from '../reminders/schedule';
import { RemindersSection } from './reminders.section';

const NOW = new Date(2026, 10, 18, 22, 0).getTime();

describe('RemindersSection', () => {
  let db: IqraDb;
  let fixture: ComponentFixture<RemindersSection>;
  let el: HTMLElement;
  let svc: ReminderService;
  let settings: SettingsService;
  let cal: FakeCalendar;

  const q = <T extends HTMLElement>(sel: string) => el.querySelector<T>(sel)!;
  const text = () => el.textContent!.replace(/\s+/g, ' ');
  const stored = async () => (await db.settings.get('settings'))?.reminders as Record<string, unknown>;
  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function create(reminders: Record<string, unknown> = {}): Promise<void> {
    await settings.update({ reminders });
    fixture = TestBed.createComponent(RemindersSection);
    el = fixture.nativeElement as HTMLElement;
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(q('[data-testid="reminders-switch"]')).not.toBeNull();
      if (reminders['enabled']) expect(q('[data-testid="reminder-time"]')).not.toBeNull();
    });
  }

  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    db = new IqraDb(`iqra-test-${newId()}`);
    cal = new FakeCalendar();
    TestBed.configureTestingModule({
      providers: [
        { provide: DB, useValue: db },
        { provide: CLOCK, useValue: { now: () => NOW } },
        { provide: AuthApi, useClass: FakeAuthService },
        { provide: CALENDAR_API, useValue: cal },
        { provide: SyncEngine, useValue: { syncNow: async () => undefined } },
      ],
    });
    svc = TestBed.inject(ReminderService);
    settings = TestBed.inject(SettingsService);
  });

  afterEach(async () => {
    vi.useRealTimers();
    fixture?.destroy();
    TestBed.resetTestingModule();
    await db.delete();
  });

  it('turning the switch on calls enable once and shows the connecting state', async () => {
    await create();
    let release!: (v: 'ok') => void;
    const enable = vi.spyOn(svc, 'enable').mockReturnValue(new Promise((r) => (release = r)));
    q<HTMLInputElement>('[data-testid="reminders-switch"]').click();
    fixture.detectChanges();
    expect(enable).toHaveBeenCalledTimes(1);
    expect(text()).toContain('Connecting to Google Calendar…');
    release('ok');
    await settle();
    expect(text()).not.toContain('Connecting to Google Calendar…');
  });

  it('shows the denied message and stays off', async () => {
    await create();
    vi.spyOn(svc, 'enable').mockResolvedValue('denied');
    q<HTMLInputElement>('[data-testid="reminders-switch"]').click();
    await settle();
    expect(text()).toContain("Google didn't allow calendar access. Reminders stay off.");
    expect(q<HTMLInputElement>('[data-testid="reminders-switch"]').checked).toBe(false);
  });

  it('stays quiet and off when the popup is cancelled', async () => {
    await create();
    vi.spyOn(svc, 'enable').mockResolvedValue('cancelled');
    q<HTMLInputElement>('[data-testid="reminders-switch"]').click();
    await settle();
    expect(q('[data-testid="reminders-message"]')).toBeNull();
    expect(q<HTMLInputElement>('[data-testid="reminders-switch"]').checked).toBe(false);
  });

  it('lists the days in the week order of the settings, 40px targets', async () => {
    await create({ enabled: true, calendarId: 'c' });
    const labels = () => Array.from(el.querySelectorAll('[data-testid="reminder-day"]')).map((b) => b.textContent!.trim());
    expect(labels()).toEqual(['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
    await settings.update({ weekStartsOn: 1 });
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(labels()[0]).toBe('Mon');
    });
  });

  it('day toggles update days, debounced, then rebuild once', async () => {
    await create({ enabled: true, calendarId: 'c', days: [6, 0] });
    const rebuild = vi.spyOn(svc, 'rebuild').mockResolvedValue({ created: 0, removed: 0 });
    const day = (label: string) => Array.from(el.querySelectorAll<HTMLButtonElement>('[data-testid="reminder-day"]')).find((b) => b.textContent!.trim() === label)!;
    day('Mon').click();
    day('Sun').click();
    fixture.detectChanges();
    expect(day('Mon').getAttribute('aria-pressed')).toBe('true');
    expect(day('Sun').getAttribute('aria-pressed')).toBe('false');
    await vi.advanceTimersByTimeAsync(600);
    await vi.waitFor(async () => expect((await stored())['days']).toEqual([1, 6]));
    await vi.waitFor(() => expect(rebuild).toHaveBeenCalledTimes(1));
  });

  it('changing the time triggers one debounced rebuild', async () => {
    await create({ enabled: true, calendarId: 'c' });
    const rebuild = vi.spyOn(svc, 'rebuild').mockResolvedValue({ created: 0, removed: 0 });
    const input = q<HTMLInputElement>('[data-testid="reminder-time"]');
    for (const v of ['20:00', '20:15', '20:30']) {
      input.value = v;
      input.dispatchEvent(new Event('change'));
    }
    await vi.advanceTimersByTimeAsync(599);
    expect(rebuild).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    await vi.waitFor(async () => expect((await stored())['time']).toBe('20:30'));
    await vi.waitFor(() => expect(rebuild).toHaveBeenCalledTimes(1));
  });

  it('turning off asks first; No keeps the events, Yes removes them', async () => {
    await create({ enabled: true, calendarId: 'c' });
    const disable = vi.spyOn(svc, 'disable').mockResolvedValue();
    q<HTMLInputElement>('[data-testid="reminders-switch"]').click();
    fixture.detectChanges();
    expect(text()).toContain('Remove upcoming reminders from the calendar?');
    q<HTMLButtonElement>('[data-testid="remove-no"]').click();
    await settle();
    expect(disable).toHaveBeenCalledWith({ removeEvents: false });

    await settings.update({ reminders: { enabled: true, calendarId: 'c' } });
    await settle();
    q<HTMLInputElement>('[data-testid="reminders-switch"]').click();
    fixture.detectChanges();
    q<HTMLButtonElement>('[data-testid="remove-yes"]').click();
    await settle();
    expect(disable).toHaveBeenLastCalledWith({ removeEvents: true });
  });

  it('shows the next reminder from the schedule', async () => {
    const r = { enabled: true, calendarId: 'c', days: [6, 0, 1, 2, 3, 4] as (0 | 1 | 2 | 3 | 4 | 5 | 6)[], time: '21:30' };
    await create(r);
    const slot = reminderSlots(new Date(NOW), r)[0];
    const day = new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(slot);
    expect(q('[data-testid="next-reminder"]').textContent!.trim()).toBe(`Next: ${day} 21:30`);
  });

  it('shows the Reconnect Calendar state and reconnects', async () => {
    await create({ enabled: true, calendarId: 'c' });
    svc.needsPermission.set(true);
    fixture.detectChanges();
    const reconnect = vi.spyOn(svc, 'reconnect').mockResolvedValue('ok');
    q<HTMLButtonElement>('[data-testid="reconnect"]').click();
    expect(reconnect).toHaveBeenCalledTimes(1);
  });

  it('explains a revoked permission and offers Reconnect even though reminders are off', async () => {
    await create({ enabled: true, calendarId: 'c' });
    await TestBed.inject(AuthApi).requestScope('https://www.googleapis.com/auth/calendar.app.created');
    const { CalendarAuthError } = await import('../reminders/calendar-api');
    cal.failWith = new CalendarAuthError('revoked');
    expect(await svc.fill()).toBe('needs-permission');
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(q('[data-testid="needs-permission"]')).not.toBeNull();
      expect(q<HTMLInputElement>('[data-testid="reminders-switch"]').checked).toBe(false);
    });
    expect(q('[data-testid="reconnect"]')).not.toBeNull();
    cal.failWith = null;
    q<HTMLButtonElement>('[data-testid="reconnect"]').click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(q('[data-testid="needs-permission"]')).toBeNull();
      expect(q<HTMLInputElement>('[data-testid="reminders-switch"]').checked).toBe(true);
    });
  });

  describe('Calendar errors', () => {
    const msg = () => q('[data-testid="reminders-message"]');
    const detail = () => el.querySelector('[data-testid="reminders-detail"]');
    const turnOn = async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      await create();
      q<HTMLInputElement>('[data-testid="reminders-switch"]').click();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(msg()).not.toBeNull();
      });
    };

    it('the Calendar API being off says so, with the reason and a log line', async () => {
      const { CalendarTransientError } = await import('../reminders/calendar-api');
      cal.failWith = new CalendarTransientError('x', 403, 'accessNotConfigured');
      await turnOn();
      expect(msg().textContent).toContain("Google Calendar API isn't enabled for this project");
      expect(msg().textContent).toContain('Google Calendar API');
      expect(detail()!.textContent).toContain('403 accessNotConfigured');
      expect(console.warn).toHaveBeenCalled();
      expect(q<HTMLInputElement>('[data-testid="reminders-switch"]').checked).toBe(false);
    });

    it('insufficient permissions says the scope was not granted', async () => {
      const { CalendarAuthError } = await import('../reminders/calendar-api');
      cal.failWith = new CalendarAuthError('x', 403, 'insufficientPermissions');
      await turnOn();
      expect(msg().textContent).toContain("Google didn't grant calendar access. Check the consent screen scopes.");
      expect(detail()!.textContent).toContain('insufficientPermissions');
    });

    it('a network fault says Google could not be reached', async () => {
      cal.failWith = new TypeError('Failed to fetch');
      await turnOn();
      expect(msg().textContent).toContain("Couldn't reach Google. Check your connection and try again.");
    });

    it('anything else shows the status and reason, not the network text', async () => {
      const { CalendarTransientError } = await import('../reminders/calendar-api');
      cal.failWith = new CalendarTransientError('x', 500, 'backendError');
      await turnOn();
      expect(msg().textContent).toContain('Google Calendar returned an error (500 backendError).');
      expect(msg().textContent).not.toContain("Couldn't reach");
    });

    it('a later successful try clears the message and the detail', async () => {
      const { CalendarTransientError } = await import('../reminders/calendar-api');
      cal.failWith = new CalendarTransientError('x', 403, 'accessNotConfigured');
      await turnOn();
      cal.failWith = null;
      q<HTMLInputElement>('[data-testid="reminders-switch"]').click();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(msg()).toBeNull();
        expect(detail()).toBeNull();
      });
    });
  });

  it('has no quote source, own lines or test reminder controls', async () => {
    await create({ enabled: true, calendarId: 'c' });
    expect(el.querySelector('[data-testid="quote-source"]')).toBeNull();
    expect(el.querySelector('[data-testid="custom-input"]')).toBeNull();
    expect(el.querySelector('[data-testid="test-reminder"]')).toBeNull();
  });

  it('mentions the Iqra calendar', async () => {
    await create();
    expect(text()).toContain('Reminders appear in your "Iqra" calendar');
  });
});

describe('fillRemindersOnOpen', () => {
  let db: IqraDb;

  beforeEach(() => {
    db = new IqraDb(`iqra-test-${newId()}`);
    TestBed.configureTestingModule({
      providers: [
        { provide: DB, useValue: db },
        { provide: AuthApi, useClass: FakeAuthService },
        { provide: CALENDAR_API, useValue: new FakeCalendar() },
        { provide: SyncEngine, useValue: { syncNow: async () => undefined } },
      ],
    });
  });

  afterEach(async () => {
    TestBed.resetTestingModule();
    await db.delete();
  });

  it('does not fill when reminders are disabled', async () => {
    const fill = vi.spyOn(ReminderService.prototype, 'fill').mockResolvedValue({ created: 0, removed: 0 });
    await TestBed.runInInjectionContext(() => fillRemindersOnOpen());
    expect(fill).not.toHaveBeenCalled();
    fill.mockRestore();
  });

  it('fills once when reminders are enabled', async () => {
    await TestBed.inject(SettingsService).update({ reminders: { enabled: true, calendarId: 'c' } });
    const fill = vi.spyOn(ReminderService.prototype, 'fill').mockResolvedValue({ created: 0, removed: 0 });
    await TestBed.runInInjectionContext(() => fillRemindersOnOpen());
    expect(fill).toHaveBeenCalledTimes(1);
    fill.mockRestore();
  });

  it('fills on app start when only phone reminders are on', async () => {
    await TestBed.inject(SettingsService).update({ reminders: { phone: true } });
    const fill = vi.spyOn(ReminderService.prototype, 'fill').mockResolvedValue({ created: 0, removed: 0 });
    await TestBed.runInInjectionContext(() => fillRemindersOnOpen());
    expect(fill).toHaveBeenCalledTimes(1);
    fill.mockRestore();
  });
});

describe('RemindersSection phone option', () => {
  const g = globalThis as { Capacitor?: unknown };
  let db: IqraDb;

  beforeEach(() => {
    localStorage.clear();
    db = new IqraDb(`iqra-test-${newId()}`);
    TestBed.configureTestingModule({
      providers: [
        { provide: DB, useValue: db },
        { provide: CLOCK, useValue: { now: () => NOW } },
        { provide: AuthApi, useClass: FakeAuthService },
        { provide: CALENDAR_API, useValue: new FakeCalendar() },
        { provide: SyncEngine, useValue: { syncNow: async () => undefined } },
      ],
    });
  });

  afterEach(async () => {
    delete g.Capacitor;
    TestBed.resetTestingModule();
    await db.delete();
  });

  it('is hidden on the web', async () => {
    const fixture = TestBed.createComponent(RemindersSection);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="phone-switch"]')).toBeNull();
    fixture.destroy();
  });

  it('shows next to Google Calendar in the Android app', async () => {
    g.Capacitor = { isNativePlatform: () => true };
    const fixture = TestBed.createComponent(RemindersSection);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="phone-switch"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="reminders-switch"]')).not.toBeNull();
    expect(el.textContent).toContain('Google Calendar');
    expect(el.textContent).toContain('Phone notifications');
    fixture.destroy();
  });
});
