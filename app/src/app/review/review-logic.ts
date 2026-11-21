import type { ReviewItem, ReviewKind, ReviewLang, ReviewSrs } from '../core/models';

const DAY_MS = 86_400_000;
const AGAIN_DELAY_MS = 10 * 60_000;
const MIN_EASE = 1.3;
const MAX_CONTEXT = 300;
const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/g;
const LATIN = /[A-Za-z]/g;
const TERMINATORS = '.!?؟۔…';

export type Grade = 'again' | 'hard' | 'good' | 'easy';
export type CardDirection = 'en-ar' | 'ar-en' | 'mixed';

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

/** The two sides of an item for one direction: `en-ar` shows the English side first, `ar-en` the Arabic. */
export function frontBack(item: Pick<ReviewItem, 'text' | 'translation' | 'sourceLang'>, direction: Exclude<CardDirection, 'mixed'>): Card {
  const en = item.sourceLang === 'en' ? item.text : item.translation;
  const ar = item.sourceLang === 'ar' ? item.text : item.translation;
  return direction === 'en-ar' ? { front: en, back: ar, frontLang: 'en', backLang: 'ar' } : { front: ar, back: en, frontLang: 'ar', backLang: 'en' };
}

export interface ReviewFilter {
  query: string;
  kind: ReviewKind | 'all';
  bookId: string | null;
}

/** Items matching the search text (in the text, translation, context or note), the kind and the book. */
export function filterItems(items: ReviewItem[], f: ReviewFilter): ReviewItem[] {
  const q = normalizeSelection(f.query).toLowerCase();
  return items.filter(
    (r) =>
      (f.kind === 'all' || (f.kind === 'sentence' ? r.kind !== 'word' : r.kind === f.kind)) &&
      (f.bookId === null || r.bookId === f.bookId) &&
      (q === '' || [r.text, r.translation, r.context, r.note ?? ''].some((v) => v.toLowerCase().includes(q))),
  );
}

/** Whole days from `now` until the item is due; 0 or less when due. */
export function daysUntilDue(r: Pick<ReviewItem, 'srs'>, now: number): number {
  return r.srs.due <= now ? 0 : Math.ceil((r.srs.due - now) / DAY_MS);
}
