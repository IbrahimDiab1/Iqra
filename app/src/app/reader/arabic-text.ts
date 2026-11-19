/**
 * Arabic-aware text handling for search and selection: spelling normalisation, the fallbacks for text that a PDF
 * stores in an awkward order, and the reading order of a page's text items. Pure; no Angular.
 */

/** The item fields this module reads (a pdf.js text item). */
export interface OrderedItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
}

/** Latin combining marks, Arabic small signs, tatweel, harakat and Quranic marks (never part of a letter's identity). */
const STRIPPED = /[\u0300-\u036F\u0610-\u061A\u0640\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06ED]/;
/** Direction marks, embeddings, isolates, zero-width characters and the byte-order mark: invisible, so they never block a match. */
const IGNORED = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\u061C\uFEFF]/;
/** Letters folded to a single form so that spelling variants match. */
const FOLDED: Record<string, string> = {
  'أ': 'ا', // أ -> ا
  'إ': 'ا', // إ -> ا
  'آ': 'ا', // آ -> ا
  'ٱ': 'ا', // ٱ -> ا
  'ى': 'ي', // ى -> ي
  'ی': 'ي', // Persian ya -> ya
  'ة': 'ه', // ة -> ه
  'ک': 'ك', // Persian kaf -> kaf
};
const ARABIC_INDIC_ZERO = 0x0660;
const PERSIAN_ZERO = 0x06f0;

/** Any Arabic-script letter, presentation forms included. */
export const ARABIC_LETTER = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
/** Letters of the right-to-left scripts a reader meets (Arabic and Hebrew). */
const RTL_LETTER = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

function foldChar(c: string): string {
  const folded = FOLDED[c];
  if (folded) return folded;
  const code = c.charCodeAt(0);
  if (c.length === 1) {
    if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9) return String(code - ARABIC_INDIC_ZERO);
    if (code >= PERSIAN_ZERO && code <= PERSIAN_ZERO + 9) return String(code - PERSIAN_ZERO);
  }
  return c;
}

/**
 * Lowercases, turns presentation forms and ligatures into base letters (NFKD), strips marks and invisible characters,
 * folds spelling variants and digit scripts, and collapses whitespace.
 * `map[i]` is the index in `s` of normalized character `i`; several outputs of one source character (a ligature) share it.
 */
export function normalizeWithMap(s: string): { text: string; map: number[] } {
  let text = '';
  const map: number[] = [];
  let index = 0;
  let lastWasSpace = false;
  for (const ch of s) {
    const at = index;
    index += ch.length;
    if (IGNORED.test(ch)) continue;
    if (/\s/.test(ch)) {
      if (!lastWasSpace) {
        text += ' ';
        map.push(at);
        lastWasSpace = true;
      }
      continue;
    }
    lastWasSpace = false;
    for (const part of ch.normalize('NFKD')) {
      if (STRIPPED.test(part)) continue;
      for (const out of foldChar(part.toLowerCase())) {
        text += out;
        map.push(at);
      }
    }
  }
  return { text, map };
}

/** The words of a line in the opposite order. */
export function reverseWords(s: string): string {
  return s.trim().split(/\s+/).reverse().join(' ');
}

type Normalized = { text: string; map: number[] };

/** Non-overlapping occurrences of an already normalised `needle`, as ranges in the original text. */
function scan(n: Normalized, original: string, needle: string, max: number): { index: number; length: number }[] {
  const out: { index: number; length: number }[] = [];
  let from = 0;
  while (out.length < max) {
    const found = n.text.indexOf(needle, from);
    if (found < 0) break;
    const last = found + needle.length - 1;
    // A source character that became several letters (a ligature) is taken whole, even when the match ends inside it.
    let after = last + 1;
    while (after < n.map.length && n.map[after] === n.map[last]) after++;
    // The match ends where the next kept character begins, so trailing marks are included.
    const end = after < n.map.length ? n.map[after] : original.length;
    out.push({ index: n.map[found], length: end - n.map[found] });
    from = last + 1;
  }
  return out;
}

/** Occurrences found with the spaces ignored on both sides: for a word the PDF cut into several text items. */
function scanDespaced(n: Normalized, original: string, needle: string, max: number): { index: number; length: number }[] {
  const flat = needle.replace(/ /g, '');
  if (flat.length < 2) return [];
  let text = '';
  const at: number[] = [];
  for (let i = 0; i < n.text.length; i++) {
    if (n.text[i] === ' ') continue;
    text += n.text[i];
    at.push(i);
  }
  const out: { index: number; length: number }[] = [];
  let from = 0;
  while (out.length < max) {
    const found = text.indexOf(flat, from);
    if (found < 0) break;
    const first = at[found];
    const last = at[found + flat.length - 1];
    let after = last + 1;
    while (after < n.map.length && n.map[after] === n.map[last]) after++;
    const end = after < n.map.length ? n.map[after] : original.length;
    out.push({ index: n.map[first], length: end - n.map[first] });
    from = found + flat.length;
  }
  return out;
}

/**
 * Non-overlapping matches of `query` in `pageText`, as indexes and lengths in the original text.
 * For an Arabic query that finds nothing it also tries the query's words in reverse order (a page whose items were
 * written left to right) and then the query with spaces ignored (a word split across items).
 */
