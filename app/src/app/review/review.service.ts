import { Injectable, Injector, Signal, computed, inject, runInInjectionContext, signal } from '@angular/core';
import { CLOCK } from '../core/clock';
import { DB } from '../core/db';
import { newId } from '../core/ids';
import type { ID, ReviewItem, ReviewLang } from '../core/models';
import { Repo } from '../core/repo';
import { grade, kindFor, newSrs, normalizeSelection, type Grade } from './review-logic';

export interface NewReviewItem {
  text: string;
  translation: string;
  sourceLang: ReviewLang;
  bookId: ID;
  page: number;
  context: string;
}

const TICK_MS = 60_000;

/** The only writer of the language notebook. All writes go through Repo so they sync; deleting is a soft delete. */
@Injectable({ providedIn: 'root' })
export class ReviewService {
  private readonly repo = inject(Repo);
  private readonly db = inject(DB);
  private readonly clock = inject(CLOCK);
  private readonly injector = inject(Injector);
  private readonly now = signal(this.clock.now());
  private everything?: Signal<ReviewItem[] | undefined>;
  private ticker?: ReturnType<typeof setInterval>;

  /** Live items, not deleted, newest first. Undefined until the first read. */
  items(): Signal<ReviewItem[] | undefined> {
    this.everything ??= runInInjectionContext(this.injector, () =>
      this.repo.live(async () => (await this.db.review.filter((r) => !r.deleted).toArray()).sort((a, b) => b.createdAt - a.createdAt)),
    );
    return this.everything;
  }

  /** How many items are due now. Follows the clock once a minute. */
  dueCount(): Signal<number> {
    const items = this.items();
    this.ticker ??= setInterval(() => this.now.set(this.clock.now()), TICK_MS);
    return computed(() => {
      const now = Math.max(this.now(), this.clock.now());
      return (items() ?? []).filter((r) => r.srs.due <= now).length;
    });
  }

  /**
   * Saves an item. The same text from the same book is kept once: saving it again refreshes the translation
   * and context but keeps the schedule. Returns the stored item and whether it already existed.
   */
  async add(input: NewReviewItem): Promise<{ item: ReviewItem; existed: boolean }> {
    const text = normalizeSelection(input.text);
    const key = text.toLowerCase();
    const same = (await this.db.review.where('bookId').equals(input.bookId).toArray()).find((r) => !r.deleted && r.text.toLowerCase() === key);
    const now = this.clock.now();
    if (same) {
      const item = await this.repo.put<ReviewItem>('review', { ...same, translation: input.translation, context: input.context || same.context, page: input.page });
      return { item, existed: true };
    }
    const item = await this.repo.put<ReviewItem>('review', {
      id: newId(),
      text,
      translation: input.translation,
      kind: kindFor(text),
      sourceLang: input.sourceLang,
      bookId: input.bookId,
      page: input.page,
      context: input.context,
      srs: newSrs(now),
      createdAt: now,
    });
    return { item, existed: false };
  }

  update(id: ID, patch: Partial<Pick<ReviewItem, 'text' | 'translation' | 'note' | 'context'>>): Promise<ReviewItem | undefined> {
    return this.repo.update<ReviewItem>('review', id, () => ({
      ...patch,
      ...(patch.text !== undefined ? { text: normalizeSelection(patch.text), kind: kindFor(patch.text) } : {}),
    }));
  }

  /** Soft-deletes; returns the item as it was so the delete can be undone. */
  async remove(id: ID): Promise<ReviewItem | undefined> {
    const existing = await this.db.review.get(id);
    if (!existing || existing.deleted) return undefined;
    await this.repo.softDelete('review', id);
    return existing;
  }

  async restore(rec: ReviewItem): Promise<void> {
    const { deleted: _deleted, ...live } = rec;
    await this.repo.put<ReviewItem>('review', live);
  }

  /** Records a practice grade and reschedules the item. */
  gradeItem(id: ID, g: Grade): Promise<ReviewItem | undefined> {
    return this.repo.update<ReviewItem>('review', id, (cur) => ({ srs: grade(cur.srs, g, this.clock.now()) }));
  }
}
