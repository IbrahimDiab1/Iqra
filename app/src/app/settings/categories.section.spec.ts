import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOCK } from '../core/clock';
import { DB, IqraDb } from '../core/db';
import { newId } from '../core/ids';
import type { Book, Category } from '../core/models';
import { ToastService } from '../ui/toast.service';
import { CategoriesSection } from './categories.section';

const cat = (id: string, name: string, order: number): Category => ({ id, name, order, updatedAt: 1, deviceId: 'dev' });

function book(id: string, categoryIds: string[]): Book {
  return {
    id, deviceId: 'dev', updatedAt: 1, title: `Book ${id}`, author: 'A', driveFileId: 'd', fileName: `${id}.pdf`, sizeBytes: 1,
    sha256: id, pageCount: 10, outline: [], language: 'en', direction: 'ltr', addedAt: 1, status: 'reading',
    categoryIds, tags: [], progressMode: 'last-page', pageMode: 'swipe', lastPageReached: 0,
  };
}

describe('CategoriesSection', () => {
  let db: IqraDb;
  let fixture: ComponentFixture<CategoriesSection>;
  let el: HTMLElement;
  let toast: ToastService;

  const q = <T extends HTMLElement>(sel: string) => el.querySelector<T>(sel)!;
  const names = () => Array.from(el.querySelectorAll('[data-testid="cat-name"]')).map((n) => n.textContent!.trim());
  const row = (name: string) => Array.from(el.querySelectorAll<HTMLElement>('[data-cat]')).find((r) => r.querySelector('[data-testid="cat-name"]')!.textContent!.trim() === name)!;
  async function ready(): Promise<void> {
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(el.querySelector('[data-ready]')).not.toBeNull();
    });
  }
  async function settle(check: () => void | Promise<void>): Promise<void> {
    await vi.waitFor(async () => {
      fixture.detectChanges();
      await check();
    });
  }
  function type(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }
  function key(target: HTMLElement, k: string): void {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  }

  beforeEach(async () => {
    localStorage.clear();
    db = new IqraDb(`iqra-test-${newId()}`);
    TestBed.configureTestingModule({
      providers: [{ provide: DB, useValue: db }, { provide: CLOCK, useValue: { now: () => 5000 } }],
    });
    await db.categories.bulkPut([cat('c1', 'Fiqh', 0), cat('c2', 'History', 1), cat('c3', 'Tafsir', 2)]);
    toast = TestBed.inject(ToastService);
    fixture = TestBed.createComponent(CategoriesSection);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await ready();
  });

  afterEach(async () => {
    fixture.destroy();
    TestBed.resetTestingModule();
    await db.delete();
  });

  it('lists categories sorted by order', async () => {
    await db.categories.put(cat('c0', 'Zeta first', -1));
    await settle(() => expect(names()).toEqual(['Zeta first', 'Fiqh', 'History', 'Tafsir']));
  });

  it('hides soft-deleted categories', async () => {
    await db.categories.put({ ...cat('c2', 'History', 1), deleted: true });
    await settle(() => expect(names()).toEqual(['Fiqh', 'Tafsir']));
  });

  it('moves a category down with its button and persists the new order', async () => {
    q<HTMLButtonElement>('[data-cat="c1"] [data-testid="down"]').click();
    await settle(() => expect(names()).toEqual(['History', 'Fiqh', 'Tafsir']));
    expect((await db.categories.get('c1'))!.order).toBe(1);
    expect((await db.categories.get('c2'))!.order).toBe(0);
    expect((await db.categories.get('c3'))!.order).toBe(2);
  });

  it('disables up on the first row and down on the last', () => {
    expect(q<HTMLButtonElement>('[data-cat="c1"] [data-testid="up"]').disabled).toBe(true);
    expect(q<HTMLButtonElement>('[data-cat="c3"] [data-testid="down"]').disabled).toBe(true);
  });

  it('renames inline with Enter and trims the name', async () => {
    row('History').querySelector<HTMLButtonElement>('[data-testid="rename"]')!.click();
    fixture.detectChanges();
    const input = q<HTMLInputElement>('[data-testid="rename-input"]');
    type(input, '  Islamic   history ');
    key(input, 'Enter');
    await settle(async () => expect((await db.categories.get('c2'))!.name).toBe('Islamic history'));
    await settle(() => expect(el.querySelector('[data-testid="rename-input"]')).toBeNull());
  });

  it('Escape cancels a rename', async () => {
    row('History').querySelector<HTMLButtonElement>('[data-testid="rename"]')!.click();
    fixture.detectChanges();
    const input = q<HTMLInputElement>('[data-testid="rename-input"]');
    type(input, 'Other');
    key(input, 'Escape');
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="rename-input"]')).toBeNull();
    expect((await db.categories.get('c2'))!.name).toBe('History');
  });

  it('rejects a case-insensitive duplicate name with an inline message', async () => {
    row('History').querySelector<HTMLButtonElement>('[data-testid="rename"]')!.click();
    fixture.detectChanges();
    const input = q<HTMLInputElement>('[data-testid="rename-input"]');
    type(input, 'fIqH');
    key(input, 'Enter');
    fixture.detectChanges();
    expect(q('[data-testid="error"]').textContent).toContain('already exists');
    expect((await db.categories.get('c2'))!.name).toBe('History');
  });

  it('allows renaming to the same name with different case only on the same category', async () => {
    row('History').querySelector<HTMLButtonElement>('[data-testid="rename"]')!.click();
    fixture.detectChanges();
    type(q<HTMLInputElement>('[data-testid="rename-input"]'), 'HISTORY');
    key(q('[data-testid="rename-input"]'), 'Enter');
    await settle(async () => expect((await db.categories.get('c2'))!.name).toBe('HISTORY'));
  });

  it('adds a category at the end, ignoring an empty name', async () => {
    const input = q<HTMLInputElement>('[data-testid="add-input"]');
    type(input, '   ');
    q<HTMLButtonElement>('[data-testid="add"]').click();
    fixture.detectChanges();
    expect(await db.categories.count()).toBe(3);

    type(input, 'Seerah');
    q<HTMLButtonElement>('[data-testid="add"]').click();
    await settle(() => expect(names()).toEqual(['Fiqh', 'History', 'Tafsir', 'Seerah']));
    const added = (await db.categories.toArray()).find((c) => c.name === 'Seerah')!;
    expect(added.order).toBe(3);
  });

  it('rejects adding a duplicate name', async () => {
    type(q<HTMLInputElement>('[data-testid="add-input"]'), 'tafsir');
    q<HTMLButtonElement>('[data-testid="add"]').click();
    fixture.detectChanges();
    expect(q('[data-testid="error"]').textContent).toContain('already exists');
    expect(await db.categories.count()).toBe(3);
  });

  it('delete soft-deletes the category and removes it from its books; Undo restores both', async () => {
    await db.books.bulkPut([book('b1', ['c2', 'c1']), book('b2', ['c2']), book('b3', ['c1']), { ...book('b4', ['c2']), deleted: true }]);
    row('History').querySelector<HTMLButtonElement>('[data-testid="delete"]')!.click();
    await settle(async () => expect((await db.categories.get('c2'))!.deleted).toBe(true));
    await settle(async () => {
      expect((await db.books.get('b1'))!.categoryIds).toEqual(['c1']);
      expect((await db.books.get('b2'))!.categoryIds).toEqual([]);
      expect((await db.books.get('b3'))!.categoryIds).toEqual(['c1']);
    });
    await settle(() => expect(names()).toEqual(['Fiqh', 'Tafsir']));
    expect(toast.current()?.undo).toBeTypeOf('function');

    toast.undo();
    await settle(async () => {
      expect((await db.categories.get('c2'))!.deleted).toBe(false);
      expect((await db.books.get('b1'))!.categoryIds).toEqual(['c1', 'c2']);
      expect((await db.books.get('b2'))!.categoryIds).toEqual(['c2']);
    });
    await settle(() => expect(names()).toEqual(['Fiqh', 'History', 'Tafsir']));
  });

  it('delete leaves goals that point at the category untouched', async () => {
    await db.goals.put({ id: 'g1', deviceId: 'd', updatedAt: 1, categoryId: 'c2', measure: 'pages', target: 5 });
    row('History').querySelector<HTMLButtonElement>('[data-testid="delete"]')!.click();
    await settle(async () => expect((await db.categories.get('c2'))!.deleted).toBe(true));
    expect((await db.goals.get('g1'))!.categoryId).toBe('c2');
    expect(await db.goals.get('g1').then((g) => g!.updatedAt)).toBe(1);
  });

  it('shows names with dir="auto"', () => {
    expect(q('[data-testid="cat-name"]').getAttribute('dir')).toBe('auto');
  });
});
