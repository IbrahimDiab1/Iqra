import type { Book } from './models';

/** The direction a book reads in: the reader's own choice when they made one, otherwise the detected one. */
export function effectiveDirection(book: Pick<Book, 'direction' | 'textDirection'> | null | undefined): 'ltr' | 'rtl' {
  if (!book) return 'ltr';
  return book.textDirection === 'rtl' || book.textDirection === 'ltr' ? book.textDirection : book.direction;
}

export function isRtl(book: Pick<Book, 'direction' | 'textDirection'> | null | undefined): boolean {
  return effectiveDirection(book) === 'rtl';
}
