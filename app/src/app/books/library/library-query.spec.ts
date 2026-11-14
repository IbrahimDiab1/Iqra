import { describe, expect, it } from 'vitest';
import type { Book, ID } from '../../core/models';
import {
  activeFilterCount,
  bookProgress,
  continueBook,
  DEFAULT_LIBRARY_STATE,
  queryLibrary,
  statusLine,
  tabCounts,
  type LibraryCtx,
  type LibraryState,
} from './library-query';

function book(over: Partial<Book> & { id: ID }): Book {
  return {
    updatedAt: 0,
    deviceId: 'device',
    title: '',
    author: '',
    driveFileId: '',
    fileName: '',
    sizeBytes: 0,
    sha256: '',
    pageCount: 100,
    outline: [],
    language: 'en',
    direction: 'ltr',
    addedAt: 0,
    status: 'to-read',
    categoryIds: [],
    tags: [],
    progressMode: 'last-page',
    pageMode: 'swipe',
    lastPageReached: 0,
    ...over,
  };
}

// Six books, one of them deleted. Recent-read order (lastOpenedAt, else addedAt): b5, b2, b1, b4, b3.
const books: Book[] = [
  book({ id: 'b1', title: 'Clean Code', author: 'Robert Martin', status: 'reading', pageCount: 400, lastPageReached: 100, addedAt: 1000, lastOpenedAt: 5000, categoryIds: ['tech'], tags: ['code', 'classic'], rating: 8 }),
  book({ id: 'b2', title: 'Dune', author: 'Frank Herbert', status: 'paused', pageCount: 500, progressMode: 'marked', addedAt: 2000, lastOpenedAt: 6000, categoryIds: ['fiction', 'tech'], tags: ['classic'], rating: 9 }),
  book({ id: 'b3', title: 'Émile', author: 'Jean-Jacques Rousseau', status: 'to-read', pageCount: 300, addedAt: 3000, categoryIds: ['general'], tags: ['classic', 'code'] }),
  book({ id: 'b4', title: 'The Pragmatic Programmer', author: 'Andrew Hunt', status: 'to-read', pageCount: 350, addedAt: 4000, categoryIds: ['tech', 'general'], tags: ['code'], rating: 5 }),
  book({ id: 'b5', title: 'Sapiens', author: 'Yuval Harari', status: 'finished', pageCount: 450, lastPageReached: 450, addedAt: 500, lastOpenedAt: 7000, finishedAt: 7000, categoryIds: ['general'], rating: 10 }),
  book({ id: 'b6', title: 'Deleted Draft', status: 'reading', addedAt: 9000, lastOpenedAt: 9000, categoryIds: ['tech'], tags: ['code', 'classic'], rating: 6, deleted: true }),
];

const ctx: LibraryCtx = {
  downloaded: new Set(['b1', 'b3']),
  upNext: ['b4', 'b3'],
  markedCounts: new Map([['b2', 25]]),
};

function state(over: Partial<LibraryState>): LibraryState {
  return { ...DEFAULT_LIBRARY_STATE, tab: 'all', ...over };
}

function ids(list: Book[]): ID[] {
  return list.map(b => b.id);
}

