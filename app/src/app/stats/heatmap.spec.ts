import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Book, Category, ID, ReadingSession } from '../core/models';
import {
  canGoNext,
  categoryHue,
  dayLabel,
  gridColumns,
  heatmapDays,
  intensityLevel,
  neighbourDay,
  isCurrentPeriod,
  periodBounds,
  shiftPeriod,
} from './heatmap';
import { dayKey } from './week';

const local = (y: number, month: number, d: number, h = 0, min = 0) => new Date(y, month - 1, d, h, min).getTime();
const MIN = 60_000;

function session(over: Partial<ReadingSession> & { id: ID; bookId: ID; startedAt: number }): ReadingSession {
  return { updatedAt: 0, deviceId: 'device', endedAt: over.startedAt + 10 * MIN, activeMs: 10 * MIN, pagesRead: [], ...over };
}

function book(over: Partial<Book> & { id: ID }): Book {
  return {
    updatedAt: 0, deviceId: 'device', title: over.id, author: '', driveFileId: '', fileName: '', sizeBytes: 0, sha256: '', pageCount: 100,
    outline: [], language: 'en', direction: 'ltr', addedAt: 0, status: 'reading', categoryIds: [], tags: [], progressMode: 'last-page',
    pageMode: 'swipe', lastPageReached: 0, ...over,
  };
}

const cat = (id: ID, order: number): Category => ({ id, name: id, order, updatedAt: 0, deviceId: 'device' });

const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;

/** Runs a block with the process time zone switched, so DST rules apply. */
function inZone(zone: string, define: () => void): void {
  describe(`in ${zone}`, () => {
    let previous: string | undefined;
    beforeAll(() => {
      previous = env['TZ'];
      env['TZ'] = zone;
    });
    afterAll(() => {
      if (previous === undefined) delete env['TZ'];
      else env['TZ'] = previous;
    });
    define();
  });
}

describe('periodBounds', () => {
  it('week: the week containing the date, from weekStartsOn', () => {
    expect(periodBounds('week', local(2026, 11, 19, 12), 6)).toEqual({ from: local(2026, 11, 14), to: local(2026, 11, 21) });
    expect(periodBounds('week', local(2026, 11, 19, 12), 1)).toEqual({ from: local(2026, 11, 16), to: local(2026, 11, 23) });
  });

  it('month: the first of the month to the first of the next', () => {
    expect(periodBounds('month', local(2026, 11, 19, 12), 6)).toEqual({ from: local(2026, 11, 1), to: local(2026, 12, 1) });
    expect(periodBounds('month', local(2026, 2, 28, 23), 6)).toEqual({ from: local(2026, 2, 1), to: local(2026, 3, 1) });
  });

  it('year: January 1 to January 1, including a leap year', () => {
    expect(periodBounds('year', local(2026, 6, 1), 6)).toEqual({ from: local(2026, 1, 1), to: local(2027, 1, 1) });
    expect(periodBounds('year', local(2028, 12, 31, 23), 6)).toEqual({ from: local(2028, 1, 1), to: local(2029, 1, 1) });
  });

  it('a December month and a week over New Year end in the new year', () => {
    expect(periodBounds('month', local(2026, 12, 31, 23, 59), 6).to).toBe(local(2027, 1, 1));
    // Thursday 31 Dec 2026, weeks from Monday: Mon 28 Dec to Mon 4 Jan.
    expect(periodBounds('week', local(2026, 12, 31, 12), 1)).toEqual({ from: local(2026, 12, 28), to: local(2027, 1, 4) });
  });
});

