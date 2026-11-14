import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import type { Subscription } from 'rxjs';
import { AuthApi } from '../auth/auth.service';
import { CLOCK } from '../core/clock';
import { DB, SyncState } from '../core/db';
import type { Annotation, ID, Position, ReadMark, ReadingSession, SyncRecord, TableName } from '../core/models';
import { Repo } from '../core/repo';
import { COPY } from '../ui/copy';
import { DRIVE_ADAPTER, DriveAuthError, DriveFileInfo } from './drive-adapter';
import { duplicateBooks, mergeTable, pruneTombstones, wins } from './merge';
import { SCHEMA_VERSION, ShardDoc, shardFor } from './shards';

export type SyncStatus = 'synced' | 'saving' | 'offline' | 'paused' | 'error';

type ShardTables = ShardDoc['tables'];

const TABLES: TableName[] = [
  'books',
  'categories',
  'upNext',
  'goals',
  'settings',
  'annotations',
  'positions',
  'readMarks',
  'sessions',
  'words',
];
const DEBOUNCE_MS = 5000;
const INTERVAL_MS = 120_000;

/** Parses a shard file. Null when it is not JSON, or it was written by a newer schema. */
function parseShardDoc(text: string): ShardDoc | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof json !== 'object' || json === null) return null;
  const doc = json as Partial<ShardDoc>;
  if (typeof doc.schemaVersion !== 'number' || doc.schemaVersion > SCHEMA_VERSION) return null;
  if (typeof doc.tables !== 'object' || doc.tables === null || Array.isArray(doc.tables)) return null;
  return { schemaVersion: SCHEMA_VERSION, tables: doc.tables };
}

/**
 * Keeps local records and the Drive appDataFolder in step (spec section 8).
 * Local writes arrive through Repo.changes$; each pass pulls changed files, removes duplicate
 * books, then pushes the dirty shards. Local changes are never dropped: a shard's dirty flag is
 * cleared only before its push starts, and set again if the push fails.
 */
@Injectable({ providedIn: 'root' })
export class SyncEngine implements OnDestroy {
  private readonly db = inject(DB);
  private readonly repo = inject(Repo);
  private readonly drive = inject(DRIVE_ADAPTER);
  private readonly auth = inject(AuthApi);
  private readonly clock = inject(CLOCK);

  private readonly statusSignal = signal<SyncStatus>('paused');
  private readonly lastSyncedSignal = signal<number | null>(null);
  private readonly lastErrorSignal = signal<string | null>(null);
  readonly status = this.statusSignal.asReadonly();
  readonly lastSyncedAt = this.lastSyncedSignal.asReadonly();
  readonly lastError = this.lastErrorSignal.asReadonly();

  /** Called after a pass that dropped duplicate books, so the app can clean up local copies. */
  onAfterPull: ((dropped: { keep: ID; drop: ID }[]) => Promise<void>) | null = null;

  private inFlight: Promise<void> | null = null;
  private started = false;
  private changesSub: Subscription | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private intervalTimer: ReturnType<typeof setInterval> | undefined;
  private readonly onVisible = (): void => {
    if (document.visibilityState === 'visible') void this.syncNow();
  };
  private readonly onOnline = (): void => {
    void this.syncNow();
  };

  /** Subscribes to local changes and registers the sync triggers. Calling it again does nothing. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.changesSub = this.repo.changes$.subscribe(({ table, rec }) => this.onLocalChange(table, rec));
    document.addEventListener('visibilitychange', this.onVisible);
    window.addEventListener('online', this.onOnline);
    this.intervalTimer = setInterval(() => void this.syncNow(), INTERVAL_MS);
  }

  /** Runs one pass. Concurrent calls share the running pass. */
  syncNow(): Promise<void> {
    this.inFlight ??= this.run().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  ngOnDestroy(): void {
    this.changesSub?.unsubscribe();
    clearTimeout(this.debounceTimer);
    clearInterval(this.intervalTimer);
    document.removeEventListener('visibilitychange', this.onVisible);
    window.removeEventListener('online', this.onOnline);
    this.started = false;
  }

  private onLocalChange(table: TableName, rec: SyncRecord): void {
    const shard = shardFor(table, rec);
    this.statusSignal.set(!navigator.onLine ? 'offline' : this.auth.token() === null ? 'paused' : 'saving');
    this.patchState(shard, { dirty: true }).catch((error: unknown) => this.handleFailure(error));
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => void this.syncNow(), DEBOUNCE_MS);
  }

