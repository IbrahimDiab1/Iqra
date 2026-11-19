import { COPY } from '../../ui/copy';
import type { Book, ID } from '../../core/models';
import { bookProgress } from '../../progress/book-progress';

export { bookProgress };

export type LibraryTab = 'reading' | 'to-read' | 'finished' | 'all';
export type SortKey = 'recent-read' | 'recent-added' | 'progress' | 'priority' | 'rating' | 'title';

export interface LibraryState {
  tab: LibraryTab;
  categoryIds: ID[];
  tags: string[];
  minRating: number | null;
  downloadedOnly: boolean;
  sort: SortKey;
  dir: 'asc' | 'desc';
  query: string;
}

/** A `categoryIds` filter value for books that have no live category. */
export const UNCATEGORIZED = '__uncategorized__';

export interface LibraryCtx {
  /** Ids of the live categories. Without it, a book is uncategorized when its `categoryIds` is empty. */
  liveCategories?: ReadonlySet<ID>;
  downloaded: Set<ID>;
  upNext: ID[];
  markedCounts: Map<ID, number>;
}

export const DEFAULT_LIBRARY_STATE: LibraryState = {
  tab: 'reading',
  categoryIds: [],
  tags: [],
  minRating: null,
  downloadedOnly: false,
  sort: 'recent-read',
  dir: 'desc',
  query: '',
};

export function statusLine(b: Book, progress: number): string {
  if (b.status === 'finished') return COPY.library.finished;
  if (b.status === 'to-read' && b.lastPageReached === 0) return `${COPY.library.notStarted} · ${b.pageCount} pages`;
  return `p. ${b.lastPageReached} of ${b.pageCount} · ${Math.round(progress * 100)}%`;
}

export function tabCounts(books: Book[]): Record<LibraryTab, number> {
  const live = books.filter(b => !b.deleted);
  return {
    reading: live.filter(b => b.status === 'reading' || b.status === 'paused').length,
    'to-read': live.filter(b => b.status === 'to-read').length,
    finished: live.filter(b => b.status === 'finished').length,
    all: live.length,
  };
}

export function queryLibrary(
  books: Book[],
  s: LibraryState,
  ctx: LibraryCtx,
): { upNext: Book[]; main: Book[]; paused: Book[] } {
  const compare = compareFor(s, ctx);
  const sorted = (list: Book[]) => [...list].sort((a, b) => compare(a, b) || tieBreak(a, b));
  const matched = books.filter(b => matchesFilters(b, s, ctx));

  switch (s.tab) {
    case 'reading':
      return {
        upNext: [],
        main: sorted(matched.filter(b => b.status === 'reading')),
        paused: sorted(matched.filter(b => b.status === 'paused')),
      };
    case 'to-read': {
      const rank = new Map(ctx.upNext.map((id, i) => [id, i]));
      const toRead = matched.filter(b => b.status === 'to-read');
      return {
        upNext: toRead
          .filter(b => rank.has(b.id))
          .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0)),
        main: sorted(toRead.filter(b => !rank.has(b.id))),
        paused: [],
      };
    }
    case 'finished':
      return { upNext: [], main: sorted(matched.filter(b => b.status === 'finished')), paused: [] };
    case 'all':
      return { upNext: [], main: sorted(matched), paused: [] };
  }
}

/** The most recently opened in-progress book that passes the filters. Ignores the tab and the sort direction. */
export function continueBook(books: Book[], s: LibraryState, ctx: LibraryCtx): Book | null {
  const candidates = books.filter(
    b =>
      (b.status === 'reading' || b.status === 'paused') &&
      b.lastOpenedAt !== undefined &&
      matchesFilters(b, s, ctx),
  );
  candidates.sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0) || tieBreak(a, b));
  return candidates[0] ?? null;
}

export function activeFilterCount(s: LibraryState): number {
  return [s.categoryIds.length > 0, s.tags.length > 0, s.minRating !== null, s.downloadedOnly].filter(Boolean).length;
}

