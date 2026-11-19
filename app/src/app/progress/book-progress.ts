import type { Book } from '../core/models';

/** 0..1. Last-page books use lastPageReached; marked books use the number of marked pages. 0 when pageCount <= 0. */
export function bookProgress(
  b: Pick<Book, 'progressMode' | 'lastPageReached' | 'pageCount'>,
  markedPages: number,
): number {
  if (b.pageCount <= 0) return 0;
  const reached = b.progressMode === 'marked' ? markedPages : b.lastPageReached;
  return Math.min(1, Math.max(0, reached / b.pageCount));
}
