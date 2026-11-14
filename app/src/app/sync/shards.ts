import { SyncRecord, TableName } from '../core/models';

export const SCHEMA_VERSION = 1 as const;

/** The JSON document stored in one Drive file. */
export interface ShardDoc {
  schemaVersion: 1;
  tables: Partial<Record<TableName, SyncRecord[]>>;
}

/** The Drive file name a record lives in. */
export function shardFor(table: TableName, rec: SyncRecord): string {
  switch (table) {
    case 'books':
    case 'categories':
    case 'upNext':
    case 'goals':
    case 'settings':
      return 'library.json';
    case 'annotations':
    case 'positions':
    case 'readMarks':
      return `book-${String(rec['bookId'])}.json`;
    case 'sessions': {
      const d = new Date(rec['startedAt'] as number);
      const month = String(d.getUTCMonth() + 1).padStart(2, '0');
      return `sessions-${d.getUTCFullYear()}-${month}.json`;
    }
    case 'words':
      return 'words.json';
  }
}
