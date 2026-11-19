import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthApi } from '../auth/auth.service';
import { FakeAuthService } from '../auth/fake-auth.service';
import { CLOCK } from '../core/clock';
import { POLL_MS, SLOW_POLL_MS, STALE_MS, SyncScheduler } from './sync-scheduler';
import { SyncEngine, type SyncStatus } from './sync-engine';

@Component({ template: '' })
class Blank {}

let now: number;

/** The parts of SyncEngine the scheduler uses. */
function fakeEngine() {
  const e = {
    start: vi.fn(),
    resume: vi.fn(async (): Promise<void> => undefined),
    syncNow: vi.fn(async (): Promise<void> => undefined),
    status: signal<SyncStatus>('synced'),
    lastSyncedAt: signal<number | null>(null),
    lastPassChanged: false,
  };
  return e;
}

describe('SyncScheduler', () => {
  let engine: ReturnType<typeof fakeEngine>;
  let auth: FakeAuthService;
  let scheduler: SyncScheduler;
  let router: Router;

  const setVisible = (visible: boolean) => {
    Object.defineProperty(document, 'visibilityState', { value: visible ? 'visible' : 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  };
  const setOnline = (online: boolean) => vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online);
  /** Moves the app clock and the timers together. */
  async function advance(ms: number): Promise<void> {
    now += ms;
    await vi.advanceTimersByTimeAsync(ms);
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    now = 10_000_000;
    setVisible(true);
    setOnline(true);
    engine = fakeEngine();
    auth = new FakeAuthService();
    await auth.signIn();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', component: Blank }]),
        { provide: CLOCK, useValue: { now: () => now } },
        { provide: AuthApi, useValue: auth },
        { provide: SyncEngine, useValue: engine },
      ],
    });
    scheduler = TestBed.inject(SyncScheduler);
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    scheduler.ngOnDestroy();
    setVisible(true);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('starts the engine and syncs once when the app starts; starting again does nothing more', () => {
    scheduler.start();
    scheduler.start();
    expect(engine.start).toHaveBeenCalledTimes(1);
    expect(engine.resume).toHaveBeenCalledTimes(1);
  });

  describe('coming back to the tab', () => {
    it('syncs when the last sync is older than 60 s, never when it is newer', async () => {
      scheduler.start();
      engine.resume.mockClear();
      engine.lastSyncedAt.set(now - (STALE_MS - 1000));
      setVisible(false);
      setVisible(true);
      expect(engine.resume).not.toHaveBeenCalled();
      engine.lastSyncedAt.set(now - (STALE_MS + 1000));
      setVisible(false);
      setVisible(true);
      expect(engine.resume).toHaveBeenCalledTimes(1);
    });

    it('syncs when it has never synced', () => {
      scheduler.start();
      engine.resume.mockClear();
      setVisible(false);
      setVisible(true);
      expect(engine.resume).toHaveBeenCalledTimes(1);
    });

    it('does nothing when the tab is hidden', () => {
      scheduler.start();
      engine.resume.mockClear();
      setVisible(false);
      expect(engine.resume).not.toHaveBeenCalled();
      expect(engine.syncNow).not.toHaveBeenCalled();
    });
  });

  it('syncs when the connection returns', () => {
    scheduler.start();
    window.dispatchEvent(new Event('online'));
    expect(engine.syncNow).toHaveBeenCalledTimes(1);
  });

  describe('opening the Library', () => {
    it('syncs when the last sync is older than 60 s and not otherwise', async () => {
      scheduler.start();
      engine.resume.mockClear();
      engine.lastSyncedAt.set(now - 5000);
      await router.navigateByUrl('/library');
      expect(engine.resume).not.toHaveBeenCalled();
      engine.lastSyncedAt.set(now - (STALE_MS + 1));
      await router.navigateByUrl('/notes');
      await router.navigateByUrl('/library');
      expect(engine.resume).toHaveBeenCalledTimes(1);
    });

    it('other pages do not sync', async () => {
      scheduler.start();
      engine.resume.mockClear();
      engine.lastSyncedAt.set(null);
      await router.navigateByUrl('/stats');
      await router.navigateByUrl('/settings');
      expect(engine.resume).not.toHaveBeenCalled();
    });
  });

  describe('leaving the reader', () => {
    it('syncs at once, but only after the position and session writes finished', async () => {
      scheduler.start();
      engine.syncNow.mockClear();
      engine.lastSyncedAt.set(now - 1000);
      let finish!: () => void;
      const done = new Promise<void>((r) => (finish = r));
      scheduler.afterReader(done);
      await advance(0);
      expect(engine.syncNow).not.toHaveBeenCalled();
      finish();
      await advance(0);
      expect(engine.syncNow).toHaveBeenCalledTimes(1);
    });

    it('still syncs when the write failed', async () => {
      scheduler.start();
      engine.syncNow.mockClear();
      scheduler.afterReader(Promise.reject(new Error('db')));
      await advance(0);
      expect(engine.syncNow).toHaveBeenCalledTimes(1);
    });

    it('does not sync while offline or when sign-in has lapsed', async () => {
      scheduler.start();
      engine.syncNow.mockClear();
      setOnline(false);
      scheduler.afterReader(Promise.resolve());
      await advance(0);
      setOnline(true);
      auth.markExpired();
      scheduler.afterReader(Promise.resolve());
      await advance(0);
      expect(engine.syncNow).not.toHaveBeenCalled();
    });
  });

  describe('the poll', () => {
    it('syncs every 2 minutes while the tab is visible and signed in', async () => {
      scheduler.start();
      engine.resume.mockClear();
      await advance(POLL_MS - 1000);
      expect(engine.resume).not.toHaveBeenCalled();
      await advance(2000);
      expect(engine.resume).toHaveBeenCalledTimes(1);
      engine.lastPassChanged = true;
      await advance(POLL_MS);
      expect(engine.resume).toHaveBeenCalledTimes(2);
    });

    it('backs off to 5 minutes after 3 idle passes, and a pass that found changes brings it back to 2', async () => {
      scheduler.start();
      engine.resume.mockClear();
      engine.lastPassChanged = false;
      for (let i = 0; i < 3; i++) await advance(POLL_MS);
      expect(engine.resume).toHaveBeenCalledTimes(3);
      await advance(POLL_MS + 1000);
      expect(engine.resume).toHaveBeenCalledTimes(3);
      await advance(SLOW_POLL_MS - POLL_MS);
      expect(engine.resume).toHaveBeenCalledTimes(4);
      engine.lastPassChanged = true;
      await advance(SLOW_POLL_MS);
      expect(engine.resume).toHaveBeenCalledTimes(5);
      await advance(POLL_MS);
      expect(engine.resume).toHaveBeenCalledTimes(6);
    });

    it('does not run while the tab is hidden and starts again when it is visible', async () => {
      scheduler.start();
      engine.resume.mockClear();
      setVisible(false);
      await advance(10 * POLL_MS);
      expect(engine.resume).not.toHaveBeenCalled();
      engine.lastSyncedAt.set(now);
      setVisible(true);
      expect(engine.resume).not.toHaveBeenCalled();
      await advance(POLL_MS + 1000);
      expect(engine.resume).toHaveBeenCalledTimes(1);
    });

    it('skips a tick while offline or when sign-in has lapsed, and carries on afterwards', async () => {
      scheduler.start();
      engine.resume.mockClear();
      setOnline(false);
      await advance(POLL_MS);
      auth.markExpired();
      setOnline(true);
      await advance(POLL_MS);
      expect(engine.resume).not.toHaveBeenCalled();
      await auth.reconnect();
      await advance(POLL_MS);
      expect(engine.resume).toHaveBeenCalledTimes(1);
    });

    it('never starts a pass while the previous one is still running', async () => {
      scheduler.start();
      engine.resume.mockReset();
      let release!: () => void;
      engine.resume.mockImplementation(() => new Promise<void>((r) => (release = r)));
      await advance(POLL_MS);
      expect(engine.resume).toHaveBeenCalledTimes(1);
      await advance(POLL_MS);
      expect(engine.resume).toHaveBeenCalledTimes(1);
      release();
      await advance(POLL_MS);
      expect(engine.resume).toHaveBeenCalledTimes(2);
    });
  });

  describe('a new token', () => {
    it('retries a sync that was waiting for it', async () => {
      scheduler.start();
      await advance(0);
      engine.syncNow.mockClear();
      engine.status.set('paused');
      await auth.reconnect();
      TestBed.tick();
      await advance(0);
      expect(engine.syncNow).toHaveBeenCalledTimes(1);
    });

    it('does nothing when everything is synced anyway', async () => {
      scheduler.start();
      await advance(0);
      engine.syncNow.mockClear();
      engine.status.set('synced');
      await auth.reconnect();
      TestBed.tick();
      await advance(0);
      expect(engine.syncNow).not.toHaveBeenCalled();
    });
  });

  it('stops everything when destroyed', async () => {
    scheduler.start();
    engine.resume.mockClear();
    scheduler.ngOnDestroy();
    window.dispatchEvent(new Event('online'));
    setVisible(false);
    setVisible(true);
    await advance(10 * POLL_MS);
    expect(engine.syncNow).not.toHaveBeenCalled();
    expect(engine.resume).not.toHaveBeenCalled();
  });
});
