import { createEnvironmentInjector, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthApi } from '../auth/auth.service';
import { FakeAuthService } from '../auth/fake-auth.service';
import { CLOCK } from '../core/clock';
import { DB, IqraDb } from '../core/db';
import { DEVICE_ID } from '../core/ids';
import type { Annotation, Book, Category, ID } from '../core/models';
import { Repo } from '../core/repo';
import { UploadQueue } from '../books/upload-queue';
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
      UploadQueue,
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
    vi.useRealTimers();
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

  /** Imports a book offline: the record, its PDF blob and the pending upload, as ImportService does. */
  async function importOffline(device: Device, id: ID, annotationId: string): Promise<void> {
    await device.repo.put<Book>('books', bookDraft(id, { sha256: 'same', addedAt: 1, driveFileId: '' }));
    await device.db.pdfFiles.put({ bookId: id, blob: new Blob([`pdf-${id}`]), sizeBytes: 1, savedAt: 1 });
    await device.db.pendingUploads.put({ id: `up-${id}`, bookId: id, kind: 'pdf', attempts: 0 });
    await device.repo.put<Annotation>('annotations', { id: annotationId, bookId: id, type: 'bookmark', tags: [], createdAt: 1 });
  }

  /** Blobs read back from fake-indexeddb are not real Blobs; FakeDrive needs a real one. Returns the upload spy. */
  function trackUploads() {
    const pdf = drive.uploadPdf.bind(drive);
    const cover = drive.writeAppDataBlob.bind(drive);
    vi.spyOn(drive, 'writeAppDataBlob').mockImplementation((name, _blob, id) => cover(name, new Blob(['cover']), id));
    return vi.spyOn(drive, 'uploadPdf').mockImplementation((_blob, ...rest) => pdf(new Blob(['pdf']), ...rest));
  }

  /** Syncs both devices in turn, with each clock moving on so later writes are later. */
  async function syncRounds(rounds: number): Promise<void> {
    for (let i = 0; i < rounds; i++) {
      for (const device of [a, b]) {
        device.clock.t += 100;
        await device.engine.syncNow();
      }
    }
  }

  async function liveBooks(device: Device): Promise<Book[]> {
    return (await device.db.books.toArray()).filter((book) => !book.deleted);
  }

  it('N1a: two devices import the same PDF and both upload; one book, its file and notes survive', async () => {
    trackUploads();
    await importOffline(a, 'ba', 'an-a');
    await importOffline(b, 'bb', 'an-b');
    await a.injector.get(UploadQueue).run();
    await b.injector.get(UploadQueue).run();
    expect((await a.db.books.get('ba'))?.driveFileId).not.toBe('');
    expect((await b.db.books.get('bb'))?.driveFileId).not.toBe('');

    await syncRounds(4);

    for (const device of [a, b]) {
      const live = await liveBooks(device);
      expect(live.map((book) => book.id)).toEqual(['ba']);
      await expect(drive.downloadBlob(live[0].driveFileId)).resolves.toBeInstanceOf(Blob);
      const notes = await device.db.annotations.where('bookId').equals('ba').toArray();
      expect(notes.filter((n) => !n.deleted).map((n) => n.id).sort()).toEqual(['an-a', 'an-b']);
    }
  });

  it('N1b: the kept book takes over the dropped book\'s file ids; the file is kept and not uploaded twice', async () => {
    const upload = trackUploads();
    await importOffline(a, 'ba', 'an-a');
    await importOffline(b, 'bb', 'an-b');
    await b.db.covers.put({ bookId: 'bb', blob: new Blob(['cover']) });
    await b.db.pendingUploads.put({ id: 'up-cover-bb', bookId: 'bb', kind: 'cover', attempts: 0 });
    await b.injector.get(UploadQueue).run();
    const uploaded = await b.db.books.get('bb');
    expect(uploaded?.driveFileId).not.toBe('');
    expect(uploaded?.coverFileId).toBeTruthy();
    await b.engine.syncNow();

    // A has not uploaded. Its duplicate pass keeps ba and takes over bb's ids.
    await a.engine.syncNow();
    const kept = await a.db.books.get('ba');
    expect(kept?.driveFileId).toBe(uploaded?.driveFileId);
    expect(kept?.coverFileId).toBe(uploaded?.coverFileId);
    expect(await a.db.pendingDriveDeletes.toArray()).toEqual([]);

    // The pending PDF upload on A is dropped, since ba now has a file.
    upload.mockClear();
    await a.injector.get(UploadQueue).run();
    expect(upload).not.toHaveBeenCalled();
    expect(await a.db.pendingUploads.where('bookId').equals('ba').count()).toBe(0);

    await syncRounds(3);
    for (const device of [a, b]) {
      const live = await liveBooks(device);
      expect(live.map((book) => book.id)).toEqual(['ba']);
      await expect(drive.downloadBlob(live[0].driveFileId)).resolves.toBeInstanceOf(Blob);
    }
  });

  it('N1c: with neither uploaded, one book remains and it uploads once', async () => {
    const upload = trackUploads();
    await importOffline(a, 'ba', 'an-a');
    await importOffline(b, 'bb', 'an-b');
    await syncRounds(3);
    expect((await liveBooks(a)).map((book) => book.id)).toEqual(['ba']);
    expect((await liveBooks(b)).map((book) => book.id)).toEqual(['ba']);

    await a.injector.get(UploadQueue).run();
    await b.injector.get(UploadQueue).run();
    await syncRounds(3);

    expect(upload).toHaveBeenCalledTimes(1);
    const live = await liveBooks(b);
    expect(live[0].driveFileId).not.toBe('');
    await expect(drive.downloadBlob(live[0].driveFileId)).resolves.toBeInstanceOf(Blob);
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

  it('recreates a shard file that was deleted from Drive and reports synced', async () => {
    await a.repo.put<Book>('books', bookDraft('b1', { title: 'Before' }));
    await a.engine.syncNow();
    const file = (await drive.listAppData()).find((f) => f.name === 'library.json')!;
    await drive.deleteFile(file.id);

    await a.repo.put<Book>('books', { ...(await a.db.books.get('b1'))!, title: 'After' });
    await a.engine.syncNow();

    expect(a.engine.status()).toBe('synced');
    const remote = await remoteShard(drive, 'library.json');
    expect(remote.tables.books?.[0]).toMatchObject({ id: 'b1', title: 'After' });
  });

  it('abandons a run that stalls for five minutes and syncs again on the next call', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.spyOn(drive, 'listAppData').mockReturnValueOnce(new Promise(() => {}));

    const stalled = a.engine.syncNow();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await stalled;

    expect(a.engine.status()).toBe('error');
    expect(a.engine.lastError()).toBe('Sync timed out');

    await a.engine.syncNow();
    expect(a.engine.status()).toBe('synced');
  });

  it('stays saving and syncs again when a change lands during a run', async () => {
    await a.repo.put<Book>('books', bookDraft('b1'));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const write = drive.writeAppDataJson.bind(drive);
    let injected = false;
    vi.spyOn(drive, 'writeAppDataJson').mockImplementation(async (name, json, fileId) => {
      // The write has already been merged, so this record misses the file the run uploads.
      if (!injected) {
        injected = true;
        await a.repo.put<Book>('books', bookDraft('b2'));
      }
      return write(name, json, fileId);
    });

    await a.engine.syncNow();
    expect(a.engine.status()).toBe('saving');

    await vi.advanceTimersByTimeAsync(5000);
    await a.engine.syncNow();

    expect(a.engine.status()).toBe('synced');
    const remote = await remoteShard(drive, 'library.json');
    expect(remote.tables.books?.map((r) => r.id).sort()).toEqual(['b1', 'b2']);
  });

  it('shares one run between concurrent syncNow calls', async () => {
    const listAppData = vi.spyOn(drive, 'listAppData');

    await Promise.all([a.engine.syncNow(), a.engine.syncNow()]);

    expect(listAppData).toHaveBeenCalledTimes(1);
  });

  it('ignores cover blobs in appData and reports synced', async () => {
    await a.repo.put<Book>('books', bookDraft('b1'));
    await drive.writeAppDataBlob('cover-b1.jpg', new Blob(['jpeg'], { type: 'image/jpeg' }));
    const readText = vi.spyOn(drive, 'readText');

    await a.engine.syncNow();

    expect(a.engine.status()).toBe('synced');
    expect(a.engine.lastError()).toBeNull();
    const coverId = (await drive.listAppData()).find((f) => f.name === 'cover-b1.jpg')!.id;
    expect(readText).not.toHaveBeenCalledWith(coverId);
    expect(await a.db.syncState.get('cover-b1.jpg')).toBeUndefined();
  });

  it('marks the shard dirty for a write made inside a Dexie transaction, and pushes it', async () => {
    await a.db.transaction('rw', a.db.categories, async () => {
      await a.repo.put<Category>('categories', { id: 'c1', name: 'Fiqh', order: 0 });
    });
    await vi.waitFor(async () => expect((await a.db.syncState.get('library.json'))?.dirty).toBe(true));
    expect(a.engine.status()).not.toBe('error');

    await a.engine.syncNow();

    expect(a.engine.status()).toBe('synced');
    const remote = await remoteShard(drive, 'library.json');
    expect(remote.tables.categories?.map((r) => r.id)).toEqual(['c1']);
  });

  it('uses the catalog and import transactions without losing the dirty flag', async () => {
    const { CatalogService } = await import('../books/catalog.service');
    const catalog = runInInjectionContext(a.injector, () => new CatalogService());
    await catalog.addCategory('Hadith');
    await catalog.toggleUpNext('b1', true);
    await vi.waitFor(async () => expect((await a.db.syncState.get('library.json'))?.dirty).toBe(true));

    await a.engine.syncNow();

    const remote = await remoteShard(drive, 'library.json');
    expect(remote.tables.categories?.map((r) => (r as { name?: string }).name)).toEqual(['Hadith']);
    expect((remote.tables.upNext?.[0] as { bookIds?: string[] }).bookIds).toEqual(['b1']);
  });

  it('runs the upload queue even when a shard is unreadable', async () => {
    await drive.writeAppDataJson('library.json', JSON.stringify({ schemaVersion: 99, tables: {} }));
    const run = vi.spyOn(a.injector.get(UploadQueue), 'run').mockResolvedValue();

    await a.engine.syncNow();

    expect(a.engine.status()).toBe('error');
    expect(run).toHaveBeenCalled();
  });

  it('sweeps local files of deleted books older than 15 s and keeps younger ones', async () => {
    await a.repo.put<Book>('books', bookDraft('old'));
    await a.repo.put<Book>('books', bookDraft('young'));
    for (const id of ['old', 'young']) {
      await a.db.pdfFiles.put({ bookId: id, blob: new Blob(['x']), sizeBytes: 1, savedAt: 1 });
      await a.db.covers.put({ bookId: id, blob: new Blob(['x']) });
    }
    a.clock.t = 1000;
    await a.repo.softDelete('books', 'old');
    a.clock.t = 20_000;
    await a.repo.softDelete('books', 'young');
    a.clock.t = 21_000;

    await a.engine.syncNow();

    expect(await a.db.pdfFiles.get('old')).toBeUndefined();
    expect(await a.db.covers.get('old')).toBeUndefined();
    expect(await a.db.pdfFiles.get('young')).toBeDefined();
  });

  it('resume tries a silent renewal when expired, then syncs', async () => {
    a.auth.markExpired();
    const trySilent = vi.spyOn(a.auth, 'trySilent');

    await a.engine.resume();

    expect(trySilent).toHaveBeenCalled();
    expect(a.engine.status()).toBe('synced');
  });
});