export function findMatches(pageText: string, query: string, max = Number.POSITIVE_INFINITY): { index: number; length: number }[] {
  const needle = normalizeWithMap(query.trim()).text;
  if (needle.length < 2) return [];
  const normalized = normalizeWithMap(pageText);
  let hits = scan(normalized, pageText, needle, max);
  if (hits.length > 0 || !ARABIC_LETTER.test(needle)) return hits;
  if (needle.includes(' ')) {
    hits = scan(normalized, pageText, reverseWords(needle), max);
    if (hits.length > 0) return hits;
  }
  return scanDespaced(normalized, pageText, needle, max);
}

type Direction = 'rtl' | 'ltr' | 'neutral';

/** The direction an item reads in: by its letters (majority), neutral when it has none (spaces, digits, punctuation). */
function directionOf(str: string): Direction {
  let rtl = 0;
  let other = 0;
  for (const ch of str) {
    if (!/\p{L}/u.test(ch)) continue;
    if (RTL_LETTER.test(ch)) rtl++;
    else other++;
  }
  return rtl === 0 && other === 0 ? 'neutral' : rtl >= other ? 'rtl' : 'ltr';
}

/**
 * The items of one right-to-left line in reading order: right to left by x, except that each run of left-to-right items
 * (an English phrase, an English column) keeps its own left-to-right order, with the spaces and numbers between its
 * words. `x` is the item's left edge.
 */
export function readRtlLine<T>(items: readonly T[], strOf: (item: T) => string, xOf: (item: T) => number): T[] {
  const sorted = items.map((item, i) => ({ item, i })).sort((a, b) => xOf(b.item) - xOf(a.item) || a.i - b.i).map((e) => e.item);
  const dirs = sorted.map((it) => directionOf(strOf(it)));
  let i = 0;
  while (i < sorted.length) {
    if (dirs[i] !== 'ltr') {
      i++;
      continue;
    }
    let last = i;
    for (let k = i + 1; k < sorted.length && dirs[k] !== 'rtl'; k++) if (dirs[k] === 'ltr') last = k;
    const run = sorted.slice(i, last + 1).reverse();
    sorted.splice(i, run.length, ...run);
    i = last + 1;
  }
  return sorted;
}

const EPSILON = 1e-3;
const SAME_LINE_FACTOR = 0.5;
const RTL_SHARE = 0.5;

function upright(it: OrderedItem): boolean {
  return Math.abs(it.transform[1]) < EPSILON && Math.abs(it.transform[2]) < EPSILON;
}

function isRtlRun(run: OrderedItem[]): boolean {
  let rtl = 0;
  let letters = 0;
  for (const it of run) {
    for (const ch of it.str) {
      if (!/\p{L}/u.test(ch)) continue;
      letters++;
      if (RTL_LETTER.test(ch)) rtl++;
    }
  }
  return letters > 0 && rtl / letters >= RTL_SHARE;
}

/** The reading order, plus which runs of positions (`[from, to)`) were rearranged. */
function planOrder(items: readonly OrderedItem[]): { order: number[]; moved: [number, number][] } {
  const order = items.map((_, i) => i);
  const moved: [number, number][] = [];
  let start = 0;
  while (start < items.length) {
    const first = items[start];
    let end = start + 1;
    while (
      end < items.length &&
      upright(items[end]) === upright(first) &&
      Math.abs(items[end].transform[5] - first.transform[5]) <= SAME_LINE_FACTOR * (first.height || Math.abs(first.transform[3]) || 1)
    ) {
      end++;
    }
    const slots: number[] = [];
    for (let i = start; i < end; i++) if (items[i].str !== '') slots.push(i);
    if (upright(first) && slots.length > 1 && isRtlRun(slots.map((i) => items[i]))) {
      const sorted = readRtlLine(slots, (i) => items[i].str, (i) => items[i].transform[4]);
      if (sorted.some((old, k) => old !== slots[k])) {
        slots.forEach((slot, k) => (order[slot] = sorted[k]));
        moved.push([start, end]);
      }
    }
    start = end;
  }
  return { order, moved };
}

/**
 * The reading order of a page's text items, as a list of indexes into `items` (`order[new] = old`).
 * pdf.js hands items over in the order the PDF draws them. Many Arabic PDFs draw a line's words left to right, so a
 * right-to-left line arrives backwards. Each run of consecutive items on one baseline that is mostly right-to-left
 * text is put in right-to-left order (by x, stable); everything else, and the order of the lines, is left alone.
 */
export function readingOrder(items: readonly OrderedItem[]): number[] {
  return planOrder(items).order;
}

/**
 * The items in reading order plus the permutation (`order[new] = old`). A line end moves to the new last item of its run,
 * so the page text still breaks the line in the right place. Items that do not change are the very same objects.
 */
export function toReadingOrder<T extends OrderedItem>(items: readonly T[]): { items: T[]; order: number[] } {
  const { order, moved } = planOrder(items);
  const out = order.map((old) => items[old]);
  for (const [from, to] of moved) {
    const hadEol = items.slice(from, to).some((it) => it.hasEOL);
    let lastReal = -1;
    for (let k = from; k < to; k++) if (out[k].str !== '') lastReal = k;
    for (let k = from; k < to; k++) {
      const wants = hadEol && k === lastReal;
      if (!!out[k].hasEOL !== wants) out[k] = { ...out[k], hasEOL: wants };
    }
  }
  return { items: out, order };
}
