import { createEnvironmentInjector, EnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthApi } from '../auth/auth.service';
import { FakeAuthService } from '../auth/fake-auth.service';
import { CLOCK } from '../core/clock';
import { DB, IqraDb } from '../core/db';
import { DEVICE_ID } from '../core/ids';
import type { Annotation, Book, ID } from '../core/models';
import { Repo } from '../core/repo';
import { DRIVE_ADAPTER, DriveAuthError } from './drive-adapter';
import { FakeDrive } from './fake-drive';
import { SyncEngine } from './sync-engine';
import type { ShardDoc } from './shards';

interface Device {
  db: IqraDb;
  clock: { t: number };
  auth: FakeAuthService;
  repo: Repo;
  engine: SyncEngine;
  injector: EnvironmentInjector;
}

const devices: Device[] = [];

/** One simulated device: its own database, clock, device id and sync engine, sharing one Drive. */
function makeDevice(name: string, deviceId: string, drive: FakeDrive): Device {
  const db = new IqraDb(name);
  const clock = { t: 1000 };
  const auth = new FakeAuthService();
  const injector = createEnvironmentInjector(
    [
      { provide: DB, useValue: db },
      { provide: CLOCK, useValue: { now: () => clock.t } },
      { provide: DEVICE_ID, useValue: deviceId },
      { provide: DRIVE_ADAPTER, useValue: drive },
      { provide: AuthApi, useValue: auth },
      Repo,
      SyncEngine,
    ],
    TestBed.inject(EnvironmentInjector),
  );
  const device: Device = { db, clock, auth, repo: injector.get(Repo), engine: injector.get(SyncEngine), injector };
  device.engine.start();
  devices.push(device);
  return device;
}

function bookDraft(id: ID, overrides: Partial<Book> = {}): Omit<Book, 'updatedAt' | 'deviceId'> {
  return {
    id,
    title: 'Sample',
    author: 'Author',
    driveFileId: `drive-${id}`,
    fileName: 'sample.pdf',
    sizeBytes: 1,
    sha256: `sha-${id}`,
    pageCount: 3,
    outline: [],
    language: 'en',
    direction: 'ltr',
    addedAt: 1,
    status: 'to-read',
    categoryIds: [],
    tags: [],
    progressMode: 'last-page',
    pageMode: 'swipe',
    lastPageReached: 0,
    ...overrides,
  };
}

/** Reads one shard file from the fake Drive, as another device would see it. */
async function remoteShard(drive: FakeDrive, name: string): Promise<ShardDoc> {
  const file = (await drive.listAppData()).find((f) => f.name === name);
  if (!file) throw new Error(`${name} is not on Drive`);
  return JSON.parse(await drive.readText(file.id)) as ShardDoc;
}

/** Makes the next write to Drive fail with a DriveAuthError, after the pull has already succeeded. */
function failNextWrite(drive: FakeDrive, error: Error): void {
  const write = drive.writeAppDataJson.bind(drive);
  vi.spyOn(drive, 'writeAppDataJson').mockImplementationOnce((name, json, fileId) => {
    drive.failNext(error);
    return write(name, json, fileId);
  });
}

