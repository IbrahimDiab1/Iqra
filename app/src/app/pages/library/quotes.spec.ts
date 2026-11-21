import { describe, expect, it } from 'vitest';
import { QUOTES, QUOTE_MAX, quoteOfTheDay } from './quotes';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();

describe('quoteOfTheDay', () => {
  it('keeps every built-in quote short', () => {
    for (const q of QUOTES) expect(q.length).toBeLessThanOrEqual(QUOTE_MAX);
  });
  it('is the same all day and changes the next day', () => {
    expect(quoteOfTheDay(at(2026, 11, 20, 0))).toBe(quoteOfTheDay(at(2026, 11, 20, 23)));
    expect(quoteOfTheDay(at(2026, 11, 20))).not.toBe(quoteOfTheDay(at(2026, 11, 21)));
  });
  it('rotates through the whole list', () => {
    const seen = new Set(Array.from({ length: QUOTES.length }, (_, i) => quoteOfTheDay(at(2026, 1, 1 + i))));
    expect(seen.size).toBe(QUOTES.length);
  });
});
