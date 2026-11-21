import { FAKE_DRIVE } from '../../environments/environment';
import type { Book } from './models';

/** Default: pages scroll one after another. Stored per-book and per-settings values win. */
/** The e2e build keeps paged mode: its tests turn pages with the arrow keys. */
export const DEFAULT_PAGE_MODE: Book['pageMode'] = FAKE_DRIVE ? 'swipe' : 'scroll';

/** Owner default: progress follows the last page reached. */
export const DEFAULT_PROGRESS_MODE: Book['progressMode'] = 'last-page';
