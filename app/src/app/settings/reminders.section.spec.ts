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

  it('chooses the quote source', async () => {
    await create({ enabled: true, calendarId: 'c' });
    vi.spyOn(svc, 'rebuild').mockResolvedValue({ created: 0, removed: 0 });
    Array.from(el.querySelectorAll<HTMLButtonElement>('[data-testid="quote-source"] button')).find((b) => b.textContent!.trim() === 'Built-in quotes')!.click();
    await vi.advanceTimersByTimeAsync(600);
    await vi.waitFor(async () => expect((await stored())['quoteSource']).toBe('builtin'));
  });

  it('adds and removes custom lines, rejecting empty and too long ones', async () => {
    await create({ enabled: true, calendarId: 'c' });
    vi.spyOn(svc, 'rebuild').mockResolvedValue({ created: 0, removed: 0 });
    const input = q<HTMLInputElement>('[data-testid="custom-input"]');
    const add = () => q<HTMLButtonElement>('[data-testid="custom-add"]').click();

    input.value = '   ';
    input.dispatchEvent(new Event('input'));
    add();
    fixture.detectChanges();
    expect(q('[data-testid="custom-error"]').textContent).toContain('Enter a line');

    input.value = 'x'.repeat(121);
    input.dispatchEvent(new Event('input'));
    add();
    fixture.detectChanges();
    expect(q('[data-testid="custom-error"]').textContent).toContain('120');
    expect(el.querySelectorAll('[data-testid="custom-line"]')).toHaveLength(0);

    input.value = 'Read a page';
    input.dispatchEvent(new Event('input'));
    add();
    fixture.detectChanges();
    expect(el.querySelectorAll('[data-testid="custom-line"]')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(600);
    await vi.waitFor(async () => expect((await stored())['customQuotes']).toEqual(['Read a page']));

    q<HTMLButtonElement>('[data-testid="custom-remove"]').click();
    await vi.advanceTimersByTimeAsync(600);
    await vi.waitFor(async () => expect((await stored())['customQuotes']).toEqual([]));
  });

  it('allows at most 20 custom lines', async () => {
    await create({ enabled: true, calendarId: 'c', customQuotes: Array.from({ length: 20 }, (_, i) => `line ${i}`) });
    const input = q<HTMLInputElement>('[data-testid="custom-input"]');
    input.value = 'one more';
    input.dispatchEvent(new Event('input'));
    q<HTMLButtonElement>('[data-testid="custom-add"]').click();
    fixture.detectChanges();
    expect(el.querySelectorAll('[data-testid="custom-line"]')).toHaveLength(20);
    expect(q('[data-testid="custom-error"]').textContent).toContain('20');
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

  it('sends a test reminder', async () => {
    await create({ enabled: true, calendarId: 'c' });
    await TestBed.inject(AuthApi).requestScope('https://www.googleapis.com/auth/calendar.app.created');
    q<HTMLButtonElement>('[data-testid="test-reminder"]').click();
    await settle();
    expect(cal.events.size).toBe(1);
    const ev = [...cal.events.values()][0];
    expect(new Date(ev.startsAt).getTime()).toBe(NOW + 2 * 60_000);
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
      providers: [{ provide: DB, useValue: db }, { provide: AuthApi, useClass: FakeAuthService }, { provide: CALENDAR_API, useValue: new FakeCalendar() }],
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
});