describe('shiftPeriod', () => {
  it('moves by whole periods and returns the start of the new period', () => {
    expect(shiftPeriod('week', local(2026, 11, 19, 12), -1, 6)).toBe(local(2026, 11, 7));
    expect(shiftPeriod('week', local(2026, 11, 19, 12), 1, 6)).toBe(local(2026, 11, 21));
    expect(shiftPeriod('month', local(2026, 1, 31, 12), -1, 6)).toBe(local(2025, 12, 1));
    expect(shiftPeriod('month', local(2026, 1, 31, 12), 1, 6)).toBe(local(2026, 2, 1));
    expect(shiftPeriod('year', local(2026, 7, 4), -1, 6)).toBe(local(2025, 1, 1));
  });

  it('crosses a year boundary', () => {
    expect(shiftPeriod('month', local(2026, 12, 15), 1, 6)).toBe(local(2027, 1, 1));
    expect(shiftPeriod('week', local(2026, 12, 29), 1, 1)).toBe(local(2027, 1, 4));
  });

  inZone('America/New_York', () => {
    it('steps a week across the spring-forward change without drifting off midnight', () => {
      // Sat 7 Mar 2026 is the week start; the clocks change on Sun 8 Mar.
      expect(shiftPeriod('week', local(2026, 3, 10, 12), -1, 6)).toBe(local(2026, 2, 28));
      expect(shiftPeriod('week', local(2026, 2, 28), 1, 6)).toBe(local(2026, 3, 7));
      expect(shiftPeriod('week', local(2026, 3, 7), 1, 6)).toBe(local(2026, 3, 14));
    });
  });
});

describe('canGoNext and isCurrentPeriod', () => {
  const now = local(2026, 11, 19, 12);
  it('cannot go past the current period', () => {
    expect(canGoNext('week', local(2026, 11, 14), now, 6)).toBe(false);
    expect(canGoNext('week', local(2026, 11, 7), now, 6)).toBe(true);
    expect(canGoNext('month', local(2026, 11, 1), now, 6)).toBe(false);
    expect(canGoNext('month', local(2026, 10, 1), now, 6)).toBe(true);
    expect(canGoNext('year', local(2026, 1, 1), now, 6)).toBe(false);
    expect(canGoNext('year', local(2025, 1, 1), now, 6)).toBe(true);
  });

  it('is current only for the period that holds now', () => {
    expect(isCurrentPeriod('week', local(2026, 11, 18), now, 6)).toBe(true);
    expect(isCurrentPeriod('week', local(2026, 11, 7), now, 6)).toBe(false);
    expect(isCurrentPeriod('month', local(2026, 11, 30), now, 6)).toBe(true);
    expect(isCurrentPeriod('year', local(2025, 12, 31), now, 6)).toBe(false);
  });
});

