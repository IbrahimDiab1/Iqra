import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOCK } from '../core/clock';
import { DB, IqraDb } from '../core/db';
import { DEVICE_ID, newId } from '../core/ids';
import { Repo } from '../core/repo';
import type { Book } from '../core/models';
import { SessionService } from './session.service';

const book = (over: Partial<Book> = {}): Book => ({
  id: 'b1', deviceId: 'dev', updatedAt: 1, title: 'T', author: 'A', driveFileId: 'd', fileName: 'f.pdf', sizeBytes: 1, sha256: 'x',
  pageCount: 100, outline: [], language: 'en', direction: 'ltr', addedAt: 1, status: 'to-read', categoryIds: [], tags: [],
  progressMode: 'last-page', pageMode: 'swipe', lastPageReached: 0, ...over,
});

describe('SessionService', () => {
  let db: IqraDb;
  let service: SessionService;
  let clock: { t: number };

  beforeEach(async () => {
    localStorage.clear();
    clock = { t: new Date(2026, 10, 14, 10, 0, 0).getTime() };
    TestBed.configureTestingModule({
      providers: [
        { provide: DB, useFactory: () => new IqraDb(`iqra-test-${newId()}`) },
        { provide: CLOCK, useValue: { now: () => clock.t } },
        { provide: DEVICE_ID, useValue: 'dev' },
      ],
    });
    db = TestBed.inject(DB);
    service = TestBed.inject(SessionService);
    await db.books.put(book());
  });

  afterEach(async () => {
    vi.useRealTimers();
    await db.delete();
  });

  it('writes nothing for a session with no activity', async () => {
    const h = service.start(book(), 1);
    await h.end();
    expect(await db.sessions.count()).toBe(0);
  });

  it('checkpoints rewrite the same record', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const h = service.start(book(), 1);
    for (let i = 0; i < 3; i++) {
      clock.t += 30_000;
      h.activity();
      await vi.advanceTimersByTimeAsync(30_000);
      await vi.waitFor(async () => expect(await db.sessions.count()).toBe(1));
    }
    const rec = (await db.sessions.toArray())[0];
    expect(rec.activeMs).toBeGreaterThanOrEqual(60_000);
    expect(rec.bookId).toBe('b1');
    await h.end();
    expect(await db.sessions.count()).toBe(1);
    expect((await db.sessions.toArray())[0].id).toBe(rec.id);
  });

  it('end writes the final snapshot', async () => {
    const h = service.start(book(), 1);
    clock.t += 7_000;
    h.activity();
    clock.t += 1_000;
    await h.end();
    const [rec] = await db.sessions.toArray();
    expect(rec.activeMs).toBe(8_000);
    expect(rec.pagesRead).toEqual([1]);
    expect(rec.endedAt).toBe(clock.t);
  });

  it('three pages read set startedAt and status reading once', async () => {
    const h = service.start(book(), 1);
    for (const p of [2, 3, 4]) {
      clock.t += 6_000;
      h.pageChanged(p);
    }
    await h.end();
    const b = (await db.books.get('b1'))!;
    expect(b.status).toBe('reading');
    expect(b.startedAt).toBe(new Date(2026, 10, 14).getTime());
    const stamp = b.updatedAt;

    const h2 = service.start(b, 5);
    clock.t += 6_000;
    h2.activity();
    await h2.end();
    const again = (await db.books.get('b1'))!;
    expect(again.startedAt).toBe(b.startedAt);
    expect(again.updatedAt).toBe(stamp);
  });

  it('counts distinct pages across sessions and keeps a later status', async () => {
    await db.books.put(book({ status: 'paused' }));
    const a = service.start(book(), 1);
    clock.t += 6_000;
    a.pageChanged(2);
    clock.t += 6_000;
    await a.end();
    expect((await db.books.get('b1'))!.startedAt).toBeUndefined();
    const b = service.start(book(), 3);
    clock.t += 6_000;
    await b.end();
    const stored = (await db.books.get('b1'))!;
    expect(stored.startedAt).toBeDefined();
    expect(stored.status).toBe('paused');
  });

  it('a failed checkpoint write is retried by the next identical checkpoint', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const repo = TestBed.inject(Repo);
    const put = vi.spyOn(repo, 'put');
    put.mockRejectedValueOnce(new Error('disk full'));
    const h = service.start(book(), 1);
    clock.t += 30_000;
    h.activity();
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(await db.sessions.count()).toBe(0);
    // No time passes, so the snapshot is identical to the one that failed.
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.waitFor(async () => expect(await db.sessions.count()).toBe(1));
    expect(put).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalled();
    await h.end();
    warn.mockRestore();
  });

  describe('ending a run', () => {
    const setVisibility = (state: 'visible' | 'hidden') =>
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state);

    it('the app going to the background ends the run and writes the session', async () => {
      const h = service.start(book(), 1);
      clock.t += 8_000;
      h.activity();
      setVisibility('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.waitFor(async () => expect(await db.sessions.count()).toBe(1));
      const [rec] = await db.sessions.toArray();
      expect(rec.activeMs).toBe(8_000);
      expect(rec.pagesRead).toEqual([1]);
      // Activity while hidden does not start a new run.
      clock.t += 8_000;
      h.activity();
      await h.end();
      expect(await db.sessions.count()).toBe(1);
      vi.restoreAllMocks();
    });

    it('coming back to the foreground starts a second record', async () => {
      const h = service.start(book(), 1);
      clock.t += 8_000;
      h.activity();
      const vis = setVisibility('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.waitFor(async () => expect(await db.sessions.count()).toBe(1));
      vis.mockReturnValue('visible');
      document.dispatchEvent(new Event('visibilitychange'));
      clock.t += 8_000;
      h.activity();
      await h.end();
      expect(await db.sessions.count()).toBe(2);
      vi.restoreAllMocks();
    });

    it('pagehide ends the run', async () => {
      const h = service.start(book(), 1);
      clock.t += 8_000;
      h.activity();
      window.dispatchEvent(new Event('pagehide'));
      await vi.waitFor(async () => expect(await db.sessions.count()).toBe(1));
      expect((await db.sessions.toArray())[0].activeMs).toBe(8_000);
      await h.end();
    });

    it('30 idle minutes end the run, and endedAt is the last activity plus the 2 minute active cap', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      const start = clock.t;
      const h = service.start(book(), 1);
      clock.t += 10_000;
      h.activity();
      clock.t += 31 * 60_000;
      await vi.advanceTimersByTimeAsync(30_000);
      await vi.waitFor(async () => expect(await db.sessions.count()).toBe(1));
      const [rec] = await db.sessions.toArray();
      expect(rec.endedAt).toBe(start + 10_000 + 120_000);
      expect(rec.activeMs).toBe(130_000);
      // Later activity starts a fresh run.
      h.activity();
      clock.t += 8_000;
      h.activity();
      await h.end();
      expect(await db.sessions.count()).toBe(2);
    });
  });

  it('a clock that moves backwards never gives negative time or NaN', async () => {
    const start = clock.t;
    const h = service.start(book(), 1);
    clock.t += 10_000;
    h.activity();
    clock.t -= 60 * 60_000;
    h.activity();
    h.pageChanged(2);
    clock.t += 5_000;
    await h.end();
    const [rec] = await db.sessions.toArray();
    expect(Number.isFinite(rec.activeMs)).toBe(true);
    expect(rec.activeMs).toBeGreaterThanOrEqual(10_000);
    expect(rec.endedAt).toBeGreaterThanOrEqual(rec.startedAt);
    expect(rec.startedAt).toBe(start);
  });
});
