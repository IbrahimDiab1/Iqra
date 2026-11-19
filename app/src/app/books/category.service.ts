import { Injectable, Signal, computed, inject } from '@angular/core';
import { DB } from '../core/db';
import type { Book, Category, ID } from '../core/models';
import { Repo } from '../core/repo';
import { moveCategory, normalizeName } from '../settings/category-order';
import { COPY } from '../ui/copy';
import { ToastService } from '../ui/toast.service';
import { CatalogService } from './catalog.service';

/** Why a name was refused. The UI turns it into its own message. */
export type CategoryNameError = 'empty' | 'duplicate';

const UNDO_MS = 6000;

/**
 * Add, rename, reorder and delete categories. Shared by the Library category bar and the Settings
 * section so both behave identically: names are normalised and unique ignoring case, deleting
 * removes the category from every book and can be undone.
 */
@Injectable({ providedIn: 'root' })
export class CategoryService {
  private readonly db = inject(DB);
  private readonly repo = inject(Repo);
  private readonly toast = inject(ToastService);
  private readonly catalog = inject(CatalogService);

  /** Live categories by order. */
  readonly list: Signal<Category[]> = this.catalog.categories;
  /** False until the first read has finished, so "none yet" is not shown while loading. */
  readonly ready: Signal<boolean> = computed(() => this.catalog.categoriesLoaded());

  private taken(name: string, exceptId?: ID): boolean {
    const lower = name.toLowerCase();
    return this.list().some((c) => c.id !== exceptId && c.name.toLowerCase() === lower);
  }

  /** Adds a category at the end. Returns why it was refused, or null when it was added. */
  async add(raw: string): Promise<CategoryNameError | null> {
    const name = normalizeName(raw);
    if (name === '') return 'empty';
    return (await this.catalog.createCategory(name)).created ? null : 'duplicate';
  }

  /** Renames a category. Returns why it was refused, or null (also when the name is unchanged). */
  async rename(cat: Category, raw: string): Promise<CategoryNameError | null> {
    const name = normalizeName(raw);
    if (name === '') return 'empty';
    if (this.taken(name, cat.id)) return 'duplicate';
    if (name !== cat.name) await this.repo.update<Category>('categories', cat.id, () => ({ name }));
    return null;
  }

  /** Moves the category at index `from` to index `to` in the current order. */
  async move(from: number, to: number): Promise<void> {
    for (const cat of moveCategory(this.list(), from, to)) await this.repo.update<Category>('categories', cat.id, () => ({ order: cat.order }));
  }

  /**
   * Soft-deletes the category and takes it off every book. Goals that point at it are left alone
   * (Stats labels them "category removed"). Undo brings back the category and those book links.
   */
  async remove(cat: Category): Promise<void> {
    const books = await this.db.books.filter((b) => !b.deleted && b.categoryIds.includes(cat.id)).toArray();
    const bookIds = books.map((b) => b.id);
    await this.repo.softDelete('categories', cat.id);
    for (const id of bookIds) {
      await this.repo.update<Book>('books', id, (b) => ({ categoryIds: b.categoryIds.filter((x) => x !== cat.id) }));
    }
    this.toast.show(COPY.categoryBar.deleted(cat.name), { durationMs: UNDO_MS, undo: () => void this.restore(cat, bookIds) });
  }

  private async restore(cat: Category, bookIds: ID[]): Promise<void> {
    await this.repo.put<Category>('categories', { ...cat, deleted: false });
    for (const id of bookIds) {
      await this.repo.update<Book>('books', id, (b) => (b.categoryIds.includes(cat.id) ? null : { categoryIds: [...b.categoryIds, cat.id] }));
    }
  }
}
