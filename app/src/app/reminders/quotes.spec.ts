import { describe, expect, it } from 'vitest';
import { BUILTIN_QUOTES } from './builtin-quotes';
import { pickQuote } from './quotes';

const long = (n: number) => 'x'.repeat(n);
const hl = { quote: 'A highlight that is long enough to use.', bookTitle: 'Dune', page: 11 };

describe('pickQuote', () => {
  const base = { source: 'builtin' as const, custom: [], highlights: [], builtin: ['a', 'b', 'c'], seed: 4 };

  it('is deterministic for a seed', () => {
    expect(pickQuote(base)).toEqual(pickQuote(base));
    expect(pickQuote({ ...base, seed: 5 })).not.toEqual(pickQuote(base));
  });

  it('labels a highlight with its book and page', () => {
    expect(pickQuote({ ...base, source: 'highlights', highlights: [hl] })).toEqual({ text: hl.quote, source: 'Dune, p. 11' });
  });

  it('skips highlights that are too short or too long', () => {
    const r = pickQuote({ ...base, source: 'highlights', highlights: [{ ...hl, quote: long(19) }, { ...hl, quote: long(281) }] });
    expect(['a', 'b', 'c']).toContain(r.text);
    expect(r.source).toBeUndefined();
  });

  it('falls back to the built-in lines when there is nothing else', () => {
    const r = pickQuote({ ...base, source: 'highlights', custom: [] });
    expect(['a', 'b', 'c']).toContain(r.text);
  });

  it('draws from the union for both and includes custom lines', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 5; seed++) seen.add(pickQuote({ ...base, source: 'both', custom: ['mine'], highlights: [hl], seed }).text);
    expect(seen).toEqual(new Set([hl.quote, 'a', 'b', 'c', 'mine']));
  });

  it('uses custom lines with the built-in source', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 4; seed++) seen.add(pickQuote({ ...base, custom: ['mine'], seed }).text);
    expect(seen.has('mine')).toBe(true);
  });
});

describe('BUILTIN_QUOTES', () => {
  it('has 40 short distinct lines', () => {
    expect(BUILTIN_QUOTES).toHaveLength(40);
    expect(new Set(BUILTIN_QUOTES).size).toBe(40);
    expect(BUILTIN_QUOTES.every((q) => q.length > 0 && q.length <= 120)).toBe(true);
  });
});
