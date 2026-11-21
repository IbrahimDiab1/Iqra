import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthApi } from '../auth/auth.service';
import { FakeAuthService } from '../auth/fake-auth.service';
import { CLOCK } from '../core/clock';
import { DB, IqraDb, type PendingUpload } from '../core/db';
import { newId } from '../core/ids';
import type { Book } from '../core/models';
import { DRIVE_ADAPTER } from '../sync/drive-adapter';
import { FakeDrive } from '../sync/fake-drive';
import { ImportService, PDF_INSPECTOR } from './import/import.service';
import { UploadQueue } from './upload-queue';

function pdf(name: string, content: string): File {
  return new File([content], name, { type: 'application/pdf' });
}

describe('UploadQueue', () => {
  let db: IqraDb;
  let drive: FakeDrive;
  let auth: FakeAuthService;
  let queue: UploadQueue;
  let importer: ImportService;
  /** Books whose stored PDF and cover reads return nothing, as if the local files were lost. */
  let withoutBlob: Set<string>;

  beforeEach(() => {
    localStorage.clear();
    withoutBlob = new Set();
    drive = new FakeDrive();
    TestBed.configureTestingModule({
      providers: [
        { provide: DB, useFactory: () => new IqraDb(`iqra-test-${newId()}`) },
        { provide: CLOCK, useValue: { now: () => 1000 } },
        { provide: DRIVE_ADAPTER, useValue: drive },
        { provide: AuthApi, useClass: FakeAuthService },
        {
          provide: PDF_INSPECTOR,
          useValue: {
            readMeta: async () => ({ pageCount: 3, title: 'Title', author: 'Author', outline: [], language: 'en' }),
            renderCover: async () => new Blob(['jpeg'], { type: 'image/jpeg' }),
          },
        },
      ],
    });
    db = TestBed.inject(DB);
    // fake-indexeddb returns stored Blobs as plain objects in this environment, so the PDF and cover
    // are read back here as real Blobs. Only the queue's reads are stubbed.
    vi.spyOn(db.pdfFiles, 'get').mockImplementation(((bookId: string) =>
      Promise.resolve(
        withoutBlob.has(bookId)
          ? undefined
          : { bookId, blob: new Blob(['bytes'], { type: 'application/pdf' }), sizeBytes: 5, savedAt: 1000 },
      )) as never);
    vi.spyOn(db.covers, 'get').mockImplementation(((bookId: string) =>
      Promise.resolve(
        withoutBlob.has(bookId) ? undefined : { bookId, blob: new Blob(['jpeg'], { type: 'image/jpeg' }) },
      )) as never);
    auth = TestBed.inject(AuthApi) as FakeAuthService;
    queue = TestBed.inject(UploadQueue);
    importer = TestBed.inject(ImportService);
  });

  afterEach(async () => {
    await db.delete();
  });

  /** Imports one file while signed out, so the import itself does not start an upload pass. */
  async function importBook(): Promise<Book> {
    const [id] = (await importer.importFiles([pdf('book.pdf', 'bytes')])).added;
    return (await db.books.get(id))!;
  }

  async function pendingFor(bookId: string): Promise<PendingUpload[]> {
    return db.pendingUploads.where('bookId').equals(bookId).toArray();
  }

  it('uploads the PDF and cover after an import and a run', async () => {
    const book = await importBook();
    await auth.signIn();

    await queue.run();

    const stored = (await db.books.get(book.id))!;
    expect(stored.driveFileId).not.toBe('');
    expect(stored.coverFileId).toBeDefined();
    expect(await pendingFor(book.id)).toEqual([]);

    const state = JSON.parse(drive.exportState()) as {
      entries: { id: string; space: string; info: { appProperties?: Record<string, string> } }[];
    };
    const pdfFile = state.entries.find((e) => e.id === stored.driveFileId);
    expect(pdfFile?.space).toBe('drive');
    expect(pdfFile?.info.appProperties?.['iqraBookId']).toBe(book.id);
  });

  it('leaves uploads waiting for Wi-Fi when mobile data is off and the connection is cellular', async () => {
    const book = await importBook();
    await auth.signIn();
    localStorage.setItem('iqra.device.syncOnMobile', 'false');
    Object.defineProperty(navigator, 'connection', { value: { type: 'cellular' }, configurable: true });
    try {
      await queue.run();
      expect((await pendingFor(book.id)).length).toBeGreaterThan(0);
      expect((await db.books.get(book.id))!.driveFileId).toBe('');
    } finally {
      Object.defineProperty(navigator, 'connection', { value: undefined, configurable: true });
    }
    await queue.run();
    expect(await pendingFor(book.id)).toEqual([]);
  });

  it('keeps a failed entry with one attempt, then succeeds on the next run', async () => {
    const book = await importBook();
    await auth.signIn();
    const realUpload = drive.uploadPdf.bind(drive);
    vi.spyOn(drive, 'uploadPdf').mockRejectedValueOnce(new Error('network down')).mockImplementation(realUpload);

    await queue.run();

    expect((await pendingFor(book.id)).find((u) => u.kind === 'pdf')?.attempts).toBe(1);
    expect((await db.books.get(book.id))!.driveFileId).toBe('');

    await queue.run();

    expect(await pendingFor(book.id)).toEqual([]);
    expect((await db.books.get(book.id))!.driveFileId).not.toBe('');
  });

  it('reports progress to 1 during the PDF upload, then clears it', async () => {
    const book = await importBook();
    await auth.signIn();
    const realUpload = drive.uploadPdf.bind(drive);
    const seen: (number | undefined)[] = [];
    vi.spyOn(drive, 'uploadPdf').mockImplementation(async (blob, name, folderId, bookId, onProgress) => {
      onProgress?.(0.5);
      seen.push(queue.progress().get(bookId));
      const info = await realUpload(blob, name, folderId, bookId, onProgress);
      seen.push(queue.progress().get(bookId));
      return info;
    });

    await queue.run();

    expect(seen).toEqual([0.5, 1]);
    expect(queue.progress().has(book.id)).toBe(false);
    expect(await pendingFor(book.id)).toEqual([]);
  });

  it('drops an entry whose local blob is missing before uploading the entries behind it', async () => {
    const [badId] = (await importer.importFiles([pdf('bad.pdf', 'bad')])).added;
    const [goodId] = (await importer.importFiles([pdf('good.pdf', 'good')])).added;
    withoutBlob.add(badId);
    // The queue takes entries in key order, so the bad book's rows get the lower keys.
    for (const [bookId, prefix] of [
      [badId, '0-bad'],
      [goodId, '1-good'],
    ] as const) {
      const rows = await pendingFor(bookId);
      await db.pendingUploads.bulkDelete(rows.map((r) => r.id));
      await db.pendingUploads.bulkPut(rows.map((r) => ({ ...r, id: `${prefix}-${r.kind}` })));
    }
    await auth.signIn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const upload = vi.spyOn(drive, 'uploadPdf');

    await queue.run();

    expect(warn.mock.invocationCallOrder[0]).toBeLessThan(upload.mock.invocationCallOrder[0]);
    expect(await pendingFor(badId)).toEqual([]);
    expect(await pendingFor(goodId)).toEqual([]);
    expect((await db.books.get(goodId))!.driveFileId).not.toBe('');
    warn.mockRestore();
  });

  it('does nothing while signed out', async () => {
    const book = await importBook();

    await queue.run();

    expect(await pendingFor(book.id)).toHaveLength(2);
    expect((await db.books.get(book.id))!.driveFileId).toBe('');
  });

  it('queues a Drive delete, and keeps no id, when the book was deleted during its upload', async () => {
    const book = await importBook();
    await auth.signIn();
    const realUpload = drive.uploadPdf.bind(drive);
    vi.spyOn(drive, 'uploadPdf').mockImplementation(async (...args) => {
      await db.books.put({ ...(await db.books.get(book.id))!, deleted: true });
      return realUpload(...args);
    });

    await queue.run();

    const stored = (await db.books.get(book.id))!;
    expect(stored.driveFileId).toBe('');
    expect(await db.pendingDriveDeletes.count()).toBeGreaterThan(0);
  });

  it('runs once more when run() is called while a run is in progress', async () => {
    const book = await importBook();
    await auth.signIn();
    const realUpload = drive.uploadPdf.bind(drive);
    let late: Promise<void> | undefined;
    vi.spyOn(drive, 'uploadPdf').mockImplementation(async (...args) => {
      // A second book is queued and run() requested while the first upload is running.
      const [id2] = (await importer.importFiles([pdf('second.pdf', 'second')])).added;
      late = queue.run();
      void id2;
      return realUpload(...args);
    });

    await queue.run();
    await late;

    expect(await db.pendingUploads.count()).toBe(0);
    expect((await db.books.get(book.id))!.driveFileId).not.toBe('');
  });

  it('sets quotaFull and keeps the entry when Drive is full', async () => {
    const book = await importBook();
    await auth.signIn();
    const { DriveQuotaError } = await import('../sync/drive-adapter');
    vi.spyOn(drive, 'uploadPdf').mockRejectedValueOnce(new DriveQuotaError());

    await queue.run();

    expect(queue.quotaFull()).toBe(true);
    expect((await pendingFor(book.id)).some((u) => u.kind === 'pdf')).toBe(true);
    expect(auth.state()).toBe('signed-in');
  });

  it('releases its lock when an upload stalls, so the next run is not stuck behind it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const book = await importBook();
      await auth.signIn();
      vi.spyOn(drive, 'uploadPdf').mockReturnValueOnce(new Promise(() => {}));
      const stalled = queue.run();
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      await stalled;

      await queue.run();
      expect((await pendingFor(book.id)).some((u) => u.kind === 'pdf')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
