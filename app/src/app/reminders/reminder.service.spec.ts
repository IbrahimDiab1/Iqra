import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthApi, AuthCancelledError } from '../auth/auth.service';
import { ScopeDeniedError } from '../auth/scope-grant';
import { SyncEngine } from '../sync/sync-engine';
import { FakeAuthService } from '../auth/fake-auth.service';
import { CLOCK } from '../core/clock';
import { DB, IqraDb } from '../core/db';
import { newId } from '../core/ids';
import type { Annotation, Book } from '../core/models';
import { SettingsService } from '../core/settings.service';
import { CALENDAR_API, CalendarAuthError, CalendarTransientError } from './calendar-api';
import { FakeCalendar } from './fake-calendar';
import { eventId, reminderSlots } from './schedule';
import { ReminderService } from './reminder.service';

const NOW = new Date(2026, 10, 18, 22, 0).getTime();
const DAYS = [6, 0, 1, 2, 3, 4] as (0 | 1 | 2 | 3 | 4 | 5 | 6)[];

function book(over: Partial<Book>): Book {
  return {
    id: newId(), updatedAt: 1, deviceId: 'd', title: 'T', author: '', driveFileId: '', fileName: '', sizeBytes: 0, sha256: '',
    pageCount: 10, outline: [], language: 'en', direction: 'ltr', addedAt: 1, status: 'to-read', categoryIds: [], tags: [],
    progressMode: 'last-page', pageMode: 'swipe', lastPageReached: 1, ...over,
  };
}

