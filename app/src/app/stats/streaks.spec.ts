import { describe, expect, it } from 'vitest';
import type { Book, ReadingSession } from '../core/models';
import { allTime, streaks } from './streaks';

const at = (m: number, d: number, h = 10) => new Date(2026, m - 1, d, h).getTime();
const NOW = at(11, 19, 12);
function s(id: string, startedAt: number, pages: number[] = [1], activeMs = 600_000, bookId = 'b1'): ReadingSession {
  return { id, deviceId: 'd', updatedAt: 1, bookId, startedAt, endedAt: startedAt + activeMs, activeMs, pagesRead: pages };
}

describe('streaks', () => {
  it('is zero with no reading', () => {
    expect(streaks([], NOW)).toEqual({ current: 0, longest: 0 });
  });
  it('counts consecutive days ending today', () => {
    expect(streaks([s('a', at(11, 17)), s('b', at(11, 18)), s('c', at(11, 19, 8))], NOW)).toEqual({ current: 3, longest: 3 });
  });
  it('keeps the streak alive when today is still empty but yesterday was read', () => {
    expect(streaks([s('a', at(11, 17)), s('b', at(11, 18))], NOW).current).toBe(2);
  });
  it('breaks after a missed day, and keeps the longest', () => {
    const r = streaks([s('a', at(11, 1)), s('b', at(11, 2)), s('c', at(11, 3)), s('d', at(11, 4)), s('e', at(11, 10))], NOW);
    expect(r).toEqual({ current: 0, longest: 4 });
  });
  it('several sessions on one day count once; deleted sessions are ignored', () => {
    const del = { ...s('x', at(11, 18)), deleted: true };
    expect(streaks([s('a', at(11, 19, 1)), s('b', at(11, 19, 5)), del], NOW)).toEqual({ current: 1, longest: 1 });
  });
  it('is safe across a DST change', () => {
    const now = new Date(2026, 2, 9, 12).getTime();
    const days = [7, 8, 9].map((d) => s(`d${d}`, new Date(2026, 2, d, 10).getTime()));
    expect(streaks(days, now).current).toBe(3);
  });
});

describe('allTime', () => {
  const books = [{ id: 'b1', status: 'finished' }, { id: 'b2', status: 'reading' }, { id: 'b3', status: 'to-read' }, { id: 'b4', status: 'paused', deleted: true }] as Book[];
  it('sums time and pages, and counts started and finished books', () => {
    const r = allTime([s('a', at(11, 1), [1, 2], 60_000, 'b1'), s('b', at(11, 2), [1], 120_000, 'b2')], books);
    expect(r).toEqual({ ms: 180_000, pages: 3, started: 2, finished: 1 });
  });
  it('is zero for nothing', () => {
    expect(allTime([], [])).toEqual({ ms: 0, pages: 0, started: 0, finished: 0 });
  });
});
