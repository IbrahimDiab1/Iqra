import { describe, expect, it } from 'vitest';
import { currentStreak, firstName, statLines, welcomeStats } from './greeting';
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

describe('statLines', () => {
  const now = at(2026, 11, 18, 15); // Wednesday
  const base = { books: [{ id: 'b', categoryIds: [] }] as never, categories: [], goals: [], finished: 0, now, weekStartsOn: 6 as const };
  const goal = (over: object) => ({ id: 'g', updatedAt: 0, deviceId: 'd', categoryId: null, measure: 'pages', target: 10, ...over }) as never;
  const sessions = [session(at(2026, 11, 18, 9), 30 * 60_000, [1, 2, 3]), session(at(2026, 11, 16, 9), 60 * 60_000, [4, 5])];

  it('with no goal and no finished book: today time, today pages, all-time pages, all-time time', () => {
    expect(statLines({ ...base, sessions })).toEqual(['30 min read today', '3 pages today', '5 pages read in total', '1 h 30 min read in total']);
  });
  it('says what is left of the nearest unreached goal, day before week before month', () => {
    const goals = [goal({ id: 'm', period: 'month', target: 100 }), goal({ id: 'w', period: 'week', target: 20 }), goal({ id: 'd', period: 'day', target: 10 })];
    expect(statLines({ ...base, sessions, goals })[2]).toBe('7 pages to go today');
    expect(statLines({ ...base, sessions, goals: goals.slice(0, 2) })[2]).toBe('15 pages to go this week');
    expect(statLines({ ...base, sessions, goals: goals.slice(0, 1) })[2]).toBe('95 pages to go this month');
  });
  it('moves on to the next period when the day goal is reached, words time goals, and says Goal reached when all are', () => {
    const done = goal({ id: 'd', period: 'day', target: 3 });
    const week = goal({ id: 'w', period: 'week', measure: 'time', target: 120 });
    expect(statLines({ ...base, sessions, goals: [done, week] })[2]).toBe('30 min to go this week');
    expect(statLines({ ...base, sessions, goals: [done] })[2]).toBe('Goal reached');
  });
  it('treats a goal without a period as weekly and skips goals of a deleted category', () => {
    expect(statLines({ ...base, sessions, goals: [goal({ target: 12 })] })[2]).toBe('7 pages to go this week');
    expect(statLines({ ...base, sessions, goals: [goal({ categoryId: 'gone' })] })).toHaveLength(4);
  });
  it('ends with books finished only when there are some', () => {
    expect(statLines({ ...base, sessions, finished: 2 }).at(-1)).toBe('2 books finished');
  });
});
