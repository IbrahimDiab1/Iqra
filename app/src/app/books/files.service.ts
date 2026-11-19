import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { Router, type Params } from '@angular/router';
import { CLOCK } from '../core/clock';
import { DB } from '../core/db';
import { newId } from '../core/ids';
import type { Book, ID, SyncMeta, TableName, UpNext } from '../core/models';
import { Repo } from '../core/repo';
import { DRIVE_ADAPTER } from '../sync/drive-adapter';
import { COPY } from '../ui/copy';
import { ToastService } from '../ui/toast.service';

/** How long a deletion can be undone. Drive files are only removed after this. */
export const UNDO_MS = 10_000;
/** Added to the undo window before Drive files may be deleted, so a late Undo is still safe. */
const UNDO_MARGIN_MS = 30_000;
const UPNEXT_ID = 'up-next';

interface SoftDeleted {
  table: TableName;
  id: ID;
}

/** Opening, downloading, streaming and removing books, and the sheets that ask about them. */
@Injectable({ providedIn: 'root' })
export class FilesService {
  private readonly db = inject(DB);
  private readonly repo = inject(Repo);
  private readonly drive = inject(DRIVE_ADAPTER);
  private readonly clock = inject(CLOCK);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  private readonly downloadedIds = this.repo.live(() => this.db.pdfFiles.toCollection().primaryKeys());
  /** Book ids with a PDF kept on this device. */
  readonly downloaded: Signal<Set<ID>> = computed(() => new Set(this.downloadedIds() ?? []));

  private readonly progress = signal<Map<ID, number>>(new Map());
  /** Download progress as a 0..1 fraction, for books being downloaded now. */
  readonly downloadProgress: Signal<Map<ID, number>> = this.progress.asReadonly();

  /** Books with an operation in flight. A second call for the same book while one runs is a no-op. */
  private readonly downloading = new Set<ID>();
  private readonly removing = new Set<ID>();
  private readonly deleting = new Set<ID>();

  private readonly openSheet = signal<Book | null>(null);
  /** The book the open sheet is asking about, or null when it is closed. */
  readonly openSheetBook: Signal<Book | null> = this.openSheet.asReadonly();

  private readonly removeSheet = signal<Book | null>(null);
  /** The book the remove sheet is asking about, or null when it is closed. */
  readonly removeSheetBook: Signal<Book | null> = this.removeSheet.asReadonly();

  /** Query params for the reader, held while the open sheet decides how to open that book. */
  private openParams: Params | undefined;

  /**
   * Opens a downloaded book, or asks how to open one that is not on this device.
   * `params` (for example a page and an annotation) go to the reader whichever way it opens.
   */
  openBook(b: Book, params?: Params): void {
    this.openParams = params;
    void this.resolveOpen(b);
  }

  private async resolveOpen(b: Book): Promise<void> {
    if (await this.db.pdfFiles.get(b.id)) {
      this.navigateToBook(b.id);
      return;
    }
    if (b.driveFileId === '') {
      this.toast.show(COPY.library.uploadingElsewhere);
      return;
    }
    this.openSheet.set(b);
  }

  /**
   * Stores the PDF on this device. Opens it afterwards unless `open` is false (fetch ahead).
   * Shows a toast on failure.
   */
  async download(b: Book, opts: { open?: boolean } = {}): Promise<void> {
    if (this.downloading.has(b.id)) return;
    this.downloading.add(b.id);
    this.setProgress(b.id, 0);
    try {
      // Waits for Wi-Fi when the owner turned off mobile data. A failed load of the check never blocks.
      if (await import('../core/network-gate').then((g) => g.blockedOnMobile(this.toast, false), () => false)) return;
      const blob = await this.drive.downloadBlob(b.driveFileId, (fraction) => this.setProgress(b.id, fraction));
      await this.db.pdfFiles.put({ bookId: b.id, blob, sizeBytes: blob.size, savedAt: this.clock.now() });
    } catch {
      this.toast.show(COPY.open.failed);
      return;
    } finally {
      this.downloading.delete(b.id);
      this.setProgress(b.id, null);
    }
    if (opts.open === false) return;
    this.openSheet.set(null);
    this.navigateToBook(b.id);
  }

  /** Opens a book by reading its PDF from Drive. Nothing is stored. */
  stream(b: Book): void {
    this.openSheet.set(null);
    void this.router.navigate(['/read', b.id], { queryParams: { ...this.takeOpenParams(), source: 'drive' } });
  }

  /** Deletes the local PDF and keeps the book and its notes. */
  async removeLocal(b: Book): Promise<void> {
    if (this.removing.has(b.id)) return;
    this.removing.add(b.id);
    this.removeSheet.set(null);
    try {
      // A PDF that is not on Drive yet exists only here, so it must stay.
      const current = (await this.db.books.get(b.id)) ?? b;
      if (current.driveFileId === '') {
        this.toast.show(COPY.remove.stillUploading);
        return;
      }
      await this.db.pdfFiles.delete(b.id);
      this.toast.show(COPY.remove.removedDevice);
    } finally {
      this.removing.delete(b.id);
    }
  }

