import { Injectable, Signal, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Observable, Subject, from } from 'rxjs';
import { liveQuery, type Table } from 'dexie';
import { CLOCK } from './clock';
import { DB } from './db';
import { DEVICE_ID } from './ids';
import type { ID, SyncMeta, SyncRecord, TableName } from './models';

export interface RepoChange {
  table: TableName;
  rec: SyncRecord;
}

/**
 * Local read/write access to the database. Local writes stamp updatedAt and
 * deviceId and emit on changes$ (the sync engine listens to it). Remote writes
 * go through applyRemote, which stamps nothing and emits nothing.
 */
@Injectable({ providedIn: 'root' })
export class Repo {
  private readonly db = inject(DB);
  private readonly clock = inject(CLOCK);
  private readonly deviceId = inject(DEVICE_ID);
  private readonly changes = new Subject<RepoChange>();

  readonly changes$: Observable<RepoChange> = this.changes.asObservable();

  /** Writes a record, stamping updatedAt and deviceId. Returns the stored record. */
  async put<T extends SyncMeta>(
    table: TableName,
    rec: Omit<T, 'updatedAt' | 'deviceId'> & Partial<SyncMeta>,
  ): Promise<T> {
    const stamped = { ...rec, updatedAt: this.clock.now(), deviceId: this.deviceId } as unknown as T;
    await this.table(table).put(stamped);
    this.changes.next({ table, rec: stamped as SyncRecord });
    return stamped;
  }

  /** Marks a record deleted. The record stays so the deletion can sync. No-op if it does not exist. */
  async softDelete(table: TableName, id: ID): Promise<void> {
    await this.modify(table, id, () => ({ deleted: true }), true);
  }

  /**
   * Read-modify-write in one transaction, so concurrent updates cannot overwrite each other's fields.
   * The patcher returns the fields to change, or null for no change. Returns the stored record, or
   * undefined when the record is missing, deleted, or left unchanged. Emits on changes$ after commit.
   */
  update<T extends SyncMeta>(table: TableName, id: ID, patcher: (current: T) => Partial<T> | null): Promise<T | undefined> {
    return this.modify(table, id, patcher, false);
  }

  private async modify<T extends SyncMeta>(
    table: TableName,
    id: ID,
    patcher: (current: T) => Partial<T> | null,
    includeDeleted: boolean,
  ): Promise<T | undefined> {
    const store = this.table(table);
    const stored = await this.db.transaction('rw', store, async () => {
      const existing = (await store.get(id)) as T | undefined;
      const patch = existing && (includeDeleted || !existing.deleted) ? patcher(existing) : null;
      if (!patch) return undefined;
      const rec = { ...existing, ...patch, updatedAt: this.clock.now(), deviceId: this.deviceId } as T;
      await store.put(rec);
      return rec;
    });
    if (stored) this.changes.next({ table, rec: stored as unknown as SyncRecord });
    return stored;
  }

  /** Writes remote records as they are: no stamping, no change events. Used by the sync engine. */
  async applyRemote<T extends SyncMeta>(table: TableName, recs: T[]): Promise<void> {
    await this.table(table).bulkPut(recs);
  }

  /**
   * A signal that follows a Dexie query. Undefined until the first result.
   * Must be called in an injection context (a constructor or field initializer);
   * the subscription ends when that context is destroyed.
   */
  live<T>(query: () => Promise<T>): Signal<T | undefined> {
    return toSignal(from(liveQuery(query)));
  }

  private table(name: TableName): Table<SyncMeta, ID> {
    return this.db.table<SyncMeta, ID>(name);
  }
}
