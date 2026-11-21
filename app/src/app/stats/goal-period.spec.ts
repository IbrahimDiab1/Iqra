import { describe, expect, it } from 'vitest';
import { goalPeriod, goalRange } from './goal-period';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();

describe('goalPeriod', () => {
  it('uses the goal’s own period, and weekly for goals saved without one', () => {
    expect(goalPeriod({ period: 'day' })).toBe('day');
    expect(goalPeriod({ period: 'month' })).toBe('month');
    expect(goalPeriod({})).toBe('week');
  });
});

describe('goalRange', () => {
  const now = at(2026, 11, 18, 15); // a Wednesday
  it('is the local day', () => expect(goalRange('day', now, 6)).toEqual({ from: at(2026, 11, 18, 0), to: at(2026, 11, 19, 0) }));
  it('is the week from the chosen first day', () => {
    expect(goalRange('week', now, 6)).toEqual({ from: at(2026, 11, 14, 0), to: at(2026, 11, 21, 0) });
    expect(goalRange('week', now, 1)).toEqual({ from: at(2026, 11, 16, 0), to: at(2026, 11, 23, 0) });
  });
  it('is the calendar month', () => expect(goalRange('month', now, 6)).toEqual({ from: at(2026, 11, 1, 0), to: at(2026, 12, 1, 0) }));
});
