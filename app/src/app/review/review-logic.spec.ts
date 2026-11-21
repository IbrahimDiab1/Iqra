import { describe, expect, it } from 'vitest';
import type { ReviewItem } from '../core/models';
import { contextSentence, detectLang, frontBack, grade, kindFor, newSrs, normalizeSelection } from './review-logic';

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

describe('frontBack', () => {
  const item = (sourceLang: 'en' | 'ar'): ReviewItem => ({ id: 'i', text: 'src', translation: 'tr', sourceLang }) as ReviewItem;
  it('puts the English side in front for en-ar and the Arabic side for ar-en', () => {
    expect(frontBack(item('en'), 'en-ar')).toEqual({ front: 'src', back: 'tr', frontLang: 'en', backLang: 'ar' });
    expect(frontBack(item('en'), 'ar-en')).toEqual({ front: 'tr', back: 'src', frontLang: 'ar', backLang: 'en' });
    expect(frontBack(item('ar'), 'en-ar')).toEqual({ front: 'tr', back: 'src', frontLang: 'en', backLang: 'ar' });
    expect(frontBack(item('ar'), 'ar-en')).toEqual({ front: 'src', back: 'tr', frontLang: 'ar', backLang: 'en' });
  });
});
