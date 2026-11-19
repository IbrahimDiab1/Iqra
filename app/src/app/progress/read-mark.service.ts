import { Injectable, Injector, Signal, inject, runInInjectionContext } from '@angular/core';
import { DB } from '../core/db';
import type { ID, ReadMark } from '../core/models';
import { Repo } from '../core/repo';

/** The only writer of read marks. Marks are never deleted: unmarking writes `read: false`. */
@Injectable({ providedIn: 'root' })
export class ReadMarkService {
  private readonly repo = inject(Repo);
  private readonly db = inject(DB);
  private readonly injector = inject(Injector);
  private readonly byBook = new Map<ID, Signal<ReadonlySet<number> | undefined>>();

  /** Live set of the pages marked read in one book. */
  marked(bookId: ID): Signal<ReadonlySet<number> | undefined> {
    let sig = this.byBook.get(bookId);
    if (!sig) {
      sig = runInInjectionContext(this.injector, () =>
        this.repo.live(async () => {
          const marks = await this.db.readMarks.where('bookId').equals(bookId).toArray();
          return new Set(marks.filter((m) => !m.deleted && m.read).map((m) => m.page)) as ReadonlySet<number>;
        }),
      );
      this.byBook.set(bookId, sig);
    }
    return sig;
  }

  async toggle(bookId: ID, page: number): Promise<void> {
    await this.db.transaction('rw', this.db.readMarks, async () => {
      const existing = await this.db.readMarks.get(`${bookId}:${page}`);
      await this.write(bookId, page, !(existing && !existing.deleted && existing.read));
    });
  }

  /** Marks or clears every page from `fromPage` to `toPage` in one transaction. */
  async setRange(bookId: ID, fromPage: number, toPage: number, read: boolean): Promise<void> {
    const from = Math.max(1, Math.floor(fromPage));
    const to = Math.floor(toPage);
    if (!(to >= from)) return;
    await this.db.transaction('rw', this.db.readMarks, async () => {
      for (let page = from; page <= to; page++) {
        const existing = await this.db.readMarks.get(`${bookId}:${page}`);
        const current = !!existing && !existing.deleted && existing.read;
        // An unchanged page is not rewritten; clearing a page that was never marked creates nothing.
        if (current !== read) await this.write(bookId, page, read);
      }
    });
  }

  private write(bookId: ID, page: number, read: boolean): Promise<ReadMark> {
    return this.repo.put<ReadMark>('readMarks', { id: `${bookId}:${page}`, bookId, page, read });
  }
}
