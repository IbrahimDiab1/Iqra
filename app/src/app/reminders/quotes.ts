export interface QuoteOptions {
  source: 'highlights' | 'builtin' | 'both';
  custom: string[];
  highlights: { quote: string; bookTitle: string; page: number }[];
  builtin: string[];
  seed: number;
}

const MIN_HIGHLIGHT = 20;
const MAX_HIGHLIGHT = 280;

/** Picks one line for a reminder. The same seed always gives the same line. */
export function pickQuote(o: QuoteOptions): { text: string; source?: string } {
  const custom = o.custom.map((c) => c.trim()).filter(Boolean).map((text) => ({ text }));
  const highlights = o.highlights
    .filter((h) => h.quote.length >= MIN_HIGHLIGHT && h.quote.length <= MAX_HIGHLIGHT)
    .map((h) => ({ text: h.quote, source: `${h.bookTitle}, p. ${h.page}` }));
  const builtin = o.builtin.map((text) => ({ text }));
  const pool: { text: string; source?: string }[] =
    o.source === 'highlights' ? [...highlights, ...custom] : o.source === 'builtin' ? [...builtin, ...custom] : [...highlights, ...builtin, ...custom];
  const chosen = pool.length ? pool : builtin;
  if (!chosen.length) return { text: '' };
  const index = ((Math.trunc(o.seed) % chosen.length) + chosen.length) % chosen.length;
  return chosen[index];
}
