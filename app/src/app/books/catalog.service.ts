import { Injectable, Signal, computed, inject } from '@angular/core';
import { DB } from '../core/db';
import { newId } from '../core/ids';
import type { Category, ID, UpNext } from '../core/models';
import { Repo } from '../core/repo';

const UPNEXT_ID = 'up-next';

/** Categories and the Up next list. */
@Injectable({ providedIn: 'root' })
export class CatalogService {
  private readonly db = inject(DB);
  private readonly repo = inject(Repo);

  private readonly categoriesRec = this.repo.live(() =>
    this.db.categories.filter((c) => !c.deleted).sortBy('order'),
  );
  /** Live categories that are not deleted, by order. */
  readonly categories: Signal<Category[]> = computed(() => this.categoriesRec() ?? []);
  /** False until the first categories read has finished. */
  readonly categoriesLoaded: Signal<boolean> = computed(() => this.categoriesRec() !== undefined);

  private readonly upNextRec = this.repo.live(() => this.db.upNext.get(UPNEXT_ID));
  /** The ranked Up next book ids. Empty when there is no record. */
  readonly upNext: Signal<ID[]> = computed(() => this.upNextRec()?.bookIds ?? []);

  /**
   * Adds a category with the trimmed name, or returns the live one whose name
   * matches case-insensitively. A new category goes after the highest order.
   */
  async addCategory(name: string): Promise<Category> {
    return (await this.createCategory(name)).category;
  }

  /**
   * Like `addCategory`, but says whether a category was created (`created`) or the name already existed.
   * The check and the write share one transaction, so a double submit cannot make two categories or two equal orders.
   */
  async createCategory(name: string): Promise<{ category: Category; created: boolean }> {
    const trimmed = name.trim();
    if (trimmed === '') throw new Error('Category name is empty');
    const key = trimmed.toLowerCase();
    const store = this.db.categories;
    return this.db.transaction('rw', store, async () => {
      const all = await store.toArray();
      const existing = all.find((c) => !c.deleted && c.name.toLowerCase() === key);
      if (existing) return { category: existing, created: false };
      const order = all.length === 0 ? 0 : Math.max(...all.map((c) => c.order)) + 1;
      return { category: await this.repo.put<Category>('categories', { id: newId(), name: trimmed, order }), created: true };
    });
  }

  /** Replaces the Up next list. Repeated ids are dropped, keeping the first occurrence. */
  async setUpNext(ids: ID[]): Promise<void> {
    const bookIds = [...new Set(ids)];
    await this.repo.put<UpNext>('upNext', { id: UPNEXT_ID, bookIds });
  }

  /** Adds the book at the end of Up next when on, or removes it when off. A no-op when nothing changes. */
  async toggleUpNext(bookId: ID, on: boolean): Promise<void> {
    const store = this.db.upNext;
    await this.db.transaction('rw', store, async () => {
      const current = (await store.get(UPNEXT_ID))?.bookIds ?? [];
      const present = current.includes(bookId);
      if (on === present) return;
      const bookIds = on ? [...current, bookId] : current.filter((id) => id !== bookId);
      await this.repo.put<UpNext>('upNext', { id: UPNEXT_ID, bookIds });
    });
  }
}
