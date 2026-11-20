import { DEFAULT_LIBRARY_STATE, type LibraryState, type LibraryTab, type SortKey } from '../../books/library/library-query';

const STORAGE_KEY = 'iqra.library';
const TABS: readonly LibraryTab[] = ['all', 'reading', 'to-read', 'finished'];
export const SORTS: readonly SortKey[] = ['recent-read', 'recent-added', 'progress', 'priority', 'rating', 'title'];

/** The filters the Filter sheet edits. Categories are chosen on the category bar instead. */
export type FilterValue = Pick<LibraryState, 'tags' | 'minRating' | 'downloadedOnly'>;

/** Direction a sort key starts in when it is picked from the Sort menu. */
export const DEFAULT_DIR: Record<SortKey, LibraryState['dir']> = {
  'recent-read': 'desc',
  'recent-added': 'desc',
  progress: 'desc',
  priority: 'asc',
  rating: 'desc',
  title: 'asc',
};

/** Priority ignores direction, so its arrow is hidden and picking it again changes nothing. */
export function sortHasDirection(key: SortKey): boolean {
  return key !== 'priority';
}

/** Reads the saved state. Anything malformed falls back to the default for that field. */
export function loadLibraryState(): LibraryState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_LIBRARY_STATE };
    const saved: unknown = JSON.parse(raw);
    return sanitize(saved);
  } catch {
    return { ...DEFAULT_LIBRARY_STATE };
  }
}

/** Saves the state. Storage can be blocked or full; the page works without saving. */
export function saveLibraryState(state: LibraryState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Not saved: the state still lasts for this visit.
  }
}

function sanitize(value: unknown): LibraryState {
  const v = (typeof value === 'object' && value !== null ? value : {}) as Partial<Record<keyof LibraryState, unknown>>;
  const d = DEFAULT_LIBRARY_STATE;
  const strings = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []);
  return {
    tab: TABS.includes(v.tab as LibraryTab) ? (v.tab as LibraryTab) : d.tab,
    categoryIds: strings(v.categoryIds),
    tags: strings(v.tags),
    minRating: typeof v.minRating === 'number' && v.minRating >= 1 && v.minRating <= 10 ? v.minRating : null,
    downloadedOnly: v.downloadedOnly === true,
    sort: SORTS.includes(v.sort as SortKey) ? (v.sort as SortKey) : d.sort,
    dir: v.dir === 'asc' || v.dir === 'desc' ? v.dir : d.dir,
    query: typeof v.query === 'string' ? v.query : d.query,
  };
}
