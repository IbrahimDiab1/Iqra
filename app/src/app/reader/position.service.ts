import { Injectable, inject } from '@angular/core';
import { CLOCK } from '../core/clock';
import { DB } from '../core/db';
import { DEVICE_ID } from '../core/ids';
import type { Book, ID, Position } from '../core/models';
import { Repo } from '../core/repo';
import { SettingsService } from '../core/settings.service';
import type { Place } from './jump-history';
import { clampZoom } from './zoom';

const SAVE_DELAY_MS = 800;

export interface RestoredPosition {
  place: Place;
  zoom: number;
  view: 'page' | 'reflow';
  fromOtherDevice: boolean;
  previousLocal?: Place;
}

export interface PositionUpdate {
  page: number;
  offset: number;
  zoom: number;
  view: 'page' | 'reflow';
}

interface PendingWrite extends PositionUpdate {
  bookId: ID;
}

function clampPage(page: number, book: Book): number {
  const floor = Math.max(1, Math.floor(page) || 1);
  return book.pageCount > 0 ? Math.min(floor, book.pageCount) : floor;
}

function clampOffset(offset: number): number {
  return Number.isFinite(offset) ? Math.min(1, Math.max(0, offset)) : 0;
}

/** Saves and restores where the reader is in each book, one position record per device. */
@Injectable({ providedIn: 'root' })
export class PositionService {
  private readonly db = inject(DB);
  private readonly repo = inject(Repo);
  private readonly clock = inject(CLOCK);
  private readonly deviceId = inject(DEVICE_ID);
  private readonly settings = inject(SettingsService);

  private pending: PendingWrite | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private writes: Promise<void> = Promise.resolve();

  /** Where to open a book: the newest position of any device, or the last page reached. */
  async restore(book: Book): Promise<RestoredPosition> {
    const positions = await this.db.positions.where('bookId').equals(book.id).toArray();
    const live = positions.filter((p) => !p.deleted).sort((a, b) => b.updatedAt - a.updatedAt);
    const newest = live[0];

    if (!newest) {
      return {
        place: { page: clampPage(Math.max(1, book.lastPageReached), book), offset: 0 },
        zoom: 1,
        view: this.settings.settings().defaultView,
        fromOtherDevice: false,
      };
    }

    const result: RestoredPosition = {
      place: { page: clampPage(newest.page, book), offset: clampOffset(newest.offset) },
      zoom: clampZoom(newest.zoom, newest.view),
      view: newest.view,
      fromOtherDevice: false,
    };

    const own = live.find((p) => p.deviceId === this.deviceId);
    if (newest.deviceId !== this.deviceId && own && own.page !== newest.page) {
      result.fromOtherDevice = true;
      result.previousLocal = { page: clampPage(own.page, book), offset: clampOffset(own.offset) };
    }
    return result;
  }

  /** Records the current place. Writes after 800 ms without a new change. */
  schedule(book: Book, p: PositionUpdate): void {
    if (this.pending && this.pending.bookId !== book.id) this.flushQuietly();

    this.pending = { bookId: book.id, ...p };

    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flushQuietly(), SAVE_DELAY_MS);
  }

  /** Writes the pending place now. Resolves when every write so far has finished. */
  flush(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    const snapshot = this.pending;
    this.pending = null;
    const run = this.writes.then(() => (snapshot ? this.write(snapshot) : undefined));
    this.writes = run.catch(() => undefined);
    return run;
  }

  /**
   * Records that a book was opened: lastOpenedAt, and to-read becomes reading. Writes the Book only,
   * never a Position, so merely opening a book cannot outrank real reading on another device.
   */
  markOpened(book: Book): Promise<void> {
    const run = this.writes.then(async () => {
      await this.repo.update<Book>('books', book.id, (current) => ({
        lastOpenedAt: this.clock.now(),
        ...(current.status === 'to-read' ? { status: 'reading' as const } : {}),
      }));
    });
    this.writes = run.catch(() => undefined);
    return run;
  }

  /** A flush nobody awaits: a failed write is logged, never an unhandled rejection. */
  private flushQuietly(): void {
    this.flush().catch((err) => console.warn('Saving the reading position failed', err));
  }

  private async write(w: PendingWrite): Promise<void> {
    await this.repo.put<Position>('positions', {
      id: `${w.bookId}:${this.deviceId}`,
      bookId: w.bookId,
      page: w.page,
      offset: w.offset,
      zoom: w.zoom,
      view: w.view,
    });

    await this.repo.update<Book>('books', w.bookId, (book) => (w.page > book.lastPageReached ? { lastPageReached: w.page } : null));
  }
}
