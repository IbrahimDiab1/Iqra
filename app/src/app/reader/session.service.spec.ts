import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOCK } from '../core/clock';
import { DB, IqraDb } from '../core/db';
import { DEVICE_ID, newId } from '../core/ids';
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
});
