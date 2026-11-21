import { describe, expect, it } from 'vitest';
import type { ReviewItem } from '../core/models';
import { cardFor, chipOf, contextSentence, daysUntilDue, detectLang, filterItems, grade, isWholeCard, kindFor, newSrs, normalizeSelection } from './review-logic';

const DAY = 86_400_000;

describe('detectLang', () => {
  it('detects Arabic by script and defaults to English', () => {
    expect(detectLang('كتاب')).toBe('ar');
    expect(detectLang('book')).toBe('en');
    expect(detectLang('the book كتاب')).toBe('en');
    expect(detectLang('قرأت the book اليوم')).toBe('ar');
    expect(detectLang('123 ...')).toBe('en');
  });
});

describe('kindFor', () => {
  it('classifies by length', () => {
    expect(kindFor('serendipity')).toBe('word');
    expect(kindFor('break the ice')).toBe('phrase');
    expect(kindFor('It was the best of times, it was the worst of times.')).toBe('sentence');
    expect(kindFor('ما هذا')).toBe('phrase');
  });
});

describe('normalizeSelection', () => {
  it('collapses whitespace and trims', () => {
    expect(normalizeSelection('  a \n  b\t')).toBe('a b');
  });
});

describe('contextSentence', () => {
  const page = 'First sentence here. The quick brown fox jumps over the lazy dog! Another one follows.';
  it('returns the sentence holding the quote', () => {
    expect(contextSentence(page, 'brown fox')).toBe('The quick brown fox jumps over the lazy dog!');
  });
  it('matches across line breaks and Arabic punctuation', () => {
    expect(contextSentence('جملة أولى.\nقرأت الكتاب\nاليوم؟ جملة ثالثة', 'الكتاب اليوم')).toBe('قرأت الكتاب اليوم؟');
  });
  it('returns empty when the quote is not on the page', () => {
    expect(contextSentence(page, 'zebra')).toBe('');
  });
  it('caps very long sentences', () => {
    expect(contextSentence('a '.repeat(500) + 'needle ' + 'b '.repeat(500), 'needle').length).toBeLessThanOrEqual(301);
  });
});

describe('SRS', () => {
  const now = 1_000_000_000;
  it('a new item is due immediately', () => {
    expect(newSrs(now)).toEqual({ due: now, intervalDays: 0, ease: 2.5, reps: 0, lapses: 0 });
  });
  it('Again resets reps, counts a lapse, lowers ease and returns in minutes', () => {
    const s = grade({ ...newSrs(now), reps: 3, intervalDays: 10 }, 'again', now);
    expect(s).toMatchObject({ reps: 0, lapses: 1, intervalDays: 0 });
    expect(s.ease).toBeCloseTo(2.3);
    expect(s.due).toBe(now + 10 * 60_000);
  });
  it('Good steps 1 day, 3 days, then multiplies by ease', () => {
    const a = grade(newSrs(now), 'good', now);
    expect(a).toMatchObject({ reps: 1, intervalDays: 1, due: now + DAY });
    const b = grade(a, 'good', now);
    expect(b).toMatchObject({ reps: 2, intervalDays: 3 });
    const c = grade(b, 'good', now);
    expect(c.intervalDays).toBe(8); // round(3 * 2.5)
  });
  it('Easy grows faster and raises ease; Hard grows slowly and lowers ease', () => {
    const base = { due: now, intervalDays: 4, ease: 2.5, reps: 2, lapses: 0 };
    const easy = grade(base, 'easy', now);
    const hard = grade(base, 'hard', now);
    expect(easy.intervalDays).toBeGreaterThan(grade(base, 'good', now).intervalDays);
    expect(easy.ease).toBeCloseTo(2.65);
    expect(hard.intervalDays).toBe(5);
    expect(hard.ease).toBeCloseTo(2.35);
  });
  it('never lets ease drop under 1.3', () => {
    let s = newSrs(now);
    for (let i = 0; i < 20; i++) s = grade(s, 'again', now);
    expect(s.ease).toBe(1.3);
  });
});

describe('cardFor', () => {
  const item = (sourceLang: 'en' | 'ar'): ReviewItem => ({ id: 'i', text: 'src', translation: 'tr', sourceLang }) as ReviewItem;
  it('shows the saved text first and its translation behind it, whatever the language', () => {
    expect(cardFor(item('en'))).toEqual({ front: 'src', back: 'tr', frontLang: 'en', backLang: 'ar' });
    expect(cardFor(item('ar'))).toEqual({ front: 'src', back: 'tr', frontLang: 'ar', backLang: 'en' });
  });
});

describe('chips', () => {
  it('puts phrases with sentences and tells whole cards from flip cards', () => {
    expect(chipOf({ kind: 'phrase' })).toBe('sentence');
    expect(chipOf({ kind: 'word' })).toBe('word');
    expect(chipOf({ kind: 'note' })).toBe('note');
    expect(isWholeCard({ kind: 'highlight' })).toBe(true);
    expect(isWholeCard({ kind: 'note' })).toBe(true);
    expect(isWholeCard({ kind: 'sentence' })).toBe(false);
  });
});

describe('filterItems', () => {
  const mk = (id: string, o: Partial<ReviewItem>): ReviewItem => ({ id, text: id, translation: '', context: '', kind: 'word', bookId: 'b1', ...o }) as ReviewItem;
  const items = [mk('apple', {}), mk('break the ice', { kind: 'phrase', bookId: 'b2' }), mk('long one', { kind: 'sentence' }), mk('n1', { kind: 'note' }), mk('h1', { kind: 'highlight', bookId: 'b2' })];
  it('shows everything when no chip is on', () => {
    expect(filterItems(items, { chips: [], bookId: null })).toHaveLength(5);
  });
  it('combines several chips (any of them) and a book', () => {
    expect(filterItems(items, { chips: ['sentence'], bookId: null }).map((r) => r.id)).toEqual(['break the ice', 'long one']);
    expect(filterItems(items, { chips: ['note', 'highlight'], bookId: null }).map((r) => r.id)).toEqual(['n1', 'h1']);
    expect(filterItems(items, { chips: ['word', 'highlight'], bookId: 'b2' }).map((r) => r.id)).toEqual(['h1']);
    expect(filterItems(items, { chips: [], bookId: 'b1' })).toHaveLength(3);
  });
});

describe('daysUntilDue', () => {
  it('is 0 when due and rounds up otherwise', () => {
    expect(daysUntilDue({ srs: { due: 5 } } as ReviewItem, 10)).toBe(0);
    expect(daysUntilDue({ srs: { due: 10 + DAY + 1 } } as ReviewItem, 10)).toBe(2);
  });
});
