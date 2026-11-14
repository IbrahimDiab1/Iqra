import { Injectable, InjectionToken, inject } from '@angular/core';
import { CLOCK } from '../../core/clock';
import { DB } from '../../core/db';
import { newId } from '../../core/ids';
import type { Book, ID, Settings } from '../../core/models';
import { Repo } from '../../core/repo';
import { COPY } from '../../ui/copy';
import { ToastService } from '../../ui/toast.service';
import { UploadQueue } from '../upload-queue';
import { renderCover } from './cover';
import { sha256Hex } from './hash';
import { cleanTitle, readPdfMeta, UnreadablePdfError, type PdfMeta } from './pdf-meta';

/** The PDF work an import needs. Tests replace it so no real pdf.js runs. */
export interface PdfInspector {
  readMeta(blob: Blob): Promise<PdfMeta>;
  renderCover(blob: Blob): Promise<Blob>;
}

export const PDF_INSPECTOR = new InjectionToken<PdfInspector>('pdfInspector', {
  providedIn: 'root',
  factory: () => ({ readMeta: readPdfMeta, renderCover }),
});

export interface ImportResult {
  added: ID[];
  /** File names of files that were not added (duplicates or unreadable). */
  skipped: string[];
}

@Injectable({ providedIn: 'root' })
export class ImportService {
  private readonly db = inject(DB);
  private readonly repo = inject(Repo);
  private readonly clock = inject(CLOCK);
  private readonly toast = inject(ToastService);
  private readonly inspector = inject(PDF_INSPECTOR);
  private readonly uploads = inject(UploadQueue);

  /**
   * Imports files in order. A file that fails is skipped and the rest still import. Failures are
   * reported in one final toast, so a success toast cannot hide them.
   */
  async importFiles(files: File[]): Promise<ImportResult> {
    const settings = await this.db.settings.get('settings');
    const added: ID[] = [];
    const skipped: string[] = [];
    let lastFailure: string | null = null;

    for (const file of files) {
      try {
        const id = await this.importOne(file, settings);
        if (id) added.push(id);
        else {
          lastFailure = COPY.import.duplicate(file.name);
          skipped.push(file.name);
        }
      } catch (err) {
        if (!(err instanceof UnreadablePdfError)) console.error('Import failed', err);
        lastFailure = COPY.import.unreadable(file.name);
        skipped.push(file.name);
      }
    }

    if (lastFailure !== null) {
      this.toast.show(added.length > 0 ? `${COPY.import.added(added.length)}. ${lastFailure}` : lastFailure);
    } else if (added.length > 0) {
      this.toast.show(COPY.import.added(added.length));
    }
    if (added.length > 0) void this.uploads.run();
    return { added, skipped };
  }

  /** Returns the new book id, or undefined when the file is a duplicate. */
  private async importOne(file: File, settings: Settings | undefined): Promise<ID | undefined> {
    const sha256 = await sha256Hex(file);
    const existing = await this.db.books.where('sha256').equals(sha256).filter((b) => !b.deleted).first();
    if (existing) return undefined;

    const meta = await this.inspector.readMeta(file);
    const cover = await this.inspector.renderCover(file);

    const bookId = newId();
    const now = this.clock.now();
    await this.db.transaction('rw', [this.db.books, this.db.pdfFiles, this.db.covers, this.db.pendingUploads], async () => {
      await this.repo.put<Book>('books', {
        id: bookId,
        title: cleanTitle(meta.title, file.name),
        author: meta.author,
        driveFileId: '',
        fileName: file.name,
        sizeBytes: file.size,
        sha256,
        pageCount: meta.pageCount,
        outline: meta.outline,
        language: meta.language,
        direction: meta.language === 'ar' ? 'rtl' : 'ltr',
        addedAt: now,
        status: 'to-read',
        categoryIds: [],
        tags: [],
        progressMode: settings?.defaultProgressMode ?? 'last-page',
        pageMode: settings?.defaultPageMode ?? 'swipe',
        lastPageReached: 0,
      });
      await this.db.pdfFiles.put({ bookId, blob: file, sizeBytes: file.size, savedAt: now });
      await this.db.covers.put({ bookId, blob: cover });
      await this.db.pendingUploads.bulkPut([
        { id: newId(), bookId, kind: 'pdf', attempts: 0 },
        { id: newId(), bookId, kind: 'cover', attempts: 0 },
      ]);
    });
    return bookId;
  }
}