describe('library query', () => {
  it('has the default state from the brief', () => {
    expect(DEFAULT_LIBRARY_STATE).toEqual({
      tab: 'reading',
      categoryIds: [],
      tags: [],
      minRating: null,
      downloadedOnly: false,
      sort: 'recent-read',
      dir: 'desc',
      query: '',
    });
  });

  it('counts tabs exactly, leaving out deleted books and folding paused into reading', () => {
    expect(tabCounts(books)).toEqual({ reading: 2, 'to-read': 2, finished: 1, all: 5 });
  });

  it('excludes deleted books from every tab', () => {
    for (const tab of ['reading', 'to-read', 'finished', 'all'] as const) {
      const r = queryLibrary(books, state({ tab }), ctx);
      expect([...ids(r.main), ...ids(r.upNext), ...ids(r.paused)]).not.toContain('b6');
    }
  });

  it('puts reading books in main and paused books in paused', () => {
    const r = queryLibrary(books, state({ tab: 'reading' }), ctx);
    expect(ids(r.main)).toEqual(['b1']);
    expect(ids(r.paused)).toEqual(['b2']);
    expect(r.upNext).toEqual([]);
  });

  it('keeps Up next books in list order in upNext, and the rest of to-read in main', () => {
    const r = queryLibrary(books, state({ tab: 'to-read', sort: 'title', dir: 'asc' }), ctx);
    expect(ids(r.upNext)).toEqual(['b4', 'b3']);
    expect(ids(r.main)).toEqual([]);

    const partial = queryLibrary(books, state({ tab: 'to-read' }), { ...ctx, upNext: ['b4'] });
    expect(ids(partial.upNext)).toEqual(['b4']);
    expect(ids(partial.main)).toEqual(['b3']);
  });

  it('matches categories with OR', () => {
    const r = queryLibrary(books, state({ categoryIds: ['tech', 'general'] }), ctx);
    // AND would leave only b4, which has both.
    expect(ids(r.main).sort()).toEqual(['b1', 'b2', 'b3', 'b4', 'b5']);
  });

  it('matches tags with AND', () => {
    const r = queryLibrary(books, state({ tags: ['classic', 'code'] }), ctx);
    expect(ids(r.main).sort()).toEqual(['b1', 'b3']);
  });

  it('excludes unrated books once minRating is set', () => {
    const r = queryLibrary(books, state({ minRating: 7 }), ctx);
    expect(ids(r.main).sort()).toEqual(['b1', 'b2', 'b5']);
  });

  it('keeps only downloaded books when downloadedOnly is set', () => {
    const r = queryLibrary(books, state({ downloadedOnly: true }), ctx);
    expect(ids(r.main).sort()).toEqual(['b1', 'b3']);
  });

  it('matches query case-insensitively on title or author', () => {
    expect(ids(queryLibrary(books, state({ query: 'HERBERT' }), ctx).main)).toEqual(['b2']);
    expect(ids(queryLibrary(books, state({ query: 'sapi' }), ctx).main)).toEqual(['b5']);
  });

  it('matches Latin query without diacritics', () => {
    expect(ids(queryLibrary(books, state({ query: 'emile' }), ctx).main)).toEqual(['b3']);
  });

  it('matches Arabic query as-is, keeping harakat', () => {
    const arabic = [book({ id: 'a1', title: 'القُرْآن الكريم', author: 'مجهول' })];
    expect(ids(queryLibrary(arabic, state({ query: 'القُرْآن' }), ctx).main)).toEqual(['a1']);
    expect(ids(queryLibrary(arabic, state({ query: 'قرآن' }), ctx).main)).toEqual([]);
  });

  it('sorts priority with Up next rank first, then recent-read, ignoring direction', () => {
    const desc = queryLibrary(books, state({ sort: 'priority', dir: 'desc' }), ctx);
    const asc = queryLibrary(books, state({ sort: 'priority', dir: 'asc' }), ctx);
    expect(ids(desc.main)).toEqual(['b4', 'b3', 'b5', 'b2', 'b1']);
    expect(ids(asc.main)).toEqual(ids(desc.main));
  });

  it('sorts rating desc and asc, both with unrated books last', () => {
    const desc = queryLibrary(books, state({ sort: 'rating', dir: 'desc' }), ctx);
    const asc = queryLibrary(books, state({ sort: 'rating', dir: 'asc' }), ctx);
    expect(ids(desc.main)).toEqual(['b5', 'b2', 'b1', 'b4', 'b3']);
    expect(ids(asc.main)).toEqual(['b4', 'b1', 'b2', 'b5', 'b3']);
  });

  it('sorts by recent-read by default, newest first', () => {
    expect(ids(queryLibrary(books, state({}), ctx).main)).toEqual(['b5', 'b2', 'b1', 'b4', 'b3']);
  });

  it('sorts by progress, breaking ties by title', () => {
    // Progress: b5 1, b1 0.25, b2 0.05 (marked 25/500), b3 and b4 0.
    const r = queryLibrary(books, state({ sort: 'progress', dir: 'desc' }), ctx);
    expect(ids(r.main)).toEqual(['b5', 'b1', 'b2', 'b3', 'b4']);
  });

  it('sorts by title with numeric collation', () => {
    const numbered = [
      book({ id: 'n1', title: 'Part 10' }),
      book({ id: 'n2', title: 'Part 2' }),
    ];
    expect(ids(queryLibrary(numbered, state({ sort: 'title', dir: 'asc' }), ctx).main)).toEqual(['n2', 'n1']);
    expect(ids(queryLibrary(books, state({ sort: 'title', dir: 'asc' }), ctx).main))
      .toEqual(['b1', 'b2', 'b3', 'b5', 'b4']);
  });

  it('returns the most recent in-progress book for continueBook, ignoring the tab', () => {
    expect(continueBook(books, state({ tab: 'finished' }), ctx)?.id).toBe('b2');
  });

  it('applies filters to continueBook', () => {
    expect(continueBook(books, state({ categoryIds: ['tech'] }), ctx)?.id).toBe('b2');
    expect(continueBook(books, state({ categoryIds: ['general'] }), ctx)).toBeNull();
  });

  it('builds the three status lines exactly', () => {
    expect(statusLine(books[4]!, 1)).toBe('Finished');
    expect(statusLine(books[2]!, 0)).toBe('Not started · 300 pages');
    expect(statusLine(books[0]!, 0.25)).toBe('p. 100 of 400 · 25%');
  });

  it('computes progress by mode, clamped to 0..1, and 0 for no pages', () => {
    expect(bookProgress(books[1]!, 25)).toBe(0.05);
    expect(bookProgress(book({ id: 'x', pageCount: 500, lastPageReached: 600 }), 0)).toBe(1);
    expect(bookProgress(book({ id: 'x', pageCount: 200, progressMode: 'marked' }), 999)).toBe(1);
    expect(bookProgress(book({ id: 'x', pageCount: 0, lastPageReached: 5 }), 5)).toBe(0);
  });

  it('counts category, tag, minRating and downloadedOnly as one filter each', () => {
    expect(activeFilterCount(DEFAULT_LIBRARY_STATE)).toBe(0);
    expect(activeFilterCount(state({ categoryIds: ['tech'] }))).toBe(1);
    expect(activeFilterCount(state({ categoryIds: ['tech'], tags: ['code'], minRating: 7, downloadedOnly: true }))).toBe(4);
  });
});
