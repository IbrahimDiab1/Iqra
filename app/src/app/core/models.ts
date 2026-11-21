// Data model from docs/specs/2026-11-14-iqra-design.md §7.

export type ID = string; // crypto.randomUUID()

export interface SyncMeta {
  id: ID;
  updatedAt: number; // ms, device clock, set on every local write
  deviceId: string; // stable per install, stored locally
  deleted?: boolean; // deletion marker; never hard-delete synced records
}

export interface Book extends SyncMeta {
  title: string;
  author: string;
  driveFileId: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  pageCount: number;
  outline: OutlineNode[]; // captured once at upload; [] if the PDF has none
  coverFileId?: string;
  language: 'en' | 'ar' | 'other'; // detected at upload from page text; editable
  direction: 'ltr' | 'rtl'; // swipe direction; defaults from language
  addedAt: number;
  lastOpenedAt?: number;
  status: 'to-read' | 'reading' | 'paused' | 'finished';
  startedAt?: number; // first day with >=3 pages read (set automatically)
  finishedAt?: number; // set when status becomes 'finished'
  categoryIds: ID[]; // a book can be in several categories
  tags: string[]; // free labels, lowercase-kebab
  rating?: number; // integer 1-10
  review?: string;
  progressMode: 'last-page' | 'marked'; // per book [decided]
  pageMode: 'swipe' | 'scroll'; // per book
  lastPageReached: number; // furthest page opened (for last-page mode)
}

export interface OutlineNode {
  key: string; // index path, e.g. "3.1"
  title: string;
  page: number;
  children: OutlineNode[];
}
// Chapter page range = [node.page, nextNodeAtSameOrHigherLevel.page - 1], or to the book's end.

export interface Position extends SyncMeta {
  // id = `${bookId}:${deviceId}` (one per device)
  bookId: ID;
  page: number;
  offset: number; // 0..1 within the page
  zoom: number;
  view: 'page' | 'reflow';
}

export interface ReadMark extends SyncMeta {
  // id = `${bookId}:${page}`
  bookId: ID;
  page: number;
  read: boolean;
}

export type Rect = { x: number; y: number; w: number; h: number }; // 0..1, relative to the page at scale 1

export interface TextAnchor {
  page: number;
  start: { item: number; offset: number }; // pdf.js text-content item index + char offset
  end: { item: number; offset: number };
  rects: Rect[]; // computed once at creation; used for drawing
  quote: string; // the selected text, for lists, search and export
}

export type SummaryScope =
  | { kind: 'book' }
  | { kind: 'outline'; nodeKey: string; title: string; fromPage: number; toPage: number }
  | { kind: 'pages'; fromPage: number; toPage: number };

export interface Annotation extends SyncMeta {
  bookId: ID;
  type: 'highlight' | 'note' | 'area' | 'side-note' | 'summary' | 'bookmark';
  // highlight: colored text.  note: underlined text with a note, no color.
  // area: a rectangle on a page.  side-note: attached to a page, never drawn.
  page?: number; // all except summary
  color?: 'yellow' | 'green' | 'blue' | 'pink'; // highlight, area
  text?: TextAnchor; // highlight, note
  rect?: Rect; // area
  scope?: SummaryScope; // summary
  body?: string; // note text / summary text
  tags: string[];
  createdAt: number;
}

export interface Category extends SyncMeta {
  name: string;
  order: number;
}

export interface UpNext extends SyncMeta {
  id: 'up-next';
  bookIds: ID[]; // ranked read-next list [decided]
}

export interface Goal extends SyncMeta {
  categoryId: ID | null; // null = all books
  measure: 'time' | 'pages';
  target: number; // minutes or pages, per week
}

/** Reading reminders (spec 9.12). Every field is optional; the reminder code applies the defaults. */
export interface ReminderSettings {
  enabled?: boolean;
  days?: (0 | 1 | 2 | 3 | 4 | 5 | 6)[]; // JS getDay(): 0 = Sunday
  time?: string; // 'HH:mm' local
  quoteSource?: 'highlights' | 'builtin' | 'both';
  customQuotes?: string[];
  calendarId?: string;
}

export interface Settings extends SyncMeta {
  id: 'settings';
  defaultProgressMode: Book['progressMode'];
  defaultPageMode: Book['pageMode'];
  defaultView: 'page' | 'reflow';
  readerTheme: 'paper' | 'sepia' | 'night';
  weekStartsOn: 0 | 1 | 6; // Sun / Mon / Sat; default 6 = Saturday [decided]
  reminders: ReminderSettings;
  cardDirection: 'en-ar' | 'ar-en' | 'mixed'; // phase 2
}

export interface ReadingSession extends SyncMeta {
  // written by exactly one device, never edited
  bookId: ID;
  startedAt: number;
  endedAt: number;
  activeMs: number; // excludes idle time
  pagesRead: number[]; // pages that counted as read in this session (see 9.2)
}

export type ReviewKind = 'word' | 'phrase' | 'sentence';
export type ReviewLang = 'en' | 'ar';

/** Spaced-repetition state of a saved item, one schedule per direction is not kept: the item is one card. */
export interface ReviewSrs {
  due: number; // ms
  intervalDays: number;
  ease: number; // SM-2 ease factor, >= 1.3
  reps: number; // consecutive successful reviews
  lapses: number;
}

/** A word, phrase or sentence saved from a book to the language notebook. */
export interface ReviewItem extends SyncMeta {
  text: string; // as selected
  translation: string;
  kind: ReviewKind; // by length
  sourceLang: ReviewLang; // language of `text`
  bookId: ID;
  page: number;
  context: string; // the sentence it was selected in; '' when unknown
  note?: string;
  srs: ReviewSrs;
  createdAt: number;
}

export type TableName =
  | 'books'
  | 'categories'
  | 'upNext'
  | 'goals'
  | 'settings'
  | 'annotations'
  | 'positions'
  | 'readMarks'
  | 'sessions'
  | 'review';

export type SyncRecord = SyncMeta & Record<string, unknown>;
