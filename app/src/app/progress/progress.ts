import type { Book, OutlineNode } from '../core/models';
import { nodeRange } from '../reader/outline';

/** 0..1. Last-page books use lastPageReached; marked books use the number of marked pages. 0 when pageCount <= 0. */
export function bookProgress(
  b: Pick<Book, 'progressMode' | 'lastPageReached' | 'pageCount'>,
  markedPages: number,
): number {
  if (b.pageCount <= 0) return 0;
  const reached = b.progressMode === 'marked' ? markedPages : b.lastPageReached;
  return Math.min(1, Math.max(0, reached / b.pageCount));
}

/**
 * Chapter progress over the node's page range. Last-page mode: the share of the range up to lastPageReached.
 * Marked mode: the share of the range's pages that are marked. Done when the share is complete.
 */
export function chapterProgress(
  b: Book,
  node: OutlineNode,
  marked: ReadonlySet<number>,
): { fraction: number; done: boolean } {
  const { fromPage, toPage } = nodeRange(b.outline, node.key, b.pageCount);
  const size = toPage - fromPage + 1;
  let covered = 0;
  if (b.progressMode === 'marked') {
    for (let p = fromPage; p <= toPage; p++) if (marked.has(p)) covered++;
  } else {
    covered = Math.min(toPage, b.lastPageReached) - fromPage + 1;
  }
  const fraction = Math.min(1, Math.max(0, covered / size));
  return { fraction, done: covered >= size };
}

/** Finished top-level outline nodes out of all top-level nodes. */
export function chaptersDone(b: Book, marked: ReadonlySet<number>): { done: number; total: number } {
  let done = 0;
  for (const node of b.outline) {
    if (chapterProgress(b, node, marked).done) done++;
  }
  return { done, total: b.outline.length };
}
