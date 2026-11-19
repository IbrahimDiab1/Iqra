import { Injectable, Signal, WritableSignal, inject, signal, untracked } from '@angular/core';
import { AuthApi } from '../auth/auth.service';
import { DB } from '../core/db';
import type { Book, ID } from '../core/models';
import { DRIVE_ADAPTER, DriveAuthError } from '../sync/drive-adapter';

/**
 * Object URLs for book covers. A cover is taken from db.covers when this device has it. Otherwise
 * it is downloaded from Drive once (when online and signed in) and kept in db.covers.
 */
@Injectable({ providedIn: 'root' })
export class CoverCache {
  private readonly db = inject(DB);
  private readonly drive = inject(DRIVE_ADAPTER);
  private readonly auth = inject(AuthApi);

  private readonly urls = new Map<ID, WritableSignal<string | null>>();
  private readonly loading = new Set<ID>();
  /** Books whose download failed for a reason other than sign-in. Not retried this session. */
  private readonly failed = new Set<ID>();

  /**
   * The cover's object URL, or null until it is available. Calls for the same book share one
   * signal. Each call while the cover is still missing starts a load, unless one is running.
   */
  get(book: Book): Signal<string | null> {
    let url = this.urls.get(book.id);
    if (!url) {
      url = signal<string | null>(null);
      this.urls.set(book.id, url);
    }
    const target = url;
    if (untracked(target) === null && !this.loading.has(book.id) && !this.failed.has(book.id)) {
      void this.load(book.id, book.coverFileId, target);
    }
    return target.asReadonly();
  }

  private async load(bookId: ID, coverFileId: string | undefined, url: WritableSignal<string | null>): Promise<void> {
    this.loading.add(bookId);
    try {
      const local = await this.db.covers.get(bookId);
      if (local) {
        url.set(URL.createObjectURL(local.blob));
        return;
      }
      if (!coverFileId || !navigator.onLine || this.auth.token() === null) return;
      const blob = await this.drive.downloadBlob(coverFileId);
      await this.db.covers.put({ bookId, blob });
      url.set(URL.createObjectURL(blob));
    } catch (error) {
      if (error instanceof DriveAuthError) this.auth.markExpired(error.token);
      else {
        this.failed.add(bookId);
        console.error('Cover download failed', error);
      }
    } finally {
      this.loading.delete(bookId);
    }
  }
}
