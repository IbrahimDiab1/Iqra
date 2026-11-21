import { InjectionToken, signal } from '@angular/core';
import Dexie, { type Table } from 'dexie';
import type {
  Annotation,
  Book,
  Category,
  Goal,
  ID,
  Position,
  ReadMark,
  ReadingSession,
  Settings,
  ReviewItem,
  UpNext,
} from './models';

/** A PDF kept on this device only. Never synced. */
export interface PdfFile {
  bookId: ID;
  blob: Blob;
  sizeBytes: number;
  savedAt: number;
}

/** A device-side cache of a cover JPEG. */
export interface CoverFile {
  bookId: ID;
  blob: Blob;
}

/** Per-shard sync bookkeeping, owned by the sync engine. */
export interface SyncState {
  shard: string;
  remoteId?: string;
  remoteModified?: string;
  dirty: boolean;
  error?: string;
}

/** A cached translation, keyed by direction and text. Local only. */
export interface TranslationCacheEntry {
  key: string;
  translation: string;
  at: number;
}

/** An upload that has not finished yet. */
export interface PendingUpload {
  id: ID;
  bookId: ID;
  kind: 'pdf' | 'cover';
  attempts: number;
}

/** A Drive file to delete once it is safe to do so. */
export interface PendingDriveDelete {
  fileId: string;
  notBefore: number;
}

/** The local IndexedDB database. Synced stores mirror models.ts. */
export class IqraDb extends Dexie {
  declare books: Table<Book, ID>;
  declare categories: Table<Category, ID>;
  declare upNext: Table<UpNext, ID>;
  declare goals: Table<Goal, ID>;
  declare settings: Table<Settings, ID>;
  declare annotations: Table<Annotation, ID>;
  declare positions: Table<Position, ID>;
  declare readMarks: Table<ReadMark, ID>;
  declare sessions: Table<ReadingSession, ID>;
  declare review: Table<ReviewItem, ID>;
  declare pdfFiles: Table<PdfFile, ID>;
  declare covers: Table<CoverFile, ID>;
  declare syncState: Table<SyncState, string>;
  declare pendingUploads: Table<PendingUpload, ID>;
  declare pendingDriveDeletes: Table<PendingDriveDelete, string>;
  declare translationCache: Table<TranslationCacheEntry, string>;

  /** True while an upgrade of this database is waiting for another tab (an old version of the app) to let go. */
  private readonly blockedSignal = signal(false);
  readonly blocked = this.blockedSignal.asReadonly();

  /**
   * Another tab opened a newer version of the database: this connection must close or that upgrade waits forever, and the
   * new tab (or this one, after a deploy) then shows no data. Close and reload to pick up the new code.
   * `hooks.reload` is replaced in tests.
   */
  constructor(name = 'iqra', hooks: { reload?: () => void } = {}) {
    super(name);
    const reload = hooks.reload ?? (() => location.reload());
    this.on('versionchange', () => {
      this.close();
      reload();
      return false;
    });
    this.on('blocked', () => this.blockedSignal.set(true));
    this.on('ready', () => this.blockedSignal.set(false));
    this.version(1).stores({
      books: 'id, updatedAt, sha256, status, lastOpenedAt, addedAt',
      categories: 'id',
      upNext: 'id',
      goals: 'id',
      settings: 'id',
      annotations: 'id, bookId, updatedAt',
      positions: 'id, bookId',
      readMarks: 'id, bookId',
      sessions: 'id, bookId, startedAt',
      words: 'id',
      pdfFiles: 'bookId',
      covers: 'bookId',
      syncState: 'shard',
      pendingUploads: 'id, bookId',
      pendingDriveDeletes: 'fileId',
    });
    // The language notebook replaces the unused `words` store; translations are cached locally.
    this.version(2).stores({
      words: null,
      review: 'id, bookId, updatedAt',
      translationCache: 'key',
    });
  }
}

/** The app database. Tests provide a fresh IqraDb with a unique name. */
export const DB = new InjectionToken<IqraDb>('db', {
  providedIn: 'root',
  factory: () => new IqraDb(),
});