describe('ReminderService', () => {
  let db: IqraDb;
  let cal: FakeCalendar;
  let svc: ReminderService;
  let auth: FakeAuthService;
  let settings: SettingsService;
  const syncNow = vi.fn(async () => undefined);

  const reminders = async () => (await db.settings.get('settings'))?.reminders as Record<string, unknown> | undefined;
  const expectedCount = () => reminderSlots(new Date(NOW), { days: DAYS, time: '21:30' }).length;

  beforeEach(async () => {
    localStorage.clear();
    db = new IqraDb(`iqra-test-${newId()}`);
    cal = new FakeCalendar();
    syncNow.mockReset();
    syncNow.mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      providers: [
        { provide: DB, useValue: db },
        { provide: CLOCK, useValue: { now: () => NOW } },
        { provide: AuthApi, useClass: FakeAuthService },
        { provide: CALENDAR_API, useValue: cal },
        { provide: SyncEngine, useValue: { syncNow } },
      ],
    });
    auth = TestBed.inject(AuthApi) as FakeAuthService;
    await auth.signIn();
    settings = TestBed.inject(SettingsService);
    svc = TestBed.inject(ReminderService);
    await settings.update({ reminders: { enabled: true, days: DAYS, time: '21:30', quoteSource: 'builtin', calendarId: 'cal1' } });
    await auth.requestScope('https://www.googleapis.com/auth/calendar.app.created');
  });

  afterEach(async () => {
    TestBed.resetTestingModule();
    await db.delete();
  });

  it('first fill inserts the window, the second inserts nothing', async () => {
    const first = await svc.fill();
    expect(first).toEqual({ created: expectedCount(), removed: 0 });
    expect(cal.live().length).toBe(expectedCount());
    expect(await svc.fill()).toEqual({ created: 0, removed: 0 });
  });

  it('rebuild diffs: removes only events no longer wanted, never re-inserts an existing id', async () => {
    await svc.fill();
    await settings.update({ reminders: { ...(await reminders()), days: [0] } });
    const inserts = cal.insertCalls;
    const slots = reminderSlots(new Date(NOW), { days: [0], time: '21:30' });
    const r = await svc.rebuild();
    expect(r).toEqual({ created: 0, removed: expectedCount() - slots.length });
    expect(cal.insertCalls).toBe(inserts);
    expect(cal.live().map((e) => e.id).sort()).toEqual(slots.map(eventId).sort());
  });

  it('turning a day off and on again restores the cancelled events instead of losing them', async () => {
    await svc.fill();
    await settings.update({ reminders: { ...(await reminders()), days: [0] } });
    await svc.rebuild();
    await settings.update({ reminders: { ...(await reminders()), days: DAYS } });
    const r = await svc.rebuild();
    expect(r).toEqual({ created: expectedCount() - reminderSlots(new Date(NOW), { days: [0], time: '21:30' }).length, removed: 0 });
    expect(cal.live()).toHaveLength(expectedCount());
  });

  it('disable with removal then enable brings every event back', async () => {
    await svc.fill();
    await svc.disable({ removeEvents: true });
    expect(cal.live()).toHaveLength(0);
    expect(await svc.enable()).toBe('ok');
    expect(cal.live()).toHaveLength(expectedCount());
  });

  it('updates descriptions in place when the quote source changes', async () => {
    await svc.fill();
    const before = cal.live().map((e) => e.description);
    await settings.update({ reminders: { ...(await reminders()), quoteSource: 'builtin', customQuotes: ['A very personal line'] } });
    const inserts = cal.insertCalls;
    const removes = cal.removeCalls;
    await svc.rebuild();
    expect(cal.insertCalls).toBe(inserts);
    expect(cal.removeCalls).toBe(removes);
    expect(cal.live().map((e) => e.description)).not.toEqual(before);
    expect(cal.live().some((e) => e.description.includes('A very personal line'))).toBe(true);
  });

  it('a second rebuild with nothing changed touches nothing', async () => {
    await svc.fill();
    const writes = cal.insertCalls + cal.updateCalls + cal.removeCalls;
    await svc.rebuild();
    expect(cal.insertCalls + cal.updateCalls + cal.removeCalls).toBe(writes);
  });

  it('runs one fill at a time and queues a single follow-up', async () => {
    cal.delayMs = 5;
    const runs = [svc.fill(), svc.fill(), svc.rebuild(), svc.fill()];
    const results = await Promise.all(runs);
    expect(cal.maxActive).toBe(1);
    expect(results[0]).toEqual({ created: expectedCount(), removed: 0 });
    expect(results[1]).toBe(results[2]);
    expect(results[2]).toBe(results[3]);
    expect(cal.live()).toHaveLength(expectedCount());
    expect(cal.ensureCalls).toBe(2);
  });

  it('a transient calendar error keeps reminders on', async () => {
    cal.failWith = new CalendarTransientError();
    await expect(svc.fill()).rejects.toBeInstanceOf(CalendarTransientError);
    expect((await reminders())?.['enabled']).toBe(true);
    expect(svc.needsPermission()).toBe(false);
    cal.failWith = null;
    expect(await svc.fill()).toEqual({ created: expectedCount(), removed: 0 });
  });

  it('enable syncs first so a calendar from another device is used', async () => {
    await settings.update({ reminders: {} });
    syncNow.mockImplementation(async () => {
      await settings.update({ reminders: { calendarId: 'from-device-two' } });
    });
    expect(await svc.enable()).toBe('ok');
    expect(syncNow).toHaveBeenCalledTimes(1);
    expect((await reminders())?.['calendarId']).toBe('from-device-two');
  });

  it('is skipped when reminders are disabled', async () => {
    await settings.update({ reminders: { ...(await reminders()), enabled: false } });
    expect(await svc.fill()).toEqual({ created: 0, removed: 0 });
    expect(cal.live().length).toBe(0);
  });

  it('a calendar auth error turns reminders off and does not retry', async () => {
    cal.failWith = new CalendarAuthError('nope');
    expect(await svc.fill()).toBe('needs-permission');
    expect((await reminders())?.['enabled']).toBe(false);
    expect(svc.needsPermission()).toBe(true);
    expect(cal.ensureCalls).toBe(1);
  });

  it('without a cached token fill asks for permission but keeps reminders on', async () => {
    vi.spyOn(auth, 'scopeToken').mockReturnValue(null);
    vi.spyOn(auth, 'requestScope').mockRejectedValue(new AuthCancelledError());
    expect(await svc.fill()).toBe('needs-permission');
    expect((await reminders())?.['enabled']).toBe(true);
    expect(svc.needsPermission()).toBe(true);
  });

  it('uses the current reading book in the title and links to it', async () => {
    const old = book({ title: 'Old', status: 'reading', lastOpenedAt: 5 });
    const current = book({ title: 'Dune', status: 'reading', lastOpenedAt: 50 });
    await db.books.bulkPut([old, current, book({ title: 'Later', status: 'paused', lastOpenedAt: 99 })]);
    await svc.fill();
    const ev = cal.live()[0];
    expect(ev.title).toBe('Time to read · Dune');
    expect(ev.description).toMatch(new RegExp(`/read/${current.id}$`));
  });

  it('has a plain title without a reading book', async () => {
    await svc.fill();
    expect(cal.live()[0].title).toBe('Time to read');
  });

  it('puts the quote and its source in the description', async () => {
    const b = book({ title: 'Dune', status: 'reading', lastOpenedAt: 1 });
    await db.books.put(b);
    const a: Annotation = {
      id: newId(), updatedAt: 1, deviceId: 'd', bookId: b.id, type: 'highlight', page: 11, tags: [], createdAt: 1,
      text: { page: 11, start: { item: 0, offset: 0 }, end: { item: 0, offset: 5 }, rects: [], quote: 'Fear is the mind-killer, so keep reading.' },
    };
    await db.annotations.put(a);
    await settings.update({ reminders: { ...(await reminders()), quoteSource: 'highlights' } });
    await svc.fill();
    const desc = cal.live()[0].description;
    expect(desc).toContain('Fear is the mind-killer, so keep reading.');
    expect(desc).toContain('Dune, p. 11');
  });

  it('enable saves the calendar and fills it', async () => {
    await settings.update({ reminders: { days: DAYS, time: '21:30', quoteSource: 'builtin' } });
    expect(await svc.enable()).toBe('ok');
    const r = await reminders();
    expect(r?.['enabled']).toBe(true);
    expect(r?.['calendarId']).toBe('fake-calendar');
    expect(cal.live().length).toBe(expectedCount());
  });

  it('enable returns denied and stays off when permission is refused', async () => {
    await settings.update({ reminders: {} });
    vi.spyOn(auth, 'requestScope').mockRejectedValue(new ScopeDeniedError('access_denied'));
    expect(await svc.enable()).toBe('denied');
    expect((await reminders())?.['enabled']).toBeFalsy();
  });

  it('enable lets a Calendar error through with its status and reason, and stays off', async () => {
    await settings.update({ reminders: {} });
    cal.failWith = new CalendarTransientError('off', 403, 'accessNotConfigured');
    await expect(svc.enable()).rejects.toMatchObject({ status: 403, reason: 'accessNotConfigured' });
    expect((await reminders())?.['enabled']).toBeFalsy();
    cal.failWith = new CalendarAuthError('scope', 403, 'insufficientPermissions');
    await expect(svc.enable()).rejects.toMatchObject({ name: 'CalendarAuthError', reason: 'insufficientPermissions' });
    expect((await reminders())?.['enabled']).toBeFalsy();
  });

  it('enable rethrows a fault that is not a refusal', async () => {
    await settings.update({ reminders: {} });
    vi.spyOn(auth, 'requestScope').mockRejectedValue(new Error('Could not load Google sign-in'));
    await expect(svc.enable()).rejects.toThrow('Could not load');
  });

  it('enable returns cancelled when the popup is closed', async () => {
    await settings.update({ reminders: {} });
    vi.spyOn(auth, 'requestScope').mockRejectedValue(new AuthCancelledError());
    expect(await svc.enable()).toBe('cancelled');
    expect((await reminders())?.['enabled']).toBeFalsy();
  });

  it('disable can remove the upcoming events', async () => {
    await svc.fill();
    await svc.disable({ removeEvents: true });
    expect(cal.live().length).toBe(0);
    expect((await reminders())?.['enabled']).toBe(false);
  });

  it('disable keeps events when asked to', async () => {
    await svc.fill();
    await svc.disable({ removeEvents: false });
    expect(cal.live().length).toBe(expectedCount());
  });
});