  private async run(): Promise<void> {
    if (!navigator.onLine) {
      this.statusSignal.set('offline');
      return;
    }
    if (this.auth.token() === null) {
      this.statusSignal.set('paused');
      return;
    }
    try {
      if (await this.db.syncState.filter((s) => s.dirty).first()) this.statusSignal.set('saving');
      await this.runDueDeletes();
      const listing = await this.drive.listAppData();
      const errors = await this.pull(listing);
      await this.removeDuplicateBooks();
      errors.push(...(await this.push(listing)));
      if (errors.length > 0) {
        this.setError(errors[0]);
        return;
      }
      this.lastErrorSignal.set(null);
      this.lastSyncedSignal.set(this.clock.now());
      this.statusSignal.set('synced');
    } catch (error) {
      this.handleFailure(error);
    }
  }

  private handleFailure(error: unknown): void {
    if (error instanceof DriveAuthError) {
      this.auth.markExpired();
      this.statusSignal.set('paused');
      return;
    }
    this.setError(error instanceof Error ? error.message : String(error));
  }

  private setError(message: string): void {
    this.lastErrorSignal.set(message);
    this.statusSignal.set('error');
  }

  /** Downloads each changed file and merges it into the local tables. Returns the unreadable-file messages. */
  private async pull(listing: DriveFileInfo[]): Promise<string[]> {
    const errors: string[] = [];
    for (const file of listing) {
      const state = await this.db.syncState.get(file.name);
      if (state?.remoteId === file.id && state.remoteModified === file.modifiedTime && !state.error) continue;

      const doc = parseShardDoc(await this.drive.readText(file.id));
      if (!doc) {
        const message = COPY.sync.unreadable(file.name);
        await this.patchState(file.name, { error: message });
        errors.push(message);
        continue;
      }
      await this.db.transaction('rw', this.syncTables(), async () => {
        const { needsPush } = await this.mergeIntoLocal(file.name, doc);
        await this.patchState(file.name, {
          remoteId: file.id,
          remoteModified: file.modifiedTime,
          error: undefined,
          ...(needsPush ? { dirty: true } : {}),
        });
      });
    }
    return errors;
  }

  /**
   * Merges a shard's remote records into the local tables. Runs inside the sync transaction.
   * Local records compared are those in this shard and those whose id the file holds, so a
   * record moved to another shard still loses to a newer local copy.
   */
  private async mergeIntoLocal(shard: string, remote: ShardDoc): Promise<{ merged: ShardTables; needsPush: boolean }> {
    const now = this.clock.now();
    const merged: ShardTables = {};
    let needsPush = false;
    for (const table of TABLES) {
      const remoteRecs = remote.tables[table] ?? [];
      const remoteIds = new Set(remoteRecs.map((r) => r.id));
      const local = ((await this.db.table(table).toArray()) as SyncRecord[]).filter(
        (r) => shardFor(table, r) === shard || remoteIds.has(r.id),
      );
      const result = mergeTable(pruneTombstones(local, now), remoteRecs);
      await this.applyRemote(table, result.toLocal);
      needsPush ||= result.needsPush;
      const kept = pruneTombstones(result.merged, now);
      if (kept.length > 0) merged[table] = kept;
    }
    return { merged, needsPush };
  }

  private async applyRemote(table: TableName, recs: SyncRecord[]): Promise<void> {
    if (recs.length === 0) return;
    await this.repo.applyRemote(table, recs);
    if (table !== 'books') return;
    for (const rec of recs) {
      if (rec.deleted) {
        await this.queueDriveDeletes([rec['driveFileId'] as string | undefined, rec['coverFileId'] as string | undefined]);
      }
    }
  }

  /**
   * Keeps the earliest copy of each book and drops the rest. The dropped book's records move to
   * the kept book first, so a crash part-way leaves the next pass to finish the job.
   */
  private async removeDuplicateBooks(): Promise<void> {
    const books = await this.db.books.toArray();
    const pairs = duplicateBooks(books);
    if (pairs.length === 0) return;
    const byId = new Map(books.map((book) => [book.id, book]));
    for (const { keep, drop } of pairs) {
      const kept = byId.get(keep)!;
      const dropped = byId.get(drop)!;
      const shared = new Set([kept.driveFileId, kept.coverFileId]);
      await this.queueDriveDeletes([dropped.driveFileId, dropped.coverFileId].filter((f) => !shared.has(f)));
      await this.moveBookRecords(drop, keep);
      await this.repo.softDelete('books', drop);
    }
    await this.onAfterPull?.(pairs);
  }

