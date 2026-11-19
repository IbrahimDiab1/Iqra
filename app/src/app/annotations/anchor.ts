import type { Annotation, Rect, TextAnchor } from '../core/models';
import { isArabicParagraph, type TextItem } from '../reader/text';
import type { PageSize } from '../reader/pdf-session';

export type Caret = { item: number; offset: number };

/** Orders two carets by item, then by character offset. */
export function compareCaret(a: Caret, b: Caret): number {
  return a.item !== b.item ? a.item - b.item : a.offset - b.offset;
}

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

/** The selected text between two carets: pieces joined by spaces, whitespace collapsed. */
export function quoteOf(items: TextItem[], start: Caret, end: Caret): string {
  const pieces: string[] = [];
  for (let i = start.item; i <= end.item && i < items.length; i++) {
    const str = items[i].str;
    if (str === '') continue;
    const from = i === start.item ? start.offset : 0;
    const to = i === end.item ? end.offset : str.length;
    if (to > from) pieces.push(str.slice(from, to));
  }
  return collapse(pieces.join(' '));
}

interface Unit {
  ch: string;
  start: Caret;
  end: Caret;
}

/** The item stream as single characters, whitespace collapsed, each with its caret span. */
function streamOf(items: TextItem[]): Unit[] {
  const units: Unit[] = [];
  let lastWasSpace = true;
  for (let i = 0; i < items.length; i++) {
    const str = items[i].str;
    if (str === '') continue;
    if (!lastWasSpace) {
      const at = { item: i, offset: 0 };
      units.push({ ch: ' ', start: at, end: at });
      lastWasSpace = true;
    }
    for (let j = 0; j < str.length; j++) {
      const ch = str[j];
      if (/\s/.test(ch)) {
        if (lastWasSpace) continue;
        units.push({ ch: ' ', start: { item: i, offset: j }, end: { item: i, offset: j + 1 } });
        lastWasSpace = true;
        continue;
      }
      units.push({ ch, start: { item: i, offset: j }, end: { item: i, offset: j + 1 } });
      lastWasSpace = false;
    }
  }
  return units;
}

/** The nth (0-based, default 0) occurrence of `quote` in the item stream, as a caret range. */
export function locateQuote(
  items: TextItem[],
  quote: string,
  nth = 0,
): { start: Caret; end: Caret } | null {
  const needle = collapse(quote);
  if (needle === '') return null;
  const units = streamOf(items);
  const text = units.map((u) => u.ch).join('');
  let from = 0;
  for (let seen = 0; ; seen++) {
    const found = text.indexOf(needle, from);
    if (found < 0) return null;
    if (seen === nth) {
      const last = units[found + needle.length - 1];
      return { start: units[found].start, end: last.end };
    }
    from = found + needle.length;
  }
}

const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u;

/**
 * Where a quote sits among the page's occurrences of it: the first occurrence at or after `from`
 * (counted like locateQuote: non-overlapping, left to right), its index `nth`, and whether it starts and
 * ends on word boundaries of the page text. Null when there is none.
 */
export function occurrenceOf(
  items: TextItem[],
  quote: string,
  from: Caret,
): { nth: number; start: Caret; end: Caret; wordStart: boolean; wordEnd: boolean } | null {
  const needle = collapse(quote);
  if (needle === '') return null;
  const units = streamOf(items);
  const text = units.map((u) => u.ch).join('');
  let at = 0;
  for (let nth = 0; ; nth++) {
    const found = text.indexOf(needle, at);
    if (found < 0) return null;
    const start = units[found].start;
    const end = units[found + needle.length - 1].end;
    if (compareCaret(start, from) >= 0) {
      const before = start.offset > 0 ? items[start.item].str[start.offset - 1] : undefined;
      const after = end.offset < items[end.item].str.length ? items[end.item].str[end.offset] : undefined;
      return {
        nth,
        start,
        end,
        wordStart: before === undefined || !WORD_CHAR.test(before),
        wordEnd: after === undefined || !WORD_CHAR.test(after),
      };
    }
    at = found + needle.length;
  }
}

/** Fraction of a text item's width from its left edge: Arabic items are measured from the right. */
function itemRect(item: TextItem, from: number, to: number, size: PageSize): Rect {
  const len = item.str.length;
  const f0 = from / len;
  const f1 = to / len;
  const rtl = isArabicParagraph(item.str);
  const left = rtl ? 1 - f1 : f0;
  const right = rtl ? 1 - f0 : f1;
  const [e, f] = [item.transform[4], item.transform[5]];
  return {
    x: (e + item.width * left) / size.widthPt,
    y: (size.heightPt - (f + item.height)) / size.heightPt,
    w: (item.width * (right - left)) / size.widthPt,
    h: item.height / size.heightPt,
  };
}

/** One rect per item touched by the range. */
export function rectsFromItems(items: TextItem[], start: Caret, end: Caret, size: PageSize): Rect[] {
  const rects: Rect[] = [];
  for (let i = start.item; i <= end.item && i < items.length; i++) {
    const item = items[i];
    if (item.str === '') continue;
    const from = i === start.item ? start.offset : 0;
    const to = i === end.item ? end.offset : item.str.length;
    if (to <= from) continue;
    rects.push(itemRect(item, from, to, size));
  }
  return rects;
}

export function buildAnchor(
  items: TextItem[],
  page: number,
  start: Caret,
  end: Caret,
  size: PageSize,
): TextAnchor {
  return {
    page,
    start: { ...start },
    end: { ...end },
    rects: rectsFromItems(items, start, end, size),
    quote: quoteOf(items, start, end),
  };
}

export function anchorsOverlap(a: TextAnchor, b: TextAnchor): boolean {
  return a.page === b.page && compareCaret(a.start, b.end) <= 0 && compareCaret(b.start, a.end) <= 0;
}

/** The smallest anchor covering both; the quote and rects are rebuilt from the items. */
export function unionAnchor(a: TextAnchor, b: TextAnchor, items: TextItem[], size: PageSize): TextAnchor {
  const start = compareCaret(a.start, b.start) <= 0 ? a.start : b.start;
  const end = compareCaret(a.end, b.end) >= 0 ? a.end : b.end;
  return buildAnchor(items, a.page, start, end, size);
}

function contains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/** The newest live annotation on the page whose text rects or area rect contains the point (x, y normalized). */
export function hitTest(anns: Annotation[], page: number, x: number, y: number): Annotation | null {
  let best: Annotation | null = null;
  for (const a of anns) {
    if (a.deleted) continue;
    const hit =
      a.type === 'area'
        ? a.page === page && !!a.rect && contains(a.rect, x, y)
        : (a.type === 'highlight' || a.type === 'note') &&
          a.text?.page === page &&
          a.text.rects.some((r) => contains(r, x, y));
    if (hit && (!best || a.createdAt > best.createdAt)) best = a;
  }
  return best;
}

/** True when an annotation carries a note body or tags. */
export function hasDetail(a: Annotation): boolean {
  return (a.body ?? '').trim() !== '' || a.tags.length > 0;
}
