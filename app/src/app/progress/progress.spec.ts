import { describe, expect, it } from 'vitest';
import type { Book, OutlineNode } from '../core/models';
import { bookProgress, chapterProgress, chaptersDone } from './progress';

function book(over: Partial<Book> = {}): Book {
  return {
    id: 'b',
    updatedAt: 0,
    deviceId: 'device',
    title: '',
    author: '',
    driveFileId: '',
    fileName: '',
    sizeBytes: 0,
    sha256: '',
    pageCount: 120,
    outline: [],
    language: 'en',
    direction: 'ltr',
    addedAt: 0,
    status: 'reading',
    categoryIds: [],
    tags: [],
    progressMode: 'last-page',
    pageMode: 'swipe',
    lastPageReached: 0,
    ...over,
  };
}

function node(key: string, page: number): OutlineNode {
  return { key, title: `Chapter ${key}`, page, children: [] };
}

// Top-level nodes at pages 1, 10 and 20 of a 30-page book: ranges 1-9, 10-19, 20-30.
const outline = [node('1', 1), node('2', 10), node('3', 20)];

describe('bookProgress', () => {
  it('uses the last page reached in last-page mode', () => {
    expect(bookProgress({ progressMode: 'last-page', lastPageReached: 30, pageCount: 120 }, 0)).toBe(0.25);
  });

  it('uses the marked page count in marked mode', () => {
    expect(bookProgress({ progressMode: 'marked', lastPageReached: 0, pageCount: 120 }, 60)).toBe(0.5);
  });

  it('is 0 for a book with no pages', () => {
    expect(bookProgress({ progressMode: 'last-page', lastPageReached: 5, pageCount: 0 }, 5)).toBe(0);
  });

  it('caps progress at 1', () => {
    expect(bookProgress({ progressMode: 'last-page', lastPageReached: 150, pageCount: 120 }, 0)).toBe(1);
  });
});

describe('chapterProgress', () => {
  it('is the share of the chapter range up to the last page reached', () => {
    const b = book({ pageCount: 30, outline, lastPageReached: 5 });
    const result = chapterProgress(b, outline[0]!, new Set());
    expect(result.fraction).toBeCloseTo(5 / 9, 10);
    expect(result.done).toBe(false);
  });

  it('is done when the last page reached covers the chapter range', () => {
    const b = book({ pageCount: 30, outline, lastPageReached: 9 });
    expect(chapterProgress(b, outline[0]!, new Set())).toEqual({ fraction: 1, done: true });
  });

  it('is the share of marked pages in marked mode', () => {
    const b = book({ pageCount: 30, outline, progressMode: 'marked' });
    const result = chapterProgress(b, outline[0]!, new Set([1, 2, 3]));
    expect(result.fraction).toBeCloseTo(1 / 3, 10);
    expect(result.done).toBe(false);
  });

  it('keeps fraction in 0..1 for a one-page book', () => {
    const one = [node('1', 1)];
    const b = book({ pageCount: 1, outline: one, lastPageReached: 1 });
    expect(chapterProgress(b, one[0]!, new Set())).toEqual({ fraction: 1, done: true });
  });
});

describe('chaptersDone', () => {
  it('counts finished top-level chapters out of all top-level chapters', () => {
    const b = book({ pageCount: 30, outline, lastPageReached: 12 });
    expect(chaptersDone(b, new Set())).toEqual({ done: 1, total: 3 });
  });

  it('counts chapters whose pages are all marked in marked mode', () => {
    const b = book({ pageCount: 30, outline, progressMode: 'marked' });
    const marked = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(chaptersDone(b, marked)).toEqual({ done: 1, total: 3 });
  });

  it('is zero for a book with no outline', () => {
    expect(chaptersDone(book({ pageCount: 30, outline: [] }), new Set())).toEqual({ done: 0, total: 0 });
  });
});
