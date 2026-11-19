import type { Book, OutlineNode } from '../core/models';
import { bookProgress } from './book-progress';
import { nodeRange } from '../reader/outline';

export { bookProgress };

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
