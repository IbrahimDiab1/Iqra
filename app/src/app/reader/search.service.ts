import { Injectable } from '@angular/core';
import type { PageRenderer } from './pdf-session';
import { findMatches, snippet } from './text';

export interface SearchHit {
  page: number;
  before: string;
  match: string;
  after: string;
}

const DEFAULT_MAX = 300;

/** Searches a book's text page by page. */
@Injectable({ providedIn: 'root' })
export class SearchService {
  /**
   * Reads pages 1..n in order and reports every match. Resolves when done, aborted, or `max` hits were found.
   * A query under two characters resolves at once with no hits.
   */
  async search(
    r: PageRenderer,
    query: string,
    o: {
      max?: number;
      signal: AbortSignal;
      onProgress: (done: number, total: number) => void;
      onHit: (h: SearchHit) => void;
    },
  ): Promise<{ capped: boolean }> {
    if (query.trim().length < 2) return { capped: false };
    const max = o.max ?? DEFAULT_MAX;
    const total = r.numPages;
    let found = 0;
    for (let page = 1; page <= total; page++) {
      if (o.signal.aborted) break;
      let text = '';
      try {
        text = await r.pageText(page);
      } catch {
        // A page whose text cannot be read is skipped.
      }
      if (o.signal.aborted) break;
      for (const m of findMatches(text, query, max - found, r.orderChoice?.())) {
        o.onHit({ page, ...snippet(text, m) });
        found++;
      }
      o.onProgress(page, total);
      if (found >= max) return { capped: true };
    }
    return { capped: false };
  }
}
