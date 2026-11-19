import { describe, expect, it } from 'vitest';
import type { Book, Goal, ID, ReadingSession } from '../core/models';
import { booksOnDay, dayStats, goalProgress, perBook, totals } from './aggregate';

const local = (y: number, month: number, d: number, h = 0, min = 0) => new Date(y, month - 1, d, h, min).getTime();
const MIN = 60_000;

function session(over: Partial<ReadingSession> & { id: ID; bookId: ID; startedAt: number }): ReadingSession {
  return {
    updatedAt: 0,
    deviceId: 'device',
    endedAt: over.startedAt + 60 * MIN,
    activeMs: 60 * MIN,
    pagesRead: [],
    ...over,
  };
}

function book(over: Partial<Book> & { id: ID }): Book {
  return {
    updatedAt: 0,
    deviceId: 'device',
    title: '',
    author: '',
    driveFileId: '',
    fileName: '',
    sizeBytes: 0,
    sha256: '',
    pageCount: 100,
    outline: [],
    language: 'en',
    direction: 'ltr',
    addedAt: 0,
    status: 'reading',
    categoryIds: [],
    tags: [],
    progressMode: 'last-page',
    pageMode: 'swipe',
    lastPageReached: 0,
    ...over,
  };
}

function goal(over: Partial<Goal>): Goal {
  return { id: 'g', updatedAt: 0, deviceId: 'device', categoryId: null, measure: 'time', target: 60, ...over };
}

// Book A reads page 3 twice on Nov 18 and once on Nov 19; book A's Nov 19 page 3 is a second day.
const sameDay: ReadingSession[] = [
  session({ id: 's1', bookId: 'a', startedAt: local(2026, 11, 18, 10), activeMs: 10 * 1000, pagesRead: [3] }),
  session({ id: 's2', bookId: 'a', startedAt: local(2026, 11, 18, 15), activeMs: 20 * 1000, pagesRead: [3] }),
  session({ id: 's3', bookId: 'a', startedAt: local(2026, 11, 19, 9), activeMs: 5 * 1000, pagesRead: [3] }),
];

describe('dayStats', () => {
  it('counts a book page once per day but adds the time of every session', () => {
    expect(dayStats(sameDay)).toEqual([
      { day: '2026-11-18', pages: 1, ms: 30 * 1000 },
      { day: '2026-11-19', pages: 1, ms: 5 * 1000 },
    ]);
  });

  it('assigns a session that crosses local midnight to the day it started', () => {
    const crossing = [session({ id: 'x', bookId: 'a', startedAt: local(2026, 11, 18, 23, 50), activeMs: 30 * MIN, pagesRead: [7, 8] })];
    expect(dayStats(crossing)).toEqual([{ day: '2026-11-18', pages: 2, ms: 30 * MIN }]);
  });

  it('limits results to sessions that start inside the range', () => {
    const range = { from: local(2026, 11, 19), to: local(2026, 11, 20) };
    expect(dayStats(sameDay, range)).toEqual([{ day: '2026-11-19', pages: 1, ms: 5 * 1000 }]);
  });

  it('ignores negative, non-finite and deleted sessions', () => {
    const bad = [
      session({ id: 'n', bookId: 'a', startedAt: local(2026, 11, 18), activeMs: -5, pagesRead: [1] }),
      session({ id: 'nan', bookId: 'a', startedAt: local(2026, 11, 18), activeMs: Number.NaN, pagesRead: [1] }),
      session({ id: 'inf', bookId: 'a', startedAt: local(2026, 11, 18), activeMs: Number.POSITIVE_INFINITY, pagesRead: [1] }),
      session({ id: 'del', bookId: 'a', startedAt: local(2026, 11, 18), activeMs: MIN, pagesRead: [1], deleted: true }),
    ];
    expect(dayStats(bad)).toEqual([]);
  });
});

describe('totals', () => {
  it('sums time, counts unique book pages per day, and averages time per page', () => {
    expect(totals(sameDay)).toEqual({ ms: 35 * 1000, pages: 2, sessions: 3, days: 2, avgMsPerPage: 17_500 });
  });

  it('is all zeros with no sessions', () => {
    expect(totals([])).toEqual({ ms: 0, pages: 0, sessions: 0, days: 0, avgMsPerPage: 0 });
  });

  it('leaves out invalid sessions from every count', () => {
    const mixed = [...sameDay, session({ id: 'bad', bookId: 'a', startedAt: local(2026, 11, 20), activeMs: -1, pagesRead: [9] })];
    expect(totals(mixed).sessions).toBe(3);
    expect(totals(mixed).pages).toBe(2);
  });
});

