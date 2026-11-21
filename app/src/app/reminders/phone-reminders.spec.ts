import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthApi } from '../auth/auth.service';
import { FakeAuthService } from '../auth/fake-auth.service';
import { CLOCK } from '../core/clock';
import { DB, IqraDb } from '../core/db';
import { newId } from '../core/ids';
import { SettingsService } from '../core/settings.service';
import { SyncEngine } from '../sync/sync-engine';
import { CALENDAR_API } from './calendar-api';
import { FakeCalendar } from './fake-calendar';
import { NOTIFIER, buildPhoneNotifications, type Notifier, type PhoneNotification } from './phone-notifications';
import { ReminderService } from './reminder.service';
import { reminderSlots } from './schedule';

const NOW = new Date(2026, 10, 18, 22, 0).getTime();
const DAYS = [6, 0, 1, 2, 3, 4] as (0 | 1 | 2 | 3 | 4 | 5 | 6)[];
const g = globalThis as { Capacitor?: unknown };

describe('buildPhoneNotifications', () => {
  it('numbers the slots 1..n in time order', () => {
    const a = new Date(2026, 10, 19, 21, 30);
    const b = new Date(2026, 10, 20, 21, 30);
    const out = buildPhoneNotifications([b, a], (s) => ({ title: 't', body: String(s.getDate()) }));
    expect(out.map((n) => [n.id, n.body])).toEqual([
      [1, '19'],
      [2, '20'],
    ]);
  });
});

describe('phone reminders in ReminderService', () => {
  let db: IqraDb;
  let svc: ReminderService;
  let scheduled: PhoneNotification[];
  let notifier: Notifier & { allowed: boolean; cancelAll: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    localStorage.clear();
    scheduled = [];
    notifier = {
      allowed: true,
      permission: async (ask) => notifier.allowed || (ask && (notifier.allowed = true)),
      replaceAll: async (items) => {
        scheduled = items;
      },
      cancelAll: vi.fn(async () => {
        scheduled = [];
      }),
    };
    db = new IqraDb(`iqra-test-${newId()}`);
    TestBed.configureTestingModule({
      providers: [
        { provide: DB, useValue: db },
        { provide: CLOCK, useValue: { now: () => NOW } },
        { provide: AuthApi, useClass: FakeAuthService },
        { provide: CALENDAR_API, useValue: new FakeCalendar() },
        { provide: SyncEngine, useValue: { syncNow: async () => undefined } },
        { provide: NOTIFIER, useValue: notifier },
      ],
    });
    await TestBed.inject(AuthApi).signIn();
    await TestBed.inject(SettingsService).update({ reminders: { days: DAYS, time: '21:30' } });
    svc = TestBed.inject(ReminderService);
  });

  afterEach(async () => {
    delete g.Capacitor;
    TestBed.resetTestingModule();
    await db.delete();
  });

  const native = () => (g.Capacitor = { isNativePlatform: () => true });
  const expected = () => reminderSlots(new Date(NOW), { days: DAYS, time: '21:30' }).length;

  it('is unavailable on the web: enabling does nothing and nothing is scheduled', async () => {
    expect(svc.phoneAvailable).toBe(false);
    expect(await svc.enablePhone()).toBe('unavailable');
    expect(scheduled).toEqual([]);
  });

  it('enabling on the phone asks permission, saves the choice and schedules the window', async () => {
    native();
    notifier.allowed = false;
    expect(await svc.enablePhone()).toBe('ok');
    const stored = (await db.settings.get('settings'))?.reminders;
    expect(stored?.phone).toBe(true);
    expect(scheduled).toHaveLength(expected());
    expect(scheduled[0].title).toContain('Time to read');
    expect(scheduled[0].at.getTime()).toBeGreaterThan(NOW);
  });

  it('a refused permission leaves it off', async () => {
    native();
    notifier.allowed = false;
    notifier.permission = async () => false;
    expect(await svc.enablePhone()).toBe('denied');
    expect((await db.settings.get('settings'))?.reminders?.phone).toBeFalsy();
    expect(scheduled).toEqual([]);
  });

  it('reschedules on rebuild after a change of days', async () => {
    native();
    await svc.enablePhone();
    await TestBed.inject(SettingsService).update({ reminders: { ...(await db.settings.get('settings'))!.reminders, days: [0] } });
    await svc.rebuild();
    expect(scheduled).toHaveLength(reminderSlots(new Date(NOW), { days: [0], time: '21:30' }).length);
  });

  it('fill on app start schedules again, and works with Google Calendar off', async () => {
    native();
    await svc.enablePhone();
    scheduled = [];
    await svc.fill();
    expect(scheduled).toHaveLength(expected());
  });

  it('disabling cancels everything pending', async () => {
    native();
    await svc.enablePhone();
    await svc.disablePhone();
    expect(notifier.cancelAll).toHaveBeenCalled();
    expect(scheduled).toEqual([]);
    expect((await db.settings.get('settings'))?.reminders?.phone).toBe(false);
  });

  it('does not schedule when the permission was taken away, and says so', async () => {
    native();
    await svc.enablePhone();
    scheduled = [];
    notifier.allowed = false;
    notifier.permission = async () => false;
    await svc.fill();
    expect(scheduled).toEqual([]);
    expect(svc.phoneNeedsPermission()).toBe(true);
  });
});