  /**
   * Soft-deletes the book and its notes, and queues its Drive files for deletion after the undo window.
   * The local PDF is removed when the toast expires without undo.
   */
  async deleteEverywhere(b: Book): Promise<void> {
    if (this.deleting.has(b.id)) return;
    this.deleting.add(b.id);
    // Closes before any await, so a second tap cannot reach this method again.
    this.removeSheet.set(null);
    try {
      await this.softDeleteBook(b);
    } finally {
      this.deleting.delete(b.id);
    }
  }

  private async softDeleteBook(b: Book): Promise<void> {
    const { db } = this;
    const current = await db.books.get(b.id);
    if (!current || current.deleted) return;
    const targets: SoftDeleted[] = [{ table: 'books', id: b.id }];
    for (const table of ['annotations', 'positions', 'readMarks'] as const) {
      const rows = (await db.table<SyncMeta>(table).where('bookId').equals(b.id).toArray()).filter((r) => !r.deleted);
      targets.push(...rows.map((r) => ({ table, id: r.id })));
    }
    for (const { table, id } of targets) await this.repo.softDelete(table, id);

    const upNextBefore = await db.upNext.get(UPNEXT_ID);
    const wasUpNext = upNextBefore?.bookIds.includes(b.id) ? upNextBefore : undefined;
    if (wasUpNext) {
      await this.repo.put<UpNext>('upNext', {
        ...wasUpNext,
        bookIds: wasUpNext.bookIds.filter((id) => id !== b.id),
      });
    }

    const shard = await db.syncState.get(`book-${b.id}.json`);
    const fileIds = [b.driveFileId, b.coverFileId, shard?.remoteId].filter((id): id is string => !!id);
    const notBefore = this.clock.now() + UNDO_MS + UNDO_MARGIN_MS;
    await db.pendingDriveDeletes.bulkPut(fileIds.map((fileId) => ({ fileId, notBefore })));

    let settled = false;
    const expiry = setTimeout(() => {
      settled = true;
      void db.pdfFiles.delete(b.id);
    }, UNDO_MS);
    this.toast.show(COPY.remove.deleted(b.title), {
      durationMs: UNDO_MS,
      undo: () => {
        if (settled) return;
        clearTimeout(expiry);
        void this.restore(b.id, targets, wasUpNext, fileIds);
      },
    });
  }

  closeOpenSheet(): void {
    this.openSheet.set(null);
    this.openParams = undefined;
  }

  closeRemoveSheet(): void {
    this.removeSheet.set(null);
  }

  requestRemove(b: Book): void {
    this.removeSheet.set(b);
  }

  private async restore(bookId: ID, targets: SoftDeleted[], upNext: UpNext | undefined, fileIds: string[]): Promise<void> {
    await this.db.pendingDriveDeletes.bulkDelete(fileIds);
    for (const { table, id } of targets) {
      const rec = await this.db.table<SyncMeta>(table).get(id);
      if (rec) await this.repo.put(table, { ...rec, deleted: false });
    }
    await this.requeueUploads(bookId);
    if (upNext) {
      const current = await this.db.upNext.get(UPNEXT_ID);
      if (current && !current.bookIds.includes(bookId)) {
        const bookIds = [...current.bookIds];
        bookIds.splice(upNext.bookIds.indexOf(bookId), 0, bookId);
        await this.repo.put<UpNext>('upNext', { ...current, bookIds });
      }
    }
  }

  /** The upload queue may have dropped this book's entries while it was deleted; add them back. */
  private async requeueUploads(bookId: ID): Promise<void> {
    const book = await this.db.books.get(bookId);
    if (!book) return;
    const existing = await this.db.pendingUploads.where('bookId').equals(bookId).toArray();
    const wanted: ('pdf' | 'cover')[] = [];
    if (book.driveFileId === '' && (await this.db.pdfFiles.get(bookId))) wanted.push('pdf');
    if (!book.coverFileId && (await this.db.covers.get(bookId))) wanted.push('cover');
    for (const kind of wanted) {
      if (!existing.some((u) => u.kind === kind)) {
        await this.db.pendingUploads.put({ id: newId(), bookId, kind, attempts: 0 });
      }
    }
  }

  private setProgress(id: ID, fraction: number | null): void {
    this.progress.update((map) => {
      const next = new Map(map);
      if (fraction === null) next.delete(id);
      else next.set(id, fraction);
      return next;
    });
  }

  private navigateToBook(id: ID): void {
    void this.router.navigate(['/read', id], { queryParams: this.takeOpenParams() });
  }

  private takeOpenParams(): Params {
    const held = this.openParams;
    this.openParams = undefined;
    return held ?? {};
  }
}
