import { describe, expect, it } from 'vitest';
import { formatAvg, formatDuration } from './format';

describe('format', () => {
  it('formats durations', () => {
    expect(formatDuration(3_900_000)).toBe('1 h 05 min');
    expect(formatDuration(0)).toBe('0 min');
    expect(formatDuration(45 * 60_000)).toBe('45 min');
    expect(formatDuration(-5)).toBe('0 min');
    expect(formatDuration(Number.NaN)).toBe('0 min');
    expect(formatDuration(2 * 3_600_000)).toBe('2 h 00 min');
  });

  it('formats the average per page as m:ss', () => {
    expect(formatAvg(75_000)).toBe('1:15');
    expect(formatAvg(0)).toBe('0:00');
    expect(formatAvg(Number.NaN)).toBe('0:00');
    expect(formatAvg(9_000)).toBe('0:09');
  });
});
