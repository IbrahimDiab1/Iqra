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
  | { ok: false; error: 'not-json' | 'wrong-version' | 'bad-shape' | 'too-large' };

/** Every table's records, tombstones included. PDFs and covers are not part of a backup. */
export function buildBackup(tables: BackupTables, now: number): Backup {
  return { schemaVersion: BACKUP_VERSION, exportedAt: now, tables };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A record must be placeable: the sync layer files it by bookId or startedAt, so those must exist. */
function validRecord(table: TableName, r: unknown): r is SyncRecord {
  if (!isObject(r)) return false;
  if (typeof r['id'] !== 'string' || r['id'] === '' || typeof r['updatedAt'] !== 'number' || !Number.isFinite(r['updatedAt'])) return false;
  if ((table === 'annotations' || table === 'positions' || table === 'readMarks') && typeof r['bookId'] !== 'string') return false;
  if (table === 'sessions' && (typeof r['startedAt'] !== 'number' || !Number.isFinite(r['startedAt']))) return false;
  return true;
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
    const list = raw[name];
    if (!Array.isArray(list)) return { ok: false, error: 'bad-shape' };
    if (!list.every((r) => validRecord(name, r))) return { ok: false, error: 'bad-shape' };
    tables[name] = list as SyncRecord[];
  }
  return { ok: true, tables };
}

/** The sync merge rule: higher updatedAt wins, a tie goes to the higher deviceId. Records only on one side are kept. */
export function mergeInto(existing: SyncRecord[], incoming: SyncRecord[]): SyncRecord[] {
  return mergeTable(existing, incoming).merged;
}
