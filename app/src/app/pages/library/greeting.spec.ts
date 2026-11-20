import { describe, expect, it } from 'vitest';
import { currentStreak, firstName, welcomeStats } from './greeting';
import type { ReadingSession } from '../../core/models';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();

function session(startedAt: number, activeMs = 60_000, pages = [1]): ReadingSession {
  return { id: `s${startedAt}`, updatedAt: 0, deviceId: 'd', bookId: 'b', startedAt, activeMs, pagesRead: pages } as unknown as ReadingSession;
}

describe('firstName', () => {
  it('takes the first word of the name and falls back to nothing', () => {
    expect(firstName('Ada Lovelace')).toBe('Ada');
    expect(firstName('  Ada  ')).toBe('Ada');
    expect(firstName('محمد علي')).toBe('محمد');
    expect(firstName('')).toBe('');
    expect(firstName(undefined)).toBe('');
  });
});

describe('currentStreak', () => {
  const now = at(2026, 11, 20, 10);
  it('is 0 with no reading', () => expect(currentStreak([], now)).toBe(0));
  it('counts consecutive days ending today', () => {
    const s = [session(at(2026, 11, 20)), session(at(2026, 11, 19)), session(at(2026, 11, 18, 23))];
    expect(currentStreak(s, now)).toBe(3);
  });
  it('keeps the streak alive when today has no reading yet', () => {
    expect(currentStreak([session(at(2026, 11, 19)), session(at(2026, 11, 18))], now)).toBe(2);
  });
  it('is 0 when the last reading day is older than yesterday', () => {
    expect(currentStreak([session(at(2026, 11, 17))], now)).toBe(0);
  });
  it('stops at a gap and ignores empty days and deleted sessions', () => {
    const s = [session(at(2026, 11, 20)), session(at(2026, 11, 18)), session(at(2026, 11, 19), 0, [])];
    expect(currentStreak(s, now)).toBe(1);
    expect(currentStreak([{ ...session(at(2026, 11, 20)), deleted: true } as ReadingSession], now)).toBe(0);
  });
});

describe('welcomeStats', () => {
  it('gives the streak, all-time time and finished books', () => {
    const r = welcomeStats([session(at(2026, 11, 20), 90 * 60_000), session(at(2026, 11, 19), 30 * 60_000)], 2, at(2026, 11, 20));
    expect(r).toEqual({ streak: 2, ms: 120 * 60_000, finished: 2 });
  });
});
