import type { ReviewItem, ReviewKind, ReviewLang, ReviewSrs } from '../core/models';

const DAY_MS = 86_400_000;
const AGAIN_DELAY_MS = 10 * 60_000;
const MIN_EASE = 1.3;
const MAX_CONTEXT = 300;
const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/g;
const LATIN = /[A-Za-z]/g;
const TERMINATORS = '.!?؟۔…';

export type Grade = 'again' | 'hard' | 'good' | 'easy';

/** Whitespace collapsed to single spaces, ends trimmed. */
export function normalizeSelection(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Arabic when the Arabic letters outnumber the Latin ones, otherwise English. */
export function detectLang(text: string): ReviewLang {
  const ar = text.match(ARABIC)?.length ?? 0;
  const en = text.match(LATIN)?.length ?? 0;
  return ar > en ? 'ar' : 'en';
}

/** One word, a short run of words, or a sentence. */
export function kindFor(text: string): ReviewKind {
  const words = normalizeSelection(text).split(' ').filter(Boolean).length;
  return words <= 1 ? 'word' : words <= 4 ? 'phrase' : 'sentence';
}

/** The sentence of `pageText` that holds `quote`; '' when the quote is not on the page. Long sentences are cut around the quote. */
export function contextSentence(pageText: string, quote: string): string {
  const text = normalizeSelection(pageText);
  const q = normalizeSelection(quote);
  if (q === '') return '';
  const at = text.indexOf(q);
  if (at < 0) return '';
  let start = at;
  while (start > 0 && !TERMINATORS.includes(text[start - 1])) start--;
  let end = at + q.length;
  if (!TERMINATORS.includes(text[end - 1])) {
    while (end < text.length && !TERMINATORS.includes(text[end])) end++;
    if (end < text.length) end++;
  }
  let from = start;
  let to = end;
  if (to - from > MAX_CONTEXT) {
    const room = Math.max(0, Math.floor((MAX_CONTEXT - q.length) / 2));
    from = Math.max(start, at - room);
    to = Math.min(end, at + q.length + room);
  }
  return text.slice(from, to).trim();
}

/** The schedule of an item that was just saved: due at once. */
export function newSrs(now: number): ReviewSrs {
  return { due: now, intervalDays: 0, ease: 2.5, reps: 0, lapses: 0 };
}

/** A simple SM-2: Again retries in minutes; the others grow the interval by the grade. */
export function grade(s: ReviewSrs, g: Grade, now: number): ReviewSrs {
  if (g === 'again') {
    return { due: now + AGAIN_DELAY_MS, intervalDays: 0, ease: Math.max(MIN_EASE, s.ease - 0.2), reps: 0, lapses: s.lapses + 1 };
  }
  let ease = s.ease;
  let days: number;
  if (g === 'hard') {
    ease = Math.max(MIN_EASE, ease - 0.15);
    days = Math.max(1, Math.round(Math.max(1, s.intervalDays) * 1.2));
  } else if (g === 'good') {
    days = s.reps === 0 ? 1 : s.reps === 1 ? 3 : Math.max(s.intervalDays + 1, Math.round(s.intervalDays * ease));
  } else {
    ease += 0.15;
    days = s.reps === 0 ? 4 : Math.max(s.intervalDays + 2, Math.round(s.intervalDays * ease * 1.3));
  }
  return { due: now + days * DAY_MS, intervalDays: days, ease, reps: s.reps + 1, lapses: s.lapses };
}

export interface Card {
  front: string;
  back: string;
  frontLang: ReviewLang;
  backLang: ReviewLang;
}

/** What the Review list can be narrowed to. Phrases count as sentences. */
export type ReviewChip = 'word' | 'sentence' | 'note' | 'highlight';
export const REVIEW_CHIPS: readonly ReviewChip[] = ['word', 'sentence', 'note', 'highlight'];

/** The chip an item belongs to. */
export function chipOf(item: Pick<ReviewItem, 'kind'>): ReviewChip {
  return item.kind === 'phrase' ? 'sentence' : item.kind;
}

/** Highlights and notes are shown whole, with no flip; words and sentences flip to their translation. */
export function isWholeCard(item: Pick<ReviewItem, 'kind'>): boolean {
  return item.kind === 'highlight' || item.kind === 'note';
}

export interface Card {
  front: string;
  back: string;
  frontLang: ReviewLang;
  backLang: ReviewLang;
}

/** The two sides of a word or sentence: the saved text first, then its translation (the natural direction). */
export function cardFor(item: Pick<ReviewItem, 'text' | 'translation' | 'sourceLang'>): Card {
  const back: ReviewLang = item.sourceLang === 'en' ? 'ar' : 'en';
  return { front: item.text, back: item.translation, frontLang: item.sourceLang, backLang: back };
}

export interface ReviewFilter {
  /** Chips that are on; empty means All. */
  chips: readonly ReviewChip[];
  bookId: string | null;
}

/** Items in the chosen chips (any of them; none means all) and book. */
export function filterItems(items: ReviewItem[], f: ReviewFilter): ReviewItem[] {
  return items.filter((r) => (f.chips.length === 0 || f.chips.includes(chipOf(r))) && (f.bookId === null || r.bookId === f.bookId));
}

/** Whole days from `now` until the item is due; 0 or less when due. */
export function daysUntilDue(r: Pick<ReviewItem, 'srs'>, now: number): number {
  return r.srs.due <= now ? 0 : Math.ceil((r.srs.due - now) / DAY_MS);
}