describe('perBook', () => {
  it('gives time and unique pages per book', () => {
    const sessions = [...sameDay, session({ id: 'b1', bookId: 'b', startedAt: local(2026, 11, 18, 12), activeMs: MIN, pagesRead: [3] })];
    const map = perBook(sessions);
    expect(map.get('a')).toEqual({ ms: 35 * 1000, pages: 2 });
    expect(map.get('b')).toEqual({ ms: MIN, pages: 1 });
  });
});

describe('goalProgress', () => {
  const week = { from: local(2026, 11, 14), to: local(2026, 11, 21) };

  it('measures pages as a fraction of the target', () => {
    const sessions = [session({ id: 'p', bookId: 'a', startedAt: local(2026, 11, 15), activeMs: MIN, pagesRead: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] })];
    const result = goalProgress(goal({ measure: 'pages', target: 20 }), sessions, [book({ id: 'a' })], week);
    expect(result).toMatchObject({ value: 10, fraction: 0.5 });
  });

  it('measures time in minutes and caps the fraction at 1', () => {
    const books = [book({ id: 'a' })];
    const at45 = [session({ id: 's', bookId: 'a', startedAt: local(2026, 11, 15), activeMs: 45 * MIN })];
    const at90 = [session({ id: 's', bookId: 'a', startedAt: local(2026, 11, 15), activeMs: 90 * MIN })];
    expect(goalProgress(goal({ target: 60 }), at45, books, week)).toMatchObject({ value: 45, fraction: 0.75 });
    expect(goalProgress(goal({ target: 60 }), at90, books, week)).toMatchObject({ value: 90, fraction: 1 });
  });

  it('counts a book toward every category goal it belongs to', () => {
    const books = [book({ id: 'a', categoryIds: ['tech', 'fiction'] })];
    const sessions = [session({ id: 's', bookId: 'a', startedAt: local(2026, 11, 15), activeMs: 45 * MIN })];
    expect(goalProgress(goal({ categoryId: 'tech', target: 60 }), sessions, books, week).value).toBe(45);
    expect(goalProgress(goal({ categoryId: 'fiction', target: 60 }), sessions, books, week).value).toBe(45);
  });

  it('excludes deleted books and sessions of unknown books', () => {
    const books = [book({ id: 'a' }), book({ id: 'c', deleted: true })];
    const sessions = [
      session({ id: 's1', bookId: 'a', startedAt: local(2026, 11, 15), activeMs: 45 * MIN }),
      session({ id: 's2', bookId: 'c', startedAt: local(2026, 11, 15), activeMs: 90 * MIN }),
      session({ id: 's3', bookId: 'zz', startedAt: local(2026, 11, 15), activeMs: 90 * MIN }),
    ];
    expect(goalProgress(goal({ target: 60 }), sessions, books, week).value).toBe(45);
  });

  it('ignores sessions outside the range', () => {
    const books = [book({ id: 'a' })];
    const sessions = [session({ id: 's', bookId: 'a', startedAt: local(2026, 11, 21, 9), activeMs: 45 * MIN })];
    expect(goalProgress(goal({ target: 60 }), sessions, books, week).value).toBe(0);
  });
});

describe('booksOnDay', () => {
  it('lists each book read that day with unique pages and time, longest first', () => {
    const sessions = [
      session({ id: '1', bookId: 'a', startedAt: local(2026, 11, 5, 9), pagesRead: [1, 2], activeMs: 10 * MIN }),
      session({ id: '2', bookId: 'a', startedAt: local(2026, 11, 5, 20), pagesRead: [2, 3], activeMs: 5 * MIN }),
      session({ id: '3', bookId: 'b', startedAt: local(2026, 11, 5, 12), pagesRead: [9], activeMs: 30 * MIN }),
      session({ id: '4', bookId: 'a', startedAt: local(2026, 11, 6, 9), pagesRead: [4], activeMs: 5 * MIN }),
      session({ id: '5', bookId: 'a', startedAt: local(2026, 11, 5, 21), activeMs: 5 * MIN, deleted: true }),
    ];
    expect(booksOnDay(sessions, '2026-11-05')).toEqual([
      { bookId: 'b', pages: 1, ms: 30 * MIN },
      { bookId: 'a', pages: 3, ms: 15 * MIN },
    ]);
    expect(booksOnDay(sessions, '2026-11-07')).toEqual([]);
  });
});

