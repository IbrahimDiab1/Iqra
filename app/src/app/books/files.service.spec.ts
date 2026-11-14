import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthApi } from '../auth/auth.service';
import { FakeAuthService } from '../auth/fake-auth.service';
import { CLOCK } from '../core/clock';
import { DB, IqraDb } from '../core/db';
import { newId } from '../core/ids';
import type { Annotation, Book, ReadMark, UpNext } from '../core/models';
import { DRIVE_ADAPTER } from '../sync/drive-adapter';
import { FakeDrive } from '../sync/fake-drive';
import { SyncEngine } from '../sync/sync-engine';
import { COPY } from '../ui/copy';
import { ToastService } from '../ui/toast.service';
import { FilesService, UNDO_MS } from './files.service';

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    id: 'book-1',
    deviceId: 'device-a',
    updatedAt: 1000,
    title: 'Kitab',
    author: 'Author',
    driveFileId: '',
    fileName: 'kitab.pdf',
    sizeBytes: 3 * 1024 * 1024,
    sha256: 'abc',
    pageCount: 10,
    outline: [],
    language: 'en',
    direction: 'ltr',
    addedAt: 1000,
    status: 'to-read',
    categoryIds: [],
    tags: [],
    progressMode: 'last-page',
    pageMode: 'swipe',
    lastPageReached: 0,
    ...overrides,
  };
}

