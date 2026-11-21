import { readRtlLine } from './arabic-text';

export { findMatches, normalizeWithMap } from './arabic-text';

/** A pdf.js text item, reduced to the fields this module reads. */
export interface TextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
}

export interface Paragraph {
  text: string;
  rtl: boolean;
}

const ARABIC = /[؀-ۿﭐ-﷿ﹰ-﻿]/;
const SENTENCE_END = /[.؟!?:]$/;
const LATIN_HYPHEN_END = /[A-Za-z]-$/;
const LATIN_LOWER_START = /^[a-z]/;
const PARAGRAPH_GAP_FACTOR = 1.6;
const SHORT_LINE_FACTOR = 0.6;
const SAME_LINE_FACTOR = 0.5;
const ARABIC_SHARE = 0.3;

/** The text around a match, trimmed, with an ellipsis on each side that was cut. */
export function snippet(
  pageText: string,
  m: { index: number; length: number },
  ctx = 40,
): { before: string; match: string; after: string } {
  const matchEnd = m.index + m.length;
  const start = Math.max(0, m.index - ctx);
  const end = Math.min(pageText.length, matchEnd + ctx);
  const before = pageText.slice(start, m.index).trim();
  const after = pageText.slice(matchEnd, end).trim();
  return {
    before: (start > 0 ? '…' : '') + before,
    match: pageText.slice(m.index, matchEnd),
    after: after + (end < pageText.length ? '…' : ''),
  };
}

/** The page's text: items joined by spaces, or by newlines after an end-of-line item. */
export function pageTextOf(items: TextItem[]): string {
  let out = '';
  for (const it of items) {
    if (it.str === '') continue;
    out += it.str + (it.hasEOL ? '\n' : ' ');
  }
  return out
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

/** True when the page has at least 10 non-whitespace characters. */
export function hasSelectableText(items: TextItem[]): boolean {
  let count = 0;
  for (const it of items) {
    count += it.str.replace(/\s/g, '').length;
    if (count >= 10) return true;
  }
  return false;
}

interface Line {
  y: number;
  text: string;
}

function groupLines(items: TextItem[], rtl: boolean, forced: boolean): Line[] {
  const sorted = [...items].sort((a, b) => b.transform[5] - a.transform[5]);
  const groups: { y: number; items: TextItem[] }[] = [];
  for (const it of sorted) {
    const y = it.transform[5];
    const h = it.height || Math.abs(it.transform[3]);
    const current = groups[groups.length - 1];
    if (current && Math.abs(y - current.y) <= SAME_LINE_FACTOR * h) {
      current.items.push(it);
    } else {
      groups.push({ y, items: [it] });
    }
  }
  return groups.map((g) => {
    const xOf = (it: TextItem) => it.transform[4];
    // An Arabic line reads right to left whatever the book's direction says, keeping Latin phrases in their own order.
    // A line with no Arabic in a book marked rtl keeps the plain right-to-left order.
    // When the reader chose a direction for the book, that choice decides every line.
    const arabic = forced ? rtl : isArabicParagraph(g.items.map((it) => it.str).join(' '));
    const ordered = arabic
      ? readRtlLine(g.items, (it) => it.str, xOf)
      : [...g.items].sort((a, b) => (rtl ? xOf(b) - xOf(a) : xOf(a) - xOf(b)));
    const text = ordered
      .map((it) => it.str)
      .join(' ')
      .replace(/ {2,}/g, ' ')
      .trim();
    return { y: g.y, text };
  });
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function joinLines(acc: string, next: string): string {
  if (LATIN_HYPHEN_END.test(acc) && LATIN_LOWER_START.test(next)) {
    return acc.slice(0, -1) + next;
  }
  return acc + ' ' + next;
}

export function isArabicParagraph(text: string): boolean {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return false;
  const arabic = letters.filter((ch) => ARABIC.test(ch)).length;
  return arabic / letters.length >= ARABIC_SHARE;
}

/** Groups a page's text items into lines, then lines into paragraphs, in reading order. */
export function buildReflow(items: TextItem[], opts: { rtl: boolean; forced?: boolean }): Paragraph[] {
  const lines = groupLines(items.filter((it) => it.str.trim() !== ''), opts.rtl, opts.forced ?? false);
  if (lines.length === 0) return [];

  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) gaps.push(lines[i - 1].y - lines[i].y);
  const lineSpacing = gaps.length > 0 ? median(gaps) : 0;
  const longest = Math.max(...lines.map((l) => l.text.length));

  const texts: string[] = [];
  let current = lines[0].text;
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1];
    const line = lines[i];
    const bigGap = prev.y - line.y > PARAGRAPH_GAP_FACTOR * lineSpacing;
    const shortEnd =
      prev.text.length < SHORT_LINE_FACTOR * longest && SENTENCE_END.test(prev.text);
    if (bigGap || shortEnd) {
      texts.push(current);
      current = line.text;
    } else {
      current = joinLines(current, line.text);
    }
  }
  texts.push(current);

  return texts.map((text) => ({ text, rtl: isArabicParagraph(text) }));
}
