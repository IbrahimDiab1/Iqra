import type { HighlightColor } from '../annotations/annotation.service';

export interface Run {
  text: string;
  annotationId?: string;
  color?: HighlightColor;
  underline?: boolean;
  dot?: boolean;
}

export interface RunMark {
  id: string;
  quote: string;
  color?: HighlightColor;
  underline: boolean;
  hasDetail: boolean;
}

/** Shortest piece of a quote that may be highlighted at a paragraph edge, and a whole paragraph inside a quote. */
const MIN_EDGE_CHARS = 3;
const MIN_MIDDLE_CHARS = 8;

interface Range {
  start: number;
  end: number;
  mark: RunMark;
  /** False for the head or middle of a quote that continues in a later paragraph. */
  last: boolean;
}

/** The characters of `s` without whitespace, each with its index in `s`. */
function stripped(s: string): { text: string; map: number[] } {
  let text = '';
  const map: number[] = [];
  for (let i = 0; i < s.length; i++) {
    if (/\s/.test(s[i])) continue;
    text += s[i];
    map.push(i);
  }
  return { text, map };
}

const strip = (s: string) => s.replace(/\s+/g, '');
const NOT_WORD = /[^\p{L}\p{N}\p{M}]/u;
const atWordStart = (s: string, i: number) => i === 0 || NOT_WORD.test(s[i - 1]);
const atWordEnd = (s: string, i: number) => i >= s.length || NOT_WORD.test(s[i]);
const overlaps = (taken: Range[], start: number, end: number) => taken.some((r) => start < r.end && end > r.start);

/** The first occurrence of the quote, whitespace ignored, that does not overlap an earlier range. */
function findFull(flat: ReturnType<typeof stripped>, needle: string, taken: Range[]): [number, number] | null {
  for (let from = 0; ; ) {
    const at = flat.text.indexOf(needle, from);
    if (at < 0) return null;
    const start = flat.map[at];
    const end = flat.map[at + needle.length - 1] + 1;
    if (!overlaps(taken, start, end)) return [start, end];
    from = at + 1;
  }
}

/**
 * A quote that continues past this paragraph's end (its head here), begins before its start (its tail here),
 * or covers it entirely. Pieces are cut at the quote's word boundaries, the longest piece wins.
 */
function findPartial(
  text: string,
  flat: ReturnType<typeof stripped>,
  quote: string,
  taken: Range[],
): { range: [number, number]; last: boolean } | null {
  const words = quote.split(/\s+/).filter((w) => w !== '');
  let best: { range: [number, number]; last: boolean; len: number } | null = null;
  for (let i = words.length - 1; i >= 1; i--) {
    const head = strip(words.slice(0, i).join(' '));
    if (head.length < MIN_EDGE_CHARS || head.length > flat.text.length || !flat.text.endsWith(head)) continue;
    const start = flat.map[flat.text.length - head.length];
    if (!atWordStart(text, start) || overlaps(taken, start, text.length)) continue;
    best = { range: [start, flat.map[flat.map.length - 1] + 1], last: false, len: head.length };
    break;
  }
  for (let i = 1; i < words.length; i++) {
    const tail = strip(words.slice(i).join(' '));
    if (tail.length < MIN_EDGE_CHARS || tail.length > flat.text.length || !flat.text.startsWith(tail)) continue;
    if (best && best.len >= tail.length) break;
    const end = flat.map[tail.length - 1] + 1;
    if (!atWordEnd(text, end) || overlaps(taken, flat.map[0], end)) continue;
    best = { range: [flat.map[0], end], last: true, len: tail.length };
    break;
  }
  if (best) return { range: best.range, last: best.last };
  if (flat.text.length >= MIN_MIDDLE_CHARS && ` ${words.join(' ')} `.includes(` ${text.trim().replace(/\s+/g, ' ')} `)) {
    const range: [number, number] = [flat.map[0], flat.map[flat.map.length - 1] + 1];
    if (!overlaps(taken, range[0], range[1])) return { range, last: false };
  }
  return null;
}

/**
 * Splits a paragraph into plain and marked runs, in order. Each mark's quote is found whitespace-insensitively
 * (exact characters otherwise); the first occurrence that no earlier mark covers is used, so marks never overlap.
 * A quote that spans paragraphs is matched piece by piece: the dot goes on the paragraph where the quote ends.
 */
export function splitRuns(paragraphText: string, marks: RunMark[]): Run[] {
  if (paragraphText === '') return [];
  const flat = stripped(paragraphText);
  const taken: Range[] = [];
  for (const mark of marks) {
    const quote = mark.quote.replace(/\s+/g, ' ').trim();
    const needle = strip(quote);
    if (needle === '' || flat.text === '') continue;
    const full = findFull(flat, needle, taken);
    if (full) {
      taken.push({ start: full[0], end: full[1], mark, last: true });
      continue;
    }
    const part = findPartial(paragraphText, flat, quote, taken);
    if (part) taken.push({ start: part.range[0], end: part.range[1], mark, last: part.last });
  }
  taken.sort((a, b) => a.start - b.start);

  const runs: Run[] = [];
  let at = 0;
  for (const r of taken) {
    if (r.start > at) runs.push({ text: paragraphText.slice(at, r.start) });
    const run: Run = { text: paragraphText.slice(r.start, r.end), annotationId: r.mark.id };
    if (r.mark.color) run.color = r.mark.color;
    if (r.mark.underline) run.underline = true;
    if (r.mark.hasDetail && r.last) run.dot = true;
    runs.push(run);
    at = r.end;
  }
  if (at < paragraphText.length) runs.push({ text: paragraphText.slice(at) });
  return runs;
}