describe('FilesService', () => {
  let db: IqraDb;
  let drive: FakeDrive;
  let clock: { t: number };
  let files: FilesService;
  let toast: ToastService;
  let router: Router;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    localStorage.clear();
    db = new IqraDb(`iqra-test-${newId()}`);
    drive = new FakeDrive();
    clock = { t: 1000 };
    TestBed.configureTestingModule({
      providers: [
        { provide: DB, useValue: db },
        { provide: CLOCK, useValue: { now: () => clock.t } },
        { provide: DRIVE_ADAPTER, useValue: drive },
        { provide: AuthApi, useClass: FakeAuthService },
      ],
    });
    files = TestBed.inject(FilesService);
    toast = TestBed.inject(ToastService);
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await db.delete();
  });

  /** Lets pending IndexedDB work settle. Macrotasks run while fake timers stay frozen. */
  async function settle(): Promise<void> {
    for (let i = 0; i < 20; i++) {
      await new Promise<void>((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => resolve();
        channel.port2.postMessage(null);
      });
    }
  }

  /** Uploads a PDF to FakeDrive and returns the book that points at it. */
  async function uploadedBook(overrides: Partial<Book> = {}): Promise<Book> {
    const info = await drive.uploadPdf(new Blob(['%PDF']), 'kitab.pdf', 'folder', 'book-1');
    return makeBook({ driveFileId: info.id, ...overrides });
  }

  it('opens a downloaded book straight to the reader', async () => {
    const book = await uploadedBook();
    await db.pdfFiles.put({ bookId: book.id, blob: new Blob(['%PDF']), sizeBytes: 4, savedAt: 1000 });

    files.openBook(book);
    await settle();

    expect(router.navigate).toHaveBeenCalledWith(['/read', book.id]);
    expect(files.openSheetBook()).toBeNull();
  });

  it('opens the sheet for a book that is not on this device', async () => {
    const book = await uploadedBook();

    files.openBook(book);
    await settle();

    expect(files.openSheetBook()).toEqual(book);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('shows the uploading-elsewhere toast for a book with no Drive file', async () => {
    const book = makeBook({ driveFileId: '' });

    files.openBook(book);
    await settle();

    expect(toast.current()?.message).toBe(COPY.library.uploadingElsewhere);
    expect(files.openSheetBook()).toBeNull();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('downloads the PDF into pdfFiles, then opens the reader', async () => {
    const book = await uploadedBook();

    await files.download(book);

    const stored = await db.pdfFiles.get(book.id);
    expect(stored).toMatchObject({ bookId: book.id, sizeBytes: 4 });
    expect(files.downloadProgress().has(book.id)).toBe(false);
    expect(router.navigate).toHaveBeenCalledWith(['/read', book.id]);
  });

  it('stores the PDF without opening the reader when open is false', async () => {
    const book = await uploadedBook();

    await files.download(book, { open: false });

    expect(await db.pdfFiles.get(book.id)).toMatchObject({ bookId: book.id, sizeBytes: 4 });
    expect(files.downloadProgress().has(book.id)).toBe(false);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('shows the failure toast and stores nothing when the download fails', async () => {
    const book = await uploadedBook();
    drive.failNext(new TypeError());

    await files.download(book);

    expect(toast.current()?.message).toBe(COPY.open.failed);
    expect(await db.pdfFiles.get(book.id)).toBeUndefined();
    expect(files.downloadProgress().has(book.id)).toBe(false);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('streams a book with the source=drive query and no stored copy', async () => {
    const book = await uploadedBook();

    files.stream(book);

    expect(router.navigate).toHaveBeenCalledWith(['/read', book.id], { queryParams: { source: 'drive' } });
    expect(await db.pdfFiles.get(book.id)).toBeUndefined();
  });

  it('removes only the local PDF and keeps the book', async () => {
    const book = await uploadedBook();
    await db.books.put(book);
    await db.pdfFiles.put({ bookId: book.id, blob: new Blob(['%PDF']), sizeBytes: 4, savedAt: 1000 });

    await files.removeLocal(book);

    expect(await db.pdfFiles.get(book.id)).toBeUndefined();
    expect((await db.books.get(book.id))?.deleted).toBeFalsy();
    expect(toast.current()?.message).toBe(COPY.remove.removedDevice);
  });

  describe('deleteEverywhere', () => {
    async function seed(book: Book): Promise<void> {
      await db.books.put(book);
      await db.upNext.put({ id: 'up-next', bookIds: [book.id, 'other'], deviceId: 'device-a', updatedAt: 1000 } as UpNext);
      await db.annotations.put({
        id: 'ann-1',
        bookId: book.id,
        type: 'bookmark',
        tags: [],
        createdAt: 1000,
        deviceId: 'device-a',
        updatedAt: 1000,
      } as Annotation);
      await db.readMarks.put({ id: `${book.id}:3`, bookId: book.id, page: 3, read: true, deviceId: 'device-a', updatedAt: 1000 } as ReadMark);
      await db.positions.put({ id: `${book.id}:device-a`, bookId: book.id, page: 1, offset: 0, zoom: 1, view: 'page', deviceId: 'device-a', updatedAt: 1000 });
      await db.pdfFiles.put({ bookId: book.id, blob: new Blob(['%PDF']), sizeBytes: 4, savedAt: 1000 });
      await db.syncState.put({ shard: `book-${book.id}.json`, remoteId: 'shard-file', dirty: false });
    }

    it('undo within 10 s restores the book and its notes and clears the pending Drive deletes', async () => {
      const book = await uploadedBook({ coverFileId: 'cover-file' });
      await seed(book);

      await files.deleteEverywhere(book);
      await settle();

      expect((await db.books.get(book.id))?.deleted).toBe(true);
      expect((await db.annotations.get('ann-1'))?.deleted).toBe(true);
      expect((await db.upNext.get('up-next'))?.bookIds).toEqual(['other']);
      expect(await db.pendingDriveDeletes.count()).toBe(3);
      expect(toast.current()?.message).toBe(COPY.remove.deleted(book.title));

      toast.undo();
      await settle();

      expect((await db.books.get(book.id))?.deleted).toBe(false);
      expect((await db.annotations.get('ann-1'))?.deleted).toBe(false);
      expect((await db.readMarks.get(`${book.id}:3`))?.deleted).toBe(false);
      expect((await db.upNext.get('up-next'))?.bookIds).toEqual([book.id, 'other']);
      expect(await db.pendingDriveDeletes.count()).toBe(0);
      expect(await db.pdfFiles.get(book.id)).toBeDefined();
    });

    it('a double call is a no-op, and one undo restores everything', async () => {
      const book = await uploadedBook();
      await seed(book);

      await Promise.all([files.deleteEverywhere(book), files.deleteEverywhere(book)]);
      await settle();
      toast.undo();
      await settle();

      expect((await db.books.get(book.id))?.deleted).toBe(false);
      expect((await db.annotations.get('ann-1'))?.deleted).toBe(false);
      expect((await db.positions.get(`${book.id}:device-a`))?.deleted).toBe(false);
      expect((await db.readMarks.get(`${book.id}:3`))?.deleted).toBe(false);
      expect((await db.upNext.get('up-next'))?.bookIds).toEqual([book.id, 'other']);
      expect(await db.pendingDriveDeletes.count()).toBe(0);
    });

    it('without undo, removes the local PDF after 10 s and the Drive files on the next sync', async () => {
      const book = await uploadedBook();
      await seed(book);
      const engine = TestBed.inject(SyncEngine);
      await (TestBed.inject(AuthApi) as FakeAuthService).signIn();

      await files.deleteEverywhere(book);
      await settle();
      expect(await db.pdfFiles.get(book.id)).toBeDefined();

      vi.advanceTimersByTime(UNDO_MS);
      await settle();
      expect(await db.pdfFiles.get(book.id)).toBeUndefined();

      clock.t += UNDO_MS;
      await engine.syncNow();

      await expect(drive.downloadBlob(book.driveFileId)).rejects.toThrow();
      expect(await db.pendingDriveDeletes.count()).toBe(0);
    });
  });
});
