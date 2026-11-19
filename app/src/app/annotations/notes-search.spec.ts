import { describe, expect, it } from 'vitest';
import type { Annotation, Book } from '../core/models';
import { searchNotes, type NotesFilter } from './notes-search';

const NONE: NotesFilter = { query: '', types: [], tags: [] };

function book(id: string, title: string, deleted = false): Book {
  return { id, title, deleted } as Book;
}

let n = 0;
function ann(over: Partial<Annotation> & Pick<Annotation, 'bookId' | 'type'>): Annotation {
  n += 1;
  return { id: `a${n}`, deviceId: 'd', updatedAt: 1, tags: [], createdAt: n, ...over } as Annotation;
}

const quote = (q: string) => ({ page: 1, start: { item: 0, offset: 0 }, end: { item: 0, offset: 1 }, rects: [], quote: q });

describe('searchNotes', () => {
  const books = [book('b2', 'origin of species'), book('b1', 'Darwin Letters'), book('b3', 'Gone', true), book('b4', 'Empty')];
  const hl = ann({ bookId: 'b1', type: 'highlight', page: 3, text: quote('the big question') });
  const note = ann({ bookId: 'b2', type: 'note', page: 2, body: 'ask the big question', tags: ['big-question'], text: quote('why') });
  const arabic = ann({ bookId: 'b2', type: 'highlight', page: 1, text: quote('كِتَابُ الله') });
  const summary = ann({ bookId: 'b1', type: 'summary', body: 'wrap up', tags: ['review'], scope: { kind: 'book' } });
  const bookmark = ann({ bookId: 'b1', type: 'bookmark', page: 1 });
  const orphan = ann({ bookId: 'b3', type: 'highlight', page: 1, text: quote('x') });
  const removed = ann({ bookId: 'b1', type: 'highlight', page: 9, text: quote('x'), deleted: true });
  const all = [hl, note, arabic, summary, bookmark, orphan, removed];

  it('groups by book title, case-insensitively, dropping bookmarks, deleted records and deleted books', () => {
    const groups = searchNotes(all, books, NONE);
    expect(groups.map((g) => g.book.id)).toEqual(['b1', 'b2']);
    expect(groups[0].items).toEqual([hl, summary]);
    expect(groups[1].items).toEqual([arabic, note]);
  });

  it('matches the book title', () => {
    expect(searchNotes(all, books, { ...NONE, query: 'darwin' }).flatMap((g) => g.items)).toEqual([hl, summary]);
  });

  it('needs every term, across quote, body, tags and title', () => {
    const items = searchNotes(all, books, { ...NONE, query: 'big question' }).flatMap((g) => g.items);
    expect(items).toEqual([hl, note]);
    expect(searchNotes(all, books, { ...NONE, query: 'big wrap' })).toEqual([]);
  });

  it('filters by type', () => {
    const items = searchNotes(all, books, { ...NONE, types: ['summary', 'note'] }).flatMap((g) => g.items);
    expect(items).toEqual([summary, note]);
  });

  it('filters by tag (every chosen tag)', () => {
    expect(searchNotes(all, books, { ...NONE, tags: ['big-question'] }).flatMap((g) => g.items)).toEqual([note]);
    expect(searchNotes(all, books, { ...NONE, tags: ['big-question', 'review'] })).toEqual([]);
  });

  it('matches Arabic without diacritics', () => {
    const items = searchNotes(all, books, { ...NONE, query: 'كتاب الله' }).flatMap((g) => g.items);
    expect(items).toEqual([arabic]);
  });
});
