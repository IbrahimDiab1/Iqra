import { mergeTable } from '../sync/merge';
import type { SyncRecord, TableName } from '../core/models';

export const BACKUP_VERSION = 1;
const MAX_BACKUP_CHARS = 50 * 1024 * 1024;

export const BACKUP_TABLES: readonly TableName[] = [
  'books', 'categories', 'upNext', 'goals', 'settings', 'annotations', 'positions', 'readMarks', 'sessions', 'words',
];

export type BackupTables = Partial<Record<TableName, SyncRecord[]>>;

export interface Backup {
  schemaVersion: 1;
  exportedAt: number;
  tables: BackupTables;
}

export type ParseResult =
  | { ok: true; tables: BackupTables }
  | { ok: false; error: 'not-json' | 'wrong-version' | 'bad-shape' | 'too-large' }
  | { ok: false; error: 'bad-record'; table: TableName; index: number };

/** Every table's records, tombstones included. PDFs and covers are not part of a backup. */
export function buildBackup(tables: BackupTables, now: number): Backup {
  return { schemaVersion: BACKUP_VERSION, exportedAt: now, tables };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

type Check = (v: unknown) => boolean;
const str: Check = (v) => typeof v === 'string';
const num: Check = (v) => typeof v === 'number' && Number.isFinite(v);
const nonNeg: Check = (v) => num(v) && (v as number) >= 0;
const bool: Check = (v) => typeof v === 'boolean';
const list = (item: Check): Check => (v) => Array.isArray(v) && v.every(item);
const oneOf = (...allowed: unknown[]): Check => (v) => allowed.includes(v);
const opt = (check: Check): Check => (v) => v === undefined || check(v);
const shape = (fields: Record<string, Check>): Check => (v) => isObject(v) && Object.entries(fields).every(([k, check]) => check(v[k]));

const rect = shape({ x: num, y: num, w: num, h: num });
const point = shape({ item: num, offset: num });
const textAnchor = shape({ page: num, start: point, end: point, rects: list(rect), quote: str });
const scope: Check = (v) => {
  if (!isObject(v)) return false;
  if (v['kind'] === 'book') return true;
  if (v['kind'] === 'pages') return num(v['fromPage']) && num(v['toPage']);
  return v['kind'] === 'outline' && str(v['nodeKey']) && str(v['title']) && num(v['fromPage']) && num(v['toPage']);
};
const outlineNode: Check = (v) => isObject(v) && str(v['key']) && str(v['title']) && num(v['page']) && list(outlineNode)(v['children']);

/** The fields the app dereferences, per table (on top of the common id, updatedAt, deviceId, deleted). */
const FIELDS: Partial<Record<TableName, Record<string, Check>>> = {
  books: {
    title: str, author: str, driveFileId: str, fileName: str, sha256: str, sizeBytes: nonNeg, pageCount: nonNeg, addedAt: num, lastPageReached: nonNeg,
    outline: list(outlineNode), categoryIds: list(str), tags: list(str),
    language: oneOf('en', 'ar', 'other'), direction: oneOf('ltr', 'rtl'), status: oneOf('to-read', 'reading', 'paused', 'finished'),
    progressMode: oneOf('last-page', 'marked'), pageMode: oneOf('swipe', 'scroll'),
    coverFileId: opt(str), lastOpenedAt: opt(num), startedAt: opt(num), finishedAt: opt(num), rating: opt(num), review: opt(str),
  },
  categories: { name: str, order: num },
  upNext: { bookIds: list(str) },
  goals: { categoryId: (v) => v === null || str(v), measure: oneOf('time', 'pages'), target: nonNeg },
  settings: {
    defaultProgressMode: oneOf('last-page', 'marked'), defaultPageMode: oneOf('swipe', 'scroll'), defaultView: oneOf('page', 'reflow'),
    readerTheme: oneOf('paper', 'sepia', 'night'), weekStartsOn: oneOf(0, 1, 6), cardDirection: oneOf('en-ar', 'ar-en', 'mixed'),
    reminders: shape({
      enabled: opt(bool), days: opt(list(oneOf(0, 1, 2, 3, 4, 5, 6))), time: opt(str), quoteSource: opt(oneOf('highlights', 'builtin', 'both')),
      customQuotes: opt(list(str)), calendarId: opt(str),
    }),
  },
  annotations: {
    bookId: str, createdAt: num, tags: list(str),
    type: oneOf('highlight', 'note', 'area', 'side-note', 'summary', 'bookmark'),
    page: opt(num), color: opt(oneOf('yellow', 'green', 'blue', 'pink')), text: opt(textAnchor), rect: opt(rect), scope: opt(scope), body: opt(str),
  },
  positions: { bookId: str, page: num, offset: num, zoom: num, view: oneOf('page', 'reflow') },
  readMarks: { bookId: str, page: num, read: bool },
  sessions: { bookId: str, startedAt: num, endedAt: num, activeMs: nonNeg, pagesRead: list(num) },
};

const MAX_FUTURE_MS = 24 * 60 * 60 * 1000;

/** True when the record has the right JS type in every field the app relies on. Nothing is defaulted or dropped. */
function validRecord(table: TableName, r: unknown): r is SyncRecord {
  if (!isObject(r)) return false;
  if (typeof r['id'] !== 'string' || r['id'] === '' || typeof r['deviceId'] !== 'string') return false;
  // A far-future updatedAt would win every merge and shadow real edits.
  if (!num(r['updatedAt']) || (r['updatedAt'] as number) > Date.now() + MAX_FUTURE_MS) return false;
  if (!opt(bool)(r['deleted'])) return false;
  return Object.entries(FIELDS[table] ?? {}).every(([k, check]) => check(r[k]));
}

/**
 * Reads a backup file's text. Nothing is returned unless the whole file checks out, so a bad file
 * can never be half applied. Tables Iqra does not know are ignored.
 */
export function parseBackup(text: string): ParseResult {
  if (text.length > MAX_BACKUP_CHARS) return { ok: false, error: 'too-large' };
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { ok: false, error: 'not-json' };
  }
  if (!isObject(doc)) return { ok: false, error: 'bad-shape' };
  if (doc['schemaVersion'] !== BACKUP_VERSION) return { ok: false, error: 'wrong-version' };
  const raw = doc['tables'];
  if (!isObject(raw)) return { ok: false, error: 'bad-shape' };

  const tables: BackupTables = {};
  for (const name of BACKUP_TABLES) {
    if (!Object.prototype.hasOwnProperty.call(raw, name)) continue;
    const records = raw[name];
    if (!Array.isArray(records)) return { ok: false, error: 'bad-shape' };
    const bad = records.findIndex((r) => !validRecord(name, r));
    if (bad >= 0) return { ok: false, error: 'bad-record', table: name, index: bad };
    tables[name] = records as SyncRecord[];
  }
  return { ok: true, tables };
}

/** The sync merge rule: higher updatedAt wins, a tie goes to the higher deviceId. Records only on one side are kept. */
export function mergeInto(existing: SyncRecord[], incoming: SyncRecord[]): SyncRecord[] {
  return mergeTable(existing, incoming).merged;
}