describe('SyncEngine', () => {
  let drive: FakeDrive;
  let a: Device;
  let b: Device;

  beforeEach(async () => {
    drive = new FakeDrive();
    a = makeDevice('iqra-a', 'device-a', drive);
    b = makeDevice('iqra-b', 'device-b', drive);
    await a.auth.signIn();
    await b.auth.signIn();
  });

  afterEach(async () => {
    for (const device of devices.splice(0)) {
      device.injector.destroy();
      await device.db.delete();
    }
    vi.restoreAllMocks();
  });

  it('carries a book from device A to device B with its updatedAt', async () => {
    a.clock.t = 10;
    await a.repo.put<Book>('books', bookDraft('b1'));

    await a.engine.syncNow();
    expect(a.engine.status()).toBe('synced');
    expect((await drive.listAppData()).map((f) => f.name)).toContain('library.json');

    await b.engine.syncNow();
    const onB = await b.db.books.get('b1');
    expect(onB?.title).toBe('Sample');
    expect(onB?.updatedAt).toBe(10);
  });

  it('keeps B\'s title when A and B edit the same book in turn', async () => {
    a.clock.t = 1;
    await a.repo.put<Book>('books', bookDraft('b1', { title: 'Original' }));
    await a.engine.syncNow();
    await b.engine.syncNow();

    a.clock.t = 10;
    await a.repo.put<Book>('books', { ...(await a.db.books.get('b1'))!, title: 'From A' });
    await a.engine.syncNow();

    b.clock.t = 20;
    await b.repo.put<Book>('books', { ...(await b.db.books.get('b1'))!, title: 'From B' });
    await b.engine.syncNow();

    await a.engine.syncNow();
    expect((await a.db.books.get('b1'))?.title).toBe('From B');
    expect((await b.db.books.get('b1'))?.title).toBe('From B');
  });

  it('pauses on a DriveAuthError during push, keeps dirty, and pushes after reconnecting', async () => {
    await a.repo.put<Book>('books', bookDraft('b1'));
    const markExpired = vi.spyOn(a.auth, 'markExpired');
    failNextWrite(drive, new DriveAuthError());

    await a.engine.syncNow();

    expect(a.engine.status()).toBe('paused');
    expect(markExpired).toHaveBeenCalled();
    expect((await a.db.syncState.get('library.json'))?.dirty).toBe(true);

    await a.auth.reconnect();
    await a.engine.syncNow();

    expect((await a.db.syncState.get('library.json'))?.dirty).toBe(false);
    const remote = await remoteShard(drive, 'library.json');
    expect(remote.tables.books?.map((r) => r.id)).toEqual(['b1']);
  });

  it('marks an unreadable library.json as an error, never writes it, and still syncs other shards', async () => {
    await drive.writeAppDataJson('library.json', '{not json');
    await a.repo.put<Book>('books', bookDraft('b1'));
    await a.repo.put<Annotation>('annotations', { id: 'an1', bookId: 'x', type: 'bookmark', tags: [], createdAt: 1 });

    await expect(a.engine.syncNow()).resolves.toBeUndefined();

    expect(a.engine.status()).toBe('error');
    expect(a.engine.lastError()).toContain('library.json');
    const libraryFile = (await drive.listAppData()).find((f) => f.name === 'library.json')!;
    expect(await drive.readText(libraryFile.id)).toBe('{not json');
    const bookShard = await remoteShard(drive, 'book-x.json');
    expect(bookShard.tables.annotations?.map((r) => r.id)).toEqual(['an1']);
  });

  it('keeps one live copy of a duplicate book and queues the dropped PDF for deletion', async () => {
    a.clock.t = 1;
    await a.repo.put<Book>('books', bookDraft('ba', { sha256: 'h', addedAt: 1, driveFileId: 'drive-a' }));
    b.clock.t = 2;
    await b.repo.put<Book>('books', bookDraft('bb', { sha256: 'h', addedAt: 2, driveFileId: 'drive-b' }));

    await a.engine.syncNow();
    await b.engine.syncNow();
    await a.engine.syncNow();

    const live = (await a.db.books.toArray()).filter((book) => !book.deleted);
    expect(live.map((book) => ({ id: book.id, addedAt: book.addedAt }))).toEqual([{ id: 'ba', addedAt: 1 }]);
    // B's own duplicate pass decided the drop, so B queues the PDF. A only pulled the tombstone.
    expect((await b.db.pendingDriveDeletes.toArray()).map((p) => p.fileId)).toContain('drive-b');
    expect(await a.db.pendingDriveDeletes.toArray()).toEqual([]);
  });

  it('does not queue a Drive delete when a device pulls a tombstoned book', async () => {
    await a.repo.put<Book>('books', bookDraft('b1', { driveFileId: 'drive-b1' }));
    await a.engine.syncNow();
    await a.repo.softDelete('books', 'b1');
    await a.engine.syncNow();

    await b.engine.syncNow();

    expect((await b.db.books.get('b1'))?.deleted).toBe(true);
    expect(await b.db.pendingDriveDeletes.toArray()).toEqual([]);
  });

  it('merges two Drive files with the same shard name and leaves one', async () => {
    await drive.writeAppDataJson('library.json', JSON.stringify({ schemaVersion: 1, tables: { books: [{ ...bookDraft('b1'), updatedAt: 5, deviceId: 'x' }] } }));
    await drive.writeAppDataJson('library.json', JSON.stringify({ schemaVersion: 1, tables: { books: [{ ...bookDraft('b2'), updatedAt: 6, deviceId: 'y' }] } }));

    await a.engine.syncNow();

    expect(a.engine.status()).toBe('synced');
    expect((await a.db.books.toArray()).map((book) => book.id).sort()).toEqual(['b1', 'b2']);
    const libraries = (await drive.listAppData()).filter((f) => f.name === 'library.json');
    expect(libraries).toHaveLength(1);
    const remote = await remoteShard(drive, 'library.json');
    expect(remote.tables.books?.map((r) => r.id).sort()).toEqual(['b1', 'b2']);
  });

  it('is offline with no adapter calls when navigator.onLine is false', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const listAppData = vi.spyOn(drive, 'listAppData');
    const readText = vi.spyOn(drive, 'readText');
    const writeAppDataJson = vi.spyOn(drive, 'writeAppDataJson');
    const deleteFile = vi.spyOn(drive, 'deleteFile');

    await a.repo.put<Book>('books', bookDraft('b1'));
    await a.engine.syncNow();

    expect(a.engine.status()).toBe('offline');
    expect(listAppData).not.toHaveBeenCalled();
    expect(readText).not.toHaveBeenCalled();
    expect(writeAppDataJson).not.toHaveBeenCalled();
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it('shares one run between concurrent syncNow calls', async () => {
    const listAppData = vi.spyOn(drive, 'listAppData');

    await Promise.all([a.engine.syncNow(), a.engine.syncNow()]);

    expect(listAppData).toHaveBeenCalledTimes(1);
  });
});
