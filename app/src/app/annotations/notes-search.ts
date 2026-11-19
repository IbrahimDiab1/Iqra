import type { Annotation, Book } from '../core/models';
import { normalizeWithMap } from '../reader/text';

export interface NotesFilter {
  query: string;
  /** Empty means every type. */
  types: Annotation['type'][];
  /** An annotation must carry every tag listed; empty means no restriction. */
  tags: string[];
}

export interface BookGroup {
  book: Book;
  items: Annotation[];
}

const fold = (s: string): string => normalizeWithMap(s).text;

function byPageThenCreated(a: Annotation, b: Annotation): number {
  const pa = a.page ?? Number.POSITIVE_INFINITY;
  const pb = b.page ?? Number.POSITIVE_INFINITY;
  return pa !== pb ? pa - pb : a.createdAt - b.createdAt;
}

/**
 * Filters and searches annotations for the Notes hub, grouped by book (title order).
 * Every query term must appear in the quote, body, tags or book title; Arabic marks and
 * spelling variants are folded. Bookmarks, deleted records and deleted books are left out.
 */
export function searchNotes(anns: Annotation[], books: Book[], f: NotesFilter): BookGroup[] {
  const terms = fold(f.query).split(' ').filter((t) => t !== '');
  const live = books
    .filter((b) => !b.deleted)
    .sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
  const groups: BookGroup[] = [];
  for (const book of live) {
    const items = anns
      .filter((a) => a.bookId === book.id && !a.deleted && a.type !== 'bookmark')
      .filter((a) => f.types.length === 0 || f.types.includes(a.type))
      .filter((a) => f.tags.every((t) => a.tags.includes(t)))
      .filter((a) => {
        if (terms.length === 0) return true;
        const hay = fold([a.text?.quote ?? '', a.body ?? '', ...a.tags, book.title].join(' '));
        return terms.every((t) => hay.includes(t));
      })
      .sort(byPageThenCreated);
    if (items.length > 0) groups.push({ book, items });
  }
  return groups;
}
