import { describe, expect, it } from 'vitest';
import { dayKey, formatRange, weekRange, weekStart } from './week';

const local = (y: number, month: number, d: number, h = 0, min = 0) => new Date(y, month - 1, d, h, min).getTime();

describe('dayKey', () => {
  it('formats the local day as YYYY-MM-DD', () => {
    expect(dayKey(local(2026, 11, 5, 23, 59))).toBe('2026-11-05');
  });
});

describe('weekStart', () => {
  it('starts on Saturday when weekStartsOn is 6', () => {
    expect(weekStart(local(2026, 11, 18, 12), 6)).toBe(local(2026, 11, 14));
  });

  it('starts on Monday when weekStartsOn is 1', () => {
    expect(weekStart(local(2026, 11, 18, 12), 1)).toBe(local(2026, 11, 16));
  });

  it('starts on Sunday when weekStartsOn is 0', () => {
    expect(weekStart(local(2026, 11, 18, 12), 0)).toBe(local(2026, 11, 15));
  });
});

describe('weekRange', () => {
  it('returns seven consecutive local day keys and an exclusive end at the next week start', () => {
    const range = weekRange(local(2026, 11, 18, 12), 6);
    expect(range.from).toBe(local(2026, 11, 14));
    expect(range.to).toBe(local(2026, 11, 21));
    expect(range.days).toEqual([
      '2026-11-14',
      '2026-11-15',
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
    ]);
  });

  it('gives seven distinct day keys across a DST change week', () => {
    const range = weekRange(local(2026, 3, 10, 12), 6);
    expect(range.days).toHaveLength(7);
    expect(new Set(range.days).size).toBe(7);
  });
});

describe('formatRange', () => {
  it('shows a range within one month', () => {
    expect(formatRange(local(2026, 11, 14), local(2026, 11, 21), 'en-US')).toBe('Nov 14 – 20');
  });

  it('shows both months for a range across a month boundary', () => {
    expect(formatRange(local(2026, 11, 28), local(2026, 12, 5), 'en-US')).toBe('Nov 28 – Dec 4');
  });
});