function matchesFilters(b: Book, s: LibraryState, ctx: LibraryCtx): boolean {
  if (b.deleted) return false;
  if (s.categoryIds.length > 0 && !matchesCategories(b, s.categoryIds, ctx)) return false;
  if (!s.tags.every(tag => b.tags.includes(tag))) return false;
  if (s.minRating !== null && (b.rating === undefined || b.rating < s.minRating)) return false;
  if (s.downloadedOnly && !ctx.downloaded.has(b.id)) return false;
  const q = foldText(s.query.trim());
  if (q && !foldText(b.title).includes(q) && !foldText(b.author).includes(q)) return false;
  return true;
}

function hasLiveCategory(b: Book, live: ReadonlySet<ID> | undefined): boolean {
  return live ? b.categoryIds.some(id => live.has(id)) : b.categoryIds.length > 0;
}

/** OR across the wanted categories. `UNCATEGORIZED` matches a book with no live category. */
function matchesCategories(b: Book, wanted: readonly ID[], ctx: LibraryCtx): boolean {
  if (wanted.includes(UNCATEGORIZED) && !hasLiveCategory(b, ctx.liveCategories)) return true;
  return b.categoryIds.some(id => wanted.includes(id));
}

/** How many live books each category chip stands for. Books with only deleted categories count as uncategorized. */
export function categoryCounts(
  books: readonly Book[],
  liveCategoryIds: readonly ID[],
): { all: number; uncategorized: number; byId: Map<ID, number> } {
  const live = new Set(liveCategoryIds);
  const byId = new Map<ID, number>(liveCategoryIds.map(id => [id, 0]));
  let all = 0;
  let uncategorized = 0;
  for (const b of books) {
    if (b.deleted) continue;
    all += 1;
    if (!hasLiveCategory(b, live)) uncategorized += 1;
    for (const id of new Set(b.categoryIds)) if (live.has(id)) byId.set(id, (byId.get(id) ?? 0) + 1);
  }
  return { all, uncategorized, byId };
}

/** Lowercases and strips Latin combining marks, Arabic harakat (U+064B-U+065F, U+0670) and tatweel (U+0640). */
export function foldText(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036F\u064B-\u065F\u0670\u0640]/g, '').toLowerCase();
}

function titleCompare(a: Book, b: Book): number {
  return a.title.localeCompare(b.title, undefined, { numeric: true });
}

/** Deterministic fallback for ties: title, then id. Not reversed by direction. */
function tieBreak(a: Book, b: Book): number {
  return titleCompare(a, b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function compareFor(s: LibraryState, ctx: LibraryCtx): (a: Book, b: Book) => number {
  const sign = s.dir === 'asc' ? 1 : -1;
  const recentRead = (b: Book) => b.lastOpenedAt ?? b.addedAt;
  switch (s.sort) {
    case 'title':
      return (a, b) => sign * titleCompare(a, b);
    case 'rating':
      return (a, b) => {
        if (a.rating === undefined && b.rating === undefined) return 0;
        if (a.rating === undefined) return 1;
        if (b.rating === undefined) return -1;
        return sign * (a.rating - b.rating);
      };
    case 'priority': {
      // Direction does not apply: Up next rank first, then most recently read.
      const rank = new Map(ctx.upNext.map((id, i) => [id, i]));
      const rankOf = (b: Book) => rank.get(b.id) ?? ctx.upNext.length;
      return (a, b) => rankOf(a) - rankOf(b) || recentRead(b) - recentRead(a);
    }
    case 'recent-read':
      return (a, b) => sign * (recentRead(a) - recentRead(b));
    case 'recent-added':
      return (a, b) => sign * (a.addedAt - b.addedAt);
    case 'progress':
      return (a, b) =>
        sign *
        (bookProgress(a, ctx.markedCounts.get(a.id) ?? 0) - bookProgress(b, ctx.markedCounts.get(b.id) ?? 0));
  }
}
