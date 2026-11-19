import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { DB } from '../../core/db';
import type { Book, ID } from '../../core/models';
import { Repo } from '../../core/repo';

/** Opens and closes the book details sheet. The sheet is mounted once in AppComponent. */
@Injectable({ providedIn: 'root' })
export class BookDetailsService {
  private readonly db = inject(DB);
  private readonly repo = inject(Repo);

  private readonly booksRec = this.repo.live(() => this.db.books.filter((b) => !b.deleted).toArray());
  private readonly openId = signal<ID | null>(null);
  private readonly tab = signal<'details' | 'stats'>('details');

  /** The book the details sheet shows, or null when it is closed. */
  readonly openBook: Signal<Book | null> = computed(() => {
    const id = this.openId();
    if (id === null) return null;
    return this.booksRec()?.find((b) => b.id === id) ?? null;
  });

  /** Which tab the sheet shows when it opens. */
  readonly openTab: Signal<'details' | 'stats'> = this.tab.asReadonly();

  open(bookId: ID, tab: 'details' | 'stats' = 'details'): void {
    this.tab.set(tab);
    this.openId.set(bookId);
  }

  /** Closes the sheet and discards any unsaved edits. */
  close(): void {
    this.openId.set(null);
  }
}