describe('gridColumns', () => {
  const cells = (cols: ReturnType<typeof gridColumns>) => cols.flat().filter((c) => c.day !== null);

  it('month: weeks are columns, the first row is weekStartsOn, other days are blank padding', () => {
    const cols = gridColumns('month', local(2026, 11, 19), 6);
    expect(cols).toHaveLength(5);
    expect(cols.every((c) => c.length === 7)).toBe(true);
    // Sun 1 Nov is the second row of a Saturday-first week; Sat 31 Oct belongs to October.
    expect(cols[0].map((c) => c.day)).toEqual([null, '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']);
    expect(cols[4].map((c) => c.day)).toEqual(['2026-11-28', '2026-11-29', '2026-11-30', null, null, null, null]);
    expect(cells(cols)).toHaveLength(30);
  });

  it('month: a Monday-first month that starts on a Sunday needs six columns', () => {
    const cols = gridColumns('month', local(2026, 11, 19), 1);
    expect(cols).toHaveLength(6);
    expect(cols[0].map((c) => c.day)).toEqual([null, null, null, null, null, null, '2026-11-01']);
  });

  it('month: row i is always the weekday weekStartsOn + i', () => {
    for (const ws of [0, 1, 6] as const) {
      for (const col of gridColumns('month', local(2026, 2, 10), ws)) {
        col.forEach((c, i) => {
          if (c.day === null) return;
          const [y, m, d] = c.day.split('-').map(Number);
          expect(new Date(y, m - 1, d).getDay()).toBe((ws + i) % 7);
        });
      }
    }
  });

  it('year 2026 with Saturday weeks has 53 columns and 365 days', () => {
    const cols = gridColumns('year', local(2026, 6, 1), 6);
    expect(cols).toHaveLength(53);
    expect(cells(cols)).toHaveLength(365);
    // Thu 1 Jan is the sixth row of the Sat 27 Dec week.
    expect(cols[0].map((c) => c.day)).toEqual([null, null, null, null, null, '2026-01-01', '2026-01-02']);
    expect(cols[52].map((c) => c.day)).toEqual(['2026-12-26', '2026-12-27', '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', null]);
  });

  it('a year has 52 to 54 columns: a common year can fit 52, a leap year can need 54', () => {
    // 2027 starts on a Friday and ends on a Friday.
    expect(gridColumns('year', local(2027, 3, 1), 1)).toHaveLength(53);
    // 2023 starts and ends on a Sunday.
    expect(gridColumns('year', local(2023, 3, 1), 0)).toHaveLength(53);
    // 2028 is a leap year starting on a Saturday and ending on a Sunday: Sunday-first weeks need 54.
    const leap = gridColumns('year', local(2028, 5, 1), 0);
    expect(leap).toHaveLength(54);
    expect(cells(leap)).toHaveLength(366);
  });

  it('every day appears exactly once, in order, with no DST gap or repeat', () => {
    for (const range of [['month', local(2026, 3, 15)], ['year', local(2026, 3, 15)], ['month', local(2026, 11, 15)]] as const) {
      const days = cells(gridColumns(range[0], range[1], 6)).map((c) => c.day!);
      const { from, to } = periodBounds(range[0], range[1], 6);
      const expected: string[] = [];
      for (let t = new Date(from); t.getTime() < to; t = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1)) expected.push(dayKey(t.getTime()));
      // Column-major order is chronological.
      expect(days).toEqual(expected);
    }
  });

  inZone('America/New_York', () => {
    it('March 2026 across the clock change has 31 distinct days', () => {
      const days = cells(gridColumns('month', local(2026, 3, 15), 6)).map((c) => c.day);
      expect(days).toHaveLength(31);
      expect(new Set(days).size).toBe(31);
    });

    it('the whole year has 365 distinct days', () => {
      expect(new Set(cells(gridColumns('year', local(2026, 3, 15), 0)).map((c) => c.day)).size).toBe(365);
    });
  });
});

describe('intensityLevel', () => {
  it('is 0 for nothing and for an empty period, never NaN', () => {
    expect(intensityLevel(0, 100)).toBe(0);
    expect(intensityLevel(0, 0)).toBe(0);
    expect(intensityLevel(5, 0)).toBe(0);
    expect(intensityLevel(Number.NaN, 10)).toBe(0);
  });

  it('splits 1-25 / 26-50 / 51-75 / 76-100 percent of the maximum at exact boundaries', () => {
    const level = (v: number) => intensityLevel(v, 100);
    expect([1, 25].map(level)).toEqual([1, 1]);
    expect([26, 50].map(level)).toEqual([2, 2]);
    expect([51, 75].map(level)).toEqual([3, 3]);
    expect([76, 100].map(level)).toEqual([4, 4]);
  });

  it('is exact for values that are not percentages', () => {
    expect(intensityLevel(1, 4)).toBe(1);
    expect(intensityLevel(2, 4)).toBe(2);
    expect(intensityLevel(3, 4)).toBe(3);
    expect(intensityLevel(0.75, 3)).toBe(1);
    expect(intensityLevel(0.76, 3)).toBe(2);
    expect(intensityLevel(7, 7)).toBe(4);
  });
});

describe('dayLabel', () => {
  it('reads weekday, day and month in that order', () => {
    expect(dayLabel('2026-11-14', 'en-US')).toBe('Sat 14 Nov');
    expect(dayLabel('2026-01-01', 'en-GB')).toBe('Thu 1 Jan');
  });
});

describe('categoryHue', () => {
  it('cycles through eight hues by order', () => {
    expect(categoryHue(0)).toBe(1);
    expect(categoryHue(7)).toBe(8);
    expect(categoryHue(8)).toBe(1);
    expect(categoryHue(11)).toBe(4);
    expect(categoryHue(-1)).toBe(8);
  });
});

