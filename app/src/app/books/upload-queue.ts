import { Injectable, inject, signal } from '@angular/core';
import { AuthApi } from '../auth/auth.service';
import { DB, type PendingUpload } from '../core/db';
import type { Book, ID } from '../core/models';
import { Repo } from '../core/repo';
import { DRIVE_ADAPTER, DriveAuthError } from '../sync/drive-adapter';

/**
 * Sends local PDFs and covers to Drive. Each entry in db.pendingUploads stays until its upload
 * succeeds. The queue runs one entry at a time; a failure counts an attempt and stops the run,
 * so the next run retries it. Runs after each successful sync and after each import.
 */
@Injectable({ providedIn: 'root' })
export class UploadQueue {
  private readonly db = inject(DB);
  private readonly repo = inject(Repo);
  private readonly drive = inject(DRIVE_ADAPTER);
  private readonly auth = inject(AuthApi);

  private readonly progressSignal = signal<Map<ID, number>>(new Map());
  /** Upload fraction per book, for PDFs only. A book is absent while its PDF is not uploading. */
  readonly progress = this.progressSignal.asReadonly();

  private inFlight: Promise<void> | null = null;
  /** The Books folder id, looked up once per session. */
  private booksFolderId: string | null = null;

  /** Processes the queue. Concurrent calls share the running pass. Does nothing offline or when signed out. */
  run(): Promise<void> {
    this.inFlight ??= this.drain().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async drain(): Promise<void> {
    if (!navigator.onLine || this.auth.token() === null) return;
    for (;;) {
      const next = await this.db.pendingUploads.toCollection().first();
      if (!next) return;
      try {
        await this.process(next);
      } catch (error) {
        await this.db.pendingUploads.update(next.id, { attempts: next.attempts + 1 });
        if (error instanceof DriveAuthError) this.auth.markExpired();
        else console.error('Upload failed', error);
        return;
      }
    }
  }

  private async process(entry: PendingUpload): Promise<void> {
    const book = await this.db.books.get(entry.bookId);
    const blob = await this.localBlob(entry);
    // Nothing to upload for a book that was removed as a duplicate, or whose local file is gone.
    // Dropping the entry keeps it from blocking the entries behind it.
    if (!book || book.deleted || !blob) {
      console.warn('Dropped a pending upload with nothing to send', entry);
    } else if (entry.kind === 'pdf') {
      await this.uploadPdf(book, blob);
    } else {
      await this.uploadCover(book, blob);
    }
    await this.db.pendingUploads.delete(entry.id);
  }

  private async localBlob(entry: PendingUpload): Promise<Blob | undefined> {
    if (entry.kind === 'pdf') return (await this.db.pdfFiles.get(entry.bookId))?.blob;
    return (await this.db.covers.get(entry.bookId))?.blob;
  }

  private async uploadPdf(book: Book, blob: Blob): Promise<void> {
    if (book.driveFileId) return;
    this.booksFolderId ??= await this.drive.ensureBooksFolder();
    this.setProgress(book.id, 0);
    try {
      const info = await this.drive.uploadPdf(blob, book.fileName, this.booksFolderId, book.id, (fraction) =>
        this.setProgress(book.id, fraction),
      );
      await this.saveFileIds(book.id, { driveFileId: info.id });
    } finally {
      this.clearProgress(book.id);
    }
  }

  private async uploadCover(book: Book, blob: Blob): Promise<void> {
    if (book.coverFileId) return;
    const info = await this.drive.writeAppDataBlob(`cover-${book.id}.jpg`, blob);
    await this.saveFileIds(book.id, { coverFileId: info.id });
  }

  /** Re-reads the book so edits made during the upload are kept. */
  private async saveFileIds(bookId: ID, ids: Partial<Pick<Book, 'driveFileId' | 'coverFileId'>>): Promise<void> {
    const current = await this.db.books.get(bookId);
    if (current) await this.repo.put<Book>('books', { ...current, ...ids });
  }

  private setProgress(bookId: ID, fraction: number): void {
    this.progressSignal.update((map) => new Map(map).set(bookId, fraction));
  }

  private clearProgress(bookId: ID): void {
    this.progressSignal.update((map) => {
      const next = new Map(map);
      next.delete(bookId);
      return next;
    });
  }
}
