import type { Book } from './models';

/** Default: one page at a time, turned by swiping or the arrow keys. Stored per-book and per-settings values win. */
export const DEFAULT_PAGE_MODE: Book['pageMode'] = 'swipe';

/** Owner default: progress follows the last page reached. */
export const DEFAULT_PROGRESS_MODE: Book['progressMode'] = 'last-page';