  private async moveBookRecords(drop: ID, keep: ID): Promise<void> {
    const annotations = await this.db.annotations.where('bookId').equals(drop).toArray();
    for (const annotation of annotations) {
      await this.repo.put<Annotation>('annotations', { ...annotation, bookId: keep });
    }
    const sessions = await this.db.sessions.where('bookId').equals(drop).toArray();
    for (const session of sessions) {
      await this.repo.put<ReadingSession>('sessions', { ...session, bookId: keep });
    }
    // Position and read-mark ids start with the book id, so they are re-keyed.
    const positions = await this.db.positions.where('bookId').equals(drop).toArray();
    for (const position of positions) {
      const id = `${keep}:${position.deviceId}`;
      const existing = await this.db.positions.get(id);
      if (!existing || wins(position, existing)) {
        await this.repo.put<Position>('positions', { ...position, id, bookId: keep });
      }
      await this.repo.softDelete('positions', position.id);
    }
    const readMarks = await this.db.readMarks.where('bookId').equals(drop).toArray();
    for (const mark of readMarks) {
      const id = `${keep}:${mark.page}`;
      const existing = await this.db.readMarks.get(id);
      if (!existing || wins(mark, existing)) {
        await this.repo.put<ReadMark>('readMarks', { ...mark, id, bookId: keep });
      }
      await this.repo.softDelete('readMarks', mark.id);
    }
  }

  /** Writes the shards that changed locally. Returns the unreadable-file messages. */
  private async push(listing: DriveFileInfo[]): Promise<string[]> {
    const listedIds = new Map<string, string>();
    for (const file of listing) if (!listedIds.has(file.name)) listedIds.set(file.name, file.id);

    const errors: string[] = [];
    const dirty = await this.db.syncState.filter((s) => s.dirty && !s.error).toArray();
    for (const state of dirty) {
      const message = await this.pushShard(state, listedIds.get(state.shard));
      if (message) errors.push(message);
    }
    return errors;
  }

  private async pushShard(state: SyncState, listedId: string | undefined): Promise<string | null> {
    const shard = state.shard;
    const fileId = state.remoteId ?? listedId;
    // Cleared before the read, so a change made during the push sets it again.
    await this.patchState(shard, { dirty: false });
    try {
      const remote: ShardDoc | null = fileId
        ? parseShardDoc(await this.drive.readText(fileId))
        : { schemaVersion: SCHEMA_VERSION, tables: {} };
      if (!remote) {
        const message = COPY.sync.unreadable(shard);
        await this.patchState(shard, { dirty: true, error: message });
        return message;
      }
      const { merged } = await this.db.transaction('rw', this.syncTables(), () => this.mergeIntoLocal(shard, remote));
      const json = JSON.stringify({ schemaVersion: SCHEMA_VERSION, tables: merged } satisfies ShardDoc);
      const info = await this.drive.writeAppDataJson(shard, json, fileId);
      await this.patchState(shard, { remoteId: info.id, remoteModified: info.modifiedTime, error: undefined });
      return null;
    } catch (error) {
      await this.patchState(shard, { dirty: true });
      throw error;
    }
  }

  /** Deletes Drive files queued by duplicate cleanup and deleted books. Failed deletes stay queued. */
  private async runDueDeletes(): Promise<void> {
    const now = this.clock.now();
    const due = (await this.db.pendingDriveDeletes.toArray()).filter((d) => d.notBefore <= now);
    for (const pending of due) {
      try {
        await this.drive.deleteFile(pending.fileId);
      } catch (error) {
        if (error instanceof DriveAuthError) throw error;
        continue;
      }
      await this.db.pendingDriveDeletes.delete(pending.fileId);
    }
  }

  private async queueDriveDeletes(fileIds: (string | undefined)[]): Promise<void> {
    const now = this.clock.now();
    for (const fileId of fileIds) {
      if (fileId) await this.db.pendingDriveDeletes.put({ fileId, notBefore: now });
    }
  }

  /** Read-modify-write on one shard's state. Atomic, so a concurrent dirty flag is not lost. */
  private patchState(shard: string, patch: Partial<SyncState>): Promise<void> {
    return this.db.transaction('rw', this.db.syncState, async () => {
      const existing = await this.db.syncState.get(shard);
      await this.db.syncState.put({ dirty: existing?.dirty ?? false, ...existing, shard, ...patch });
    });
  }

  private syncTables() {
    return [...TABLES.map((table) => this.db.table(table)), this.db.syncState, this.db.pendingDriveDeletes];
  }
}
