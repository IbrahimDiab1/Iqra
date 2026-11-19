import { EnvironmentInjector, Injectable, Signal, createEnvironmentInjector, inject, runInInjectionContext } from '@angular/core';
import { DB } from '../core/db';
import type { ID, ReadMark } from '../core/models';
import { Repo } from '../core/repo';

/** The only writer of read marks. Marks are never deleted: unmarking writes `read: false`. */
@Injectable({ providedIn: 'root' })
export class ReadMarkService {
  private readonly repo = inject(Repo);
  private readonly db = inject(DB);
  private readonly injector = inject(EnvironmentInjector);
  /** One live query per open book; each lives in its own injector so `release` can stop it. */
  private readonly byBook = new Map<ID, { sig: Signal<ReadonlySet<number> | undefined>; scope: EnvironmentInjector }>();

  /** Live set of the pages marked read in one book. */
  marked(bookId: ID): Signal<ReadonlySet<number> | undefined> {
    let entry = this.byBook.get(bookId);
    if (!entry) {
      const scope = createEnvironmentInjector([], this.injector);
      const sig = runInInjectionContext(scope, () =>
        this.repo.live(async () => {
          const marks = await this.db.readMarks.where('bookId').equals(bookId).toArray();
          return new Set(marks.filter((m) => !m.deleted && m.read).map((m) => m.page)) as ReadonlySet<number>;
        }),
      );
      entry = { sig, scope };
      this.byBook.set(bookId, entry);
    }
    return entry.sig;
  }

  /** Stops the live query for a book (called when its reader closes). */
  release(bookId: ID): void {
    const entry = this.byBook.get(bookId);
    if (!entry) return;
    this.byBook.delete(bookId);
    entry.scope.destroy();
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
