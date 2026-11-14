import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationStart, Router } from '@angular/router';
import { filter } from 'rxjs';
import { DB } from '../../core/db';
import type { Book, ID } from '../../core/models';
import { Repo } from '../../core/repo';

/** Opens and closes the book details sheet. The sheet is mounted once in AppComponent. */
@Injectable({ providedIn: 'root' })
export class BookDetailsService {
  private readonly db = inject(DB);
  private readonly repo = inject(Repo);
  private readonly router = inject(Router);

  private readonly booksRec = this.repo.live(() => this.db.books.filter((b) => !b.deleted).toArray());
  private readonly openId = signal<ID | null>(null);

  /** The book the details sheet shows, or null when it is closed. */
  readonly openBook: Signal<Book | null> = computed(() => {
    const id = this.openId();
    if (id === null) return null;
    return this.booksRec()?.find((b) => b.id === id) ?? null;
  });

  constructor() {
    // Any navigation (for example, a download that opens the reader) dismisses the sheet.
    this.router.events
      .pipe(
        filter((e) => e instanceof NavigationStart),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.close());
  }

  open(bookId: ID): void {
    this.openId.set(bookId);
  }

  /** Closes the sheet and discards any unsaved edits. */
  close(): void {
    this.openId.set(null);
  }
}
