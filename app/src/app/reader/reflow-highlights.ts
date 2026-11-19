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
  /**
   * Which occurrence of the quote on the page (0-based, non-overlapping, left to right across paragraphs) the mark
   * is on. Unset: the first occurrence no earlier mark covers.
   */
  nth?: number;
  /** The annotation began on a word boundary, so it is not drawn starting inside a longer word. Default true. */
  wordStart?: boolean;
  /** Likewise for its end. Default true. */
  wordEnd?: boolean;
}

const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u;
const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

/** The page's paragraphs as one collapsed string (joined by one space), each character mapped back to its paragraph. */
function pageText(paragraphs: string[]): { text: string; at: ({ p: number; i: number } | null)[] } {
  let text = '';
  const at: ({ p: number; i: number } | null)[] = [];
  paragraphs.forEach((para, p) => {
    let pendingSpace = false;
    let wrote = false;
    for (let i = 0; i < para.length; i++) {
      if (/\s/.test(para[i])) {
        pendingSpace = wrote;
        continue;
      }
      if (pendingSpace) {
        text += ' ';
        at.push({ p, i });
        pendingSpace = false;
      }
      text += para[i];
      at.push({ p, i });
      wrote = true;
    }
    if (wrote && p < paragraphs.length - 1) {
      text += ' ';
      at.push(null);
    }
  });
  return { text, at };
}

interface Taken {
  start: number;
  end: number;
  mark: RunMark;
}

/** The matching occurrence for a mark, as a [start, end) range in page text. */
function locate(page: string, mark: RunMark, taken: Taken[]): [number, number] | null {
  const needle = collapse(mark.quote);
  if (needle === '') return null;
  const candidates: [number, number][] = [];
  for (let from = 0; ; ) {
    const at = page.indexOf(needle, from);
    if (at < 0) break;
    candidates.push([at, at + needle.length]);
    from = at + needle.length;
  }
  const bounded = ([s, e]: [number, number]) => {
    const startOk = !(mark.wordStart ?? true) || s === 0 || !WORD_CHAR.test(page[s - 1]) || !WORD_CHAR.test(page[s]);
    const endOk = !(mark.wordEnd ?? true) || e >= page.length || !WORD_CHAR.test(page[e]) || !WORD_CHAR.test(page[e - 1]);
    return startOk && endOk;
  };
  const free = ([s, e]: [number, number]) => !taken.some((t) => s < t.end && e > t.start);
  if (mark.nth !== undefined) {
    const exact = candidates[mark.nth];
    if (!exact) return null;
    if (bounded(exact)) return free(exact) ? exact : null;
    // The counted occurrence is inside a longer word: the page text is not aligned with the anchor. Fall back to the
    // first uncovered occurrence that is a whole word.
  }
  return candidates.find((c) => bounded(c) && free(c)) ?? null;
}

/**
 * Splits every paragraph of a page into plain and marked runs. A mark's quote is found in the collapsed page text
 * (so whitespace does not matter and a quote may span paragraphs), at the occurrence its `nth` names, and never
 * inside a longer word unless the annotation itself began or ended mid-word. Marks never overlap: earlier ones win.
 * The dot goes on the last piece of a mark with detail.
 */
export function splitPageRuns(paragraphs: string[], marks: RunMark[]): Run[][] {
  const { text, at } = pageText(paragraphs);
  const taken: Taken[] = [];
  for (const mark of marks) {
    const range = locate(text, mark, taken);
    if (range) taken.push({ start: range[0], end: range[1], mark });
  }
  taken.sort((a, b) => a.start - b.start);

  // The pieces of each mark, per paragraph, as [from, to) in the paragraph's own text.
  const pieces = paragraphs.map(() => [] as { from: number; to: number; t: Taken; last: boolean }[]);
  for (const t of taken) {
    const byPara = new Map<number, { from: number; to: number }>();
    for (let k = t.start; k < t.end; k++) {
      const pos = at[k];
      if (!pos) continue;
      const cur = byPara.get(pos.p);
      if (cur) cur.to = pos.i + 1;
      else byPara.set(pos.p, { from: pos.i, to: pos.i + 1 });
    }
    const lastPara = Math.max(...byPara.keys());
    for (const [p, r] of byPara) pieces[p].push({ ...r, t, last: p === lastPara });
  }

  return paragraphs.map((para, p) => {
    const runs: Run[] = [];
    let cursor = 0;
    for (const piece of pieces[p].sort((a, b) => a.from - b.from)) {
      if (piece.from > cursor) runs.push({ text: para.slice(cursor, piece.from) });
      const run: Run = { text: para.slice(piece.from, piece.to), annotationId: piece.t.mark.id };
      if (piece.t.mark.color) run.color = piece.t.mark.color;
      if (piece.t.mark.underline) run.underline = true;
      if (piece.t.mark.hasDetail && piece.last) run.dot = true;
      runs.push(run);
      cursor = piece.to;
    }
    if (cursor < para.length) runs.push({ text: para.slice(cursor) });
    return runs;
  });
}

/** One paragraph on its own: see splitPageRuns. */
export function splitRuns(paragraphText: string, marks: RunMark[]): Run[] {
  if (paragraphText === '') return [];
  return splitPageRuns([paragraphText], marks)[0];
}