describe('heatmapDays', () => {
  const range = { from: local(2026, 11, 1), to: local(2026, 12, 1) };
  const categories = [cat('fiqh', 0), cat('history', 1)];
  const books = [
    book({ id: 'a', categoryIds: ['fiqh'] }),
    book({ id: 'b', categoryIds: ['history'] }),
    book({ id: 'c', categoryIds: [] }),
    book({ id: 'both', categoryIds: ['history', 'fiqh'] }),
  ];
  const find = (days: ReturnType<typeof heatmapDays>, day: string) => days.find((d) => d.day === day);

  it('counts unique pages per book and day, or minutes, and sorts by day', () => {
    const sessions = [
      session({ id: 's2', bookId: 'a', startedAt: local(2026, 11, 5, 9), pagesRead: [1, 2, 3], activeMs: 20 * MIN }),
      session({ id: 's1', bookId: 'a', startedAt: local(2026, 11, 3, 9), pagesRead: [7], activeMs: 5 * MIN }),
      session({ id: 's3', bookId: 'a', startedAt: local(2026, 11, 5, 20), pagesRead: [3, 4], activeMs: 10 * MIN }),
    ];
    const pages = heatmapDays(sessions, books, categories, range, 'pages');
    expect(pages.map((d) => [d.day, d.value])).toEqual([['2026-11-03', 1], ['2026-11-05', 4]]);
    const time = heatmapDays(sessions, books, categories, range, 'time');
    expect(time.map((d) => [d.day, d.value])).toEqual([['2026-11-03', 5], ['2026-11-05', 30]]);
  });

  it('colours a day by the category with the most reading time', () => {
    const sessions = [
      session({ id: '1', bookId: 'a', startedAt: local(2026, 11, 5, 9), pagesRead: [1], activeMs: 10 * MIN }),
      session({ id: '2', bookId: 'b', startedAt: local(2026, 11, 5, 11), pagesRead: [1, 2, 3, 4, 5], activeMs: 30 * MIN }),
    ];
    const day = find(heatmapDays(sessions, books, categories, range, 'pages'), '2026-11-05')!;
    // History has the time even though Fiqh is first by order. Value still sums both books.
    expect(day.categoryId).toBe('history');
    expect(day.value).toBe(6);
    expect(day.pages).toBe(6);
    expect(day.ms).toBe(40 * MIN);
    expect(day.bookId).toBe('b');
  });

  it('breaks a time tie towards the earlier category, and puts uncategorized last', () => {
    const tie = [
      session({ id: '1', bookId: 'b', startedAt: local(2026, 11, 5, 9), activeMs: 10 * MIN }),
      session({ id: '2', bookId: 'a', startedAt: local(2026, 11, 5, 11), activeMs: 10 * MIN }),
    ];
    expect(find(heatmapDays(tie, books, categories, range, 'time'), '2026-11-05')!.categoryId).toBe('fiqh');
    const loose = [
      session({ id: '1', bookId: 'c', startedAt: local(2026, 11, 6, 9), activeMs: 10 * MIN }),
      session({ id: '2', bookId: 'b', startedAt: local(2026, 11, 6, 11), activeMs: 10 * MIN }),
    ];
    expect(find(heatmapDays(loose, books, categories, range, 'time'), '2026-11-06')!.categoryId).toBe('history');
  });

  it('gives a book with no live category the neutral null category', () => {
    const sessions = [session({ id: '1', bookId: 'c', startedAt: local(2026, 11, 5, 9) })];
    expect(find(heatmapDays(sessions, books, categories, range, 'time'), '2026-11-05')!.categoryId).toBeNull();
    // A deleted category is not live: only the live list is passed in.
    const orphan = [book({ id: 'o', categoryIds: ['gone'] })];
    const s = [session({ id: '1', bookId: 'o', startedAt: local(2026, 11, 5, 9) })];
    expect(find(heatmapDays(s, orphan, categories, range, 'time'), '2026-11-05')!.categoryId).toBeNull();
  });

  it('counts a book in several categories toward the first by order, whatever its own list order', () => {
    const sessions = [session({ id: '1', bookId: 'both', startedAt: local(2026, 11, 5, 9) })];
    expect(find(heatmapDays(sessions, books, categories, range, 'time'), '2026-11-05')!.categoryId).toBe('fiqh');
  });

  it('leaves out deleted sessions, sessions outside the range, bad numbers and sessions of unknown books', () => {
    const sessions = [
      session({ id: '1', bookId: 'a', startedAt: local(2026, 11, 5, 9), deleted: true }),
      session({ id: '2', bookId: 'a', startedAt: local(2026, 10, 31, 23, 59) }),
      session({ id: '3', bookId: 'a', startedAt: local(2026, 12, 1, 0, 0) }),
      session({ id: '4', bookId: 'a', startedAt: local(2026, 11, 7, 9), activeMs: Number.NaN }),
      session({ id: '5', bookId: 'nobody', startedAt: local(2026, 11, 8, 9) }),
      session({ id: '6', bookId: 'a', startedAt: local(2026, 11, 30, 23, 59), pagesRead: [1] }),
    ];
    expect(heatmapDays(sessions, books, categories, range, 'pages').map((d) => d.day)).toEqual(['2026-11-30']);
  });

  it('assigns a session to the day it started, even when it runs past midnight', () => {
    const sessions = [session({ id: '1', bookId: 'a', startedAt: local(2026, 11, 30, 23, 50), activeMs: 30 * MIN, pagesRead: [1] })];
    expect(heatmapDays(sessions, books, categories, range, 'time').map((d) => d.day)).toEqual(['2026-11-30']);
  });

  it('filters by category membership and colours every day with that category', () => {
    const sessions = [
      session({ id: '1', bookId: 'both', startedAt: local(2026, 11, 5, 9), pagesRead: [1] }),
      session({ id: '2', bookId: 'a', startedAt: local(2026, 11, 6, 9), pagesRead: [1] }),
      session({ id: '3', bookId: 'c', startedAt: local(2026, 11, 7, 9), pagesRead: [1] }),
    ];
    const days = heatmapDays(sessions, books, categories, range, 'pages', { categoryId: 'history' });
    expect(days.map((d) => [d.day, d.categoryId])).toEqual([['2026-11-05', 'history']]);
  });

  it('filters to uncategorized books, and to one book', () => {
    const sessions = [
      session({ id: '1', bookId: 'c', startedAt: local(2026, 11, 5, 9), pagesRead: [1] }),
      session({ id: '2', bookId: 'a', startedAt: local(2026, 11, 6, 9), pagesRead: [1] }),
      session({ id: '3', bookId: 'b', startedAt: local(2026, 11, 7, 9), pagesRead: [1] }),
    ];
    expect(heatmapDays(sessions, books, categories, range, 'pages', { categoryId: '__uncategorized__' }).map((d) => d.day)).toEqual(['2026-11-05']);
    expect(heatmapDays(sessions, books, categories, range, 'pages', { bookId: 'b' }).map((d) => [d.day, d.categoryId, d.bookId])).toEqual([['2026-11-07', 'history', 'b']]);
  });

  it('returns nothing for no sessions, never NaN', () => {
    expect(heatmapDays([], books, categories, range, 'pages')).toEqual([]);
    const only = [session({ id: '1', bookId: 'a', startedAt: local(2026, 11, 5, 9), pagesRead: [], activeMs: 0 })];
    const [day] = heatmapDays(only, books, categories, range, 'pages');
    expect(day.value).toBe(0);
    expect(Number.isNaN(day.value)).toBe(false);
  });
});

describe('neighbourDay', () => {
  const nov = periodBounds('month', local(2026, 11, 10), 1);
  it('steps a day forward and back', () => {
    expect(neighbourDay('2026-11-10', 1, nov)).toBe('2026-11-11');
    expect(neighbourDay('2026-11-10', -1, nov)).toBe('2026-11-09');
  });
  it('is null past the first or last day of the period', () => {
    expect(neighbourDay('2026-11-01', -1, nov)).toBeNull();
    expect(neighbourDay('2026-11-30', 1, nov)).toBeNull();
    expect(neighbourDay('2026-11-30', -1, nov)).toBe('2026-11-29');
  });
  it('crosses a year edge only inside the period', () => {
    const year = periodBounds('year', local(2026, 6, 1), 1);
    expect(neighbourDay('2026-12-31', 1, year)).toBeNull();
    expect(neighbourDay('2026-03-01', -1, year)).toBe('2026-02-28');
  });
});
