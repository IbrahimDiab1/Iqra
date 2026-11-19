import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOCK } from '../../core/clock';
import { DB, IqraDb } from '../../core/db';
import { newId } from '../../core/ids';
import type { Book, Category, ID } from '../../core/models';
import { ToastService } from '../../ui/toast.service';
import { CategoryService } from '../category.service';
import { CategoryBarComponent, type CategoryCounts } from './category-bar.component';
import { UNCATEGORIZED } from './library-query';

const cat = (id: string, name: string, order: number): Category => ({ id, name, order, updatedAt: 1, deviceId: 'dev' });

function book(id: string, categoryIds: string[]): Book {
  return {
    id, deviceId: 'dev', updatedAt: 1, title: `Book ${id}`, author: 'A', driveFileId: 'd', fileName: `${id}.pdf`, sizeBytes: 1,
    sha256: id, pageCount: 10, outline: [], language: 'en', direction: 'ltr', addedAt: 1, status: 'reading',
    categoryIds, tags: [], progressMode: 'last-page', pageMode: 'swipe', lastPageReached: 0,
  };
}

function pointer(type: string, init: { pointerType: string; clientX?: number; clientY?: number; button?: number }): Event {
  const e = new MouseEvent(type, { bubbles: true, clientX: init.clientX ?? 0, clientY: init.clientY ?? 0, button: init.button ?? 0 });
  Object.defineProperty(e, 'pointerType', { value: init.pointerType });
  return e;
}

describe('CategoryBarComponent', () => {
  let db: IqraDb;
  let fixture: ComponentFixture<CategoryBarComponent>;
  let el: HTMLElement;
  let toast: ToastService;
  let selection: ID[][];

  const counts: CategoryCounts = { all: 9, uncategorized: 2, byId: new Map([['c1', 4], ['c2', 1], ['c3', 0]]) };

  const chip = (key: string) => el.querySelector<HTMLButtonElement>(`[data-chip="${key}"]`)!;
  const chipKeys = () => Array.from(el.querySelectorAll<HTMLElement>('[data-chip]')).map((c) => c.dataset['chip']);
  const names = () => Array.from(el.querySelectorAll('.nm')).map((n) => n.textContent!.trim());
  const menuItem = (testid: string) => el.querySelector<HTMLButtonElement>(`[data-testid="${testid}"]`)!;

  async function settle(check: () => void | Promise<void>): Promise<void> {
    await vi.waitFor(async () => {
      fixture.detectChanges();
      await check();
    });
  }
  function key(target: HTMLElement, k: string, init: KeyboardEventInit = {}): void {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...init }));
    fixture.detectChanges();
  }
  function type(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }
  function click(target: HTMLElement, init: MouseEventInit = {}): void {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, ...init }));
    fixture.detectChanges();
  }
  function rightClick(target: HTMLElement): void {
    target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
  }
  /** Renders the bar with the live categories from the database and a selection. */
  async function render(selected: ID[] = []): Promise<void> {
    fixture = TestBed.createComponent(CategoryBarComponent);
    el = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('categories', TestBed.inject(CategoryService).list());
    fixture.componentRef.setInput('counts', counts);
    fixture.componentRef.setInput('selected', selected);
    fixture.componentInstance.selectedChange.subscribe((v) => selection.push(v));
    fixture.detectChanges();
    await settle(() => expect(chip('c1')).not.toBeNull());
  }

  beforeEach(async () => {
    localStorage.clear();
    selection = [];
    db = new IqraDb(`iqra-test-${newId()}`);
    TestBed.configureTestingModule({
      providers: [{ provide: DB, useValue: db }, { provide: CLOCK, useValue: { now: () => 5000 } }],
    });
    await db.categories.bulkPut([cat('c1', 'Fiqh', 0), cat('c2', 'History', 1), cat('c3', 'Tafsir', 2)]);
    toast = TestBed.inject(ToastService);
    // The bar takes the categories as an input; wait for the live list a host would pass in.
    const service = TestBed.inject(CategoryService);
    await vi.waitFor(() => expect(service.list().length).toBe(3));
  });

  afterEach(async () => {
    fixture?.destroy();
    TestBed.resetTestingModule();
    await db.delete();
  });

  /** Keeps the input in step with the live categories, like the Library page does. */
  async function sync(): Promise<void> {
    fixture.componentRef.setInput('categories', TestBed.inject(CategoryService).list());
    fixture.detectChanges();
  }

  describe('chips', () => {
    it('lists All, Uncategorized, each category in order and a + chip, with counts', async () => {
      await render();
      expect(chipKeys()).toEqual(['all', 'uncategorized', 'c1', 'c2', 'c3', '+']);
      expect(names()).toEqual(['Fiqh', 'History', 'Tafsir']);
      expect(chip('all').textContent).toContain('9');
      expect(chip('uncategorized').textContent).toContain('2');
      expect(chip('c1').textContent).toContain('4');
      expect(chip('c3').textContent).toContain('0');
      expect(chip('+').getAttribute('aria-label')).toBe('Add category');
    });

    it('shows names with dir="auto"', async () => {
      await render();
      expect(el.querySelector('.nm')!.getAttribute('dir')).toBe('auto');
    });

    it('marks All pressed when nothing is selected, otherwise the selected chips', async () => {
      await render();
      expect(chip('all').getAttribute('aria-pressed')).toBe('true');
      fixture.componentRef.setInput('selected', ['c2', UNCATEGORIZED]);
      fixture.detectChanges();
      expect(chip('all').getAttribute('aria-pressed')).toBe('false');
      expect(chip('c2').getAttribute('aria-pressed')).toBe('true');
      expect(chip('uncategorized').getAttribute('aria-pressed')).toBe('true');
      expect(chip('c1').getAttribute('aria-pressed')).toBe('false');
    });
  });

  describe('selecting', () => {
    it('a plain click selects only that chip', async () => {
      await render(['c1']);
      click(chip('c2'));
      expect(selection).toEqual([['c2']]);
    });

    it('All clears the selection and Uncategorized selects its value', async () => {
      await render(['c1']);
      click(chip('all'));
      click(chip('uncategorized'));
      expect(selection).toEqual([[], [UNCATEGORIZED]]);
    });

    it('Ctrl and Cmd click add to the selection and click again removes', async () => {
      await render(['c1']);
      click(chip('c2'), { ctrlKey: true });
      expect(selection.at(-1)).toEqual(['c1', 'c2']);
      click(chip('c3'), { metaKey: true });
      expect(selection.at(-1)).toEqual(['c1', 'c3']);
      click(chip('c1'), { ctrlKey: true });
      expect(selection.at(-1)).toEqual([]);
    });

    it('a long press toggles the chip and the click that follows is ignored', async () => {
      await render(['c1']);
      chip('c2').dispatchEvent(pointer('pointerdown', { pointerType: 'touch' }));
      await new Promise((r) => setTimeout(r, 600));
      expect(selection).toEqual([['c1', 'c2']]);
      chip('c2').dispatchEvent(pointer('pointerup', { pointerType: 'touch' }));
      click(chip('c2'));
      expect(selection).toEqual([['c1', 'c2']]);
      // The next, ordinary tap works again.
      click(chip('c3'));
      expect(selection.at(-1)).toEqual(['c3']);
    });

    it('a short tap or a drag is not a long press', async () => {
      await render();
      chip('c2').dispatchEvent(pointer('pointerdown', { pointerType: 'touch', clientX: 5, clientY: 5 }));
      chip('c2').dispatchEvent(pointer('pointerup', { pointerType: 'touch' }));
      chip('c3').dispatchEvent(pointer('pointerdown', { pointerType: 'touch', clientX: 5, clientY: 5 }));
      chip('c3').dispatchEvent(pointer('pointermove', { pointerType: 'touch', clientX: 60, clientY: 5 }));
      await new Promise((r) => setTimeout(r, 600));
      expect(selection).toEqual([]);
    });

    it('a mouse hold is not a long press', async () => {
      await render();
      chip('c2').dispatchEvent(pointer('pointerdown', { pointerType: 'mouse' }));
      await new Promise((r) => setTimeout(r, 600));
      expect(selection).toEqual([]);
    });
  });

  describe('keyboard', () => {
    it('is one toolbar with a single tab stop that follows focus', async () => {
      await render();
      const stops = () => Array.from(el.querySelectorAll<HTMLElement>('[data-chip]')).filter((c) => c.tabIndex === 0).map((c) => c.dataset['chip']);
      expect(el.querySelector('[role="toolbar"]')).not.toBeNull();
      expect(stops()).toEqual(['all']);
      chip('all').focus();
      key(chip('all'), 'ArrowRight');
      expect(document.activeElement).toBe(chip('uncategorized'));
      fixture.detectChanges();
      expect(stops()).toEqual(['uncategorized']);
      key(chip('uncategorized'), 'End');
      expect(document.activeElement).toBe(chip('+'));
      key(chip('+'), 'Home');
      expect(document.activeElement).toBe(chip('all'));
      key(chip('all'), 'ArrowLeft');
      expect(document.activeElement).toBe(chip('all'));
    });

    it('arrow keys are mirrored in right-to-left', async () => {
      await render();
      el.setAttribute('dir', 'rtl');
      chip('all').focus();
      key(chip('all'), 'ArrowLeft');
      expect(document.activeElement).toBe(chip('uncategorized'));
      key(chip('uncategorized'), 'ArrowRight');
      expect(document.activeElement).toBe(chip('all'));
    });

    it('a Shift-modified click, as from the keyboard, adds to the selection', async () => {
      await render();
      click(chip('c2'), { shiftKey: true });
      expect(selection).toEqual([['c2']]);
    });

    it('F2 renames the focused category', async () => {
      await render();
      chip('c2').focus();
      key(chip('c2'), 'F2');
      await settle(() => expect(el.querySelector('[data-testid="rename-input"]')).not.toBeNull());
    });

    it('Alt+ArrowRight moves a category later and Alt+ArrowLeft earlier', async () => {
      await render();
      key(chip('c1'), 'ArrowRight', { altKey: true });
      await settle(async () => expect((await db.categories.get('c1'))!.order).toBe(1));
      expect((await db.categories.get('c2'))!.order).toBe(0);
      await sync();
      key(chip('c1'), 'ArrowLeft', { altKey: true });
      await settle(async () => expect((await db.categories.get('c1'))!.order).toBe(0));
    });
  });

  describe('menu', () => {
    it('right-click opens a menu with Rename, Move left, Move right and Delete', async () => {
      await render();
      rightClick(chip('c2'));
      const items = Array.from(el.querySelectorAll('[role="menuitem"]')).map((b) => b.textContent!.trim());
      expect(items).toEqual(['Rename', 'Move left', 'Move right', 'Delete']);
      expect(el.querySelector('[role="menu"]')).not.toBeNull();
    });

    it('the chip menu button opens the same menu and closes it again', async () => {
      await render();
      el.querySelector<HTMLButtonElement>('[data-cat="c1"] [data-testid="more"]')!.click();
      fixture.detectChanges();
      expect(el.querySelector('[role="menu"]')).not.toBeNull();
      el.querySelector<HTMLButtonElement>('[data-cat="c1"] [data-testid="more"]')!.click();
      fixture.detectChanges();
      expect(el.querySelector('[role="menu"]')).toBeNull();
    });

    it('a touch long press does not also open the menu', async () => {
      await render();
      chip('c2').dispatchEvent(pointer('pointerdown', { pointerType: 'touch' }));
      rightClick(chip('c2'));
      expect(el.querySelector('[role="menu"]')).toBeNull();
    });

    it('Escape closes the menu and returns focus to the chip; clicking elsewhere closes it', async () => {
      await render();
      rightClick(chip('c2'));
      key(menuItem('menu-rename'), 'Escape');
      expect(el.querySelector('[role="menu"]')).toBeNull();
      await settle(() => expect(document.activeElement).toBe(chip('c2')));
      rightClick(chip('c2'));
      document.body.dispatchEvent(pointer('pointerdown', { pointerType: 'mouse' }));
      fixture.detectChanges();
      expect(el.querySelector('[role="menu"]')).toBeNull();
    });

    it('arrow keys move through the menu items', async () => {
      await render();
      rightClick(chip('c2'));
      await settle(() => expect(document.activeElement).toBe(menuItem('menu-rename')));
      key(menuItem('menu-rename'), 'ArrowDown');
      expect(document.activeElement).toBe(menuItem('menu-left'));
      key(menuItem('menu-left'), 'ArrowUp');
      key(menuItem('menu-rename'), 'ArrowUp');
      expect(document.activeElement).toBe(menuItem('menu-delete'));
    });

    it('disables Move left on the first category and Move right on the last', async () => {
      await render();
      rightClick(chip('c1'));
      expect(menuItem('menu-left').disabled).toBe(true);
      expect(menuItem('menu-right').disabled).toBe(false);
      key(menuItem('menu-left'), 'Escape');
      rightClick(chip('c3'));
      expect(menuItem('menu-left').disabled).toBe(false);
      expect(menuItem('menu-right').disabled).toBe(true);
    });

    it('Move right persists the new order', async () => {
      await render();
      rightClick(chip('c1'));
      menuItem('menu-right').click();
      await settle(async () => {
        expect((await db.categories.get('c1'))!.order).toBe(1);
        expect((await db.categories.get('c2'))!.order).toBe(0);
        expect((await db.categories.get('c3'))!.order).toBe(2);
      });
    });

    it('Move left and Move right swap in right-to-left', async () => {
      await render();
      el.setAttribute('dir', 'rtl');
      rightClick(chip('c1'));
      // In RTL the first category is at the right edge: it can go left (later) but not right.
      expect(menuItem('menu-right').disabled).toBe(true);
      expect(menuItem('menu-left').disabled).toBe(false);
      menuItem('menu-left').click();
      await settle(async () => expect((await db.categories.get('c1'))!.order).toBe(1));
    });
  });

  describe('rename', () => {
    async function startRename(name: string): Promise<HTMLInputElement> {
      rightClick(chip(name));
      menuItem('menu-rename').click();
      fixture.detectChanges();
      return el.querySelector<HTMLInputElement>('[data-testid="rename-input"]')!;
    }

    it('edits in place and saves with Enter, trimming the name', async () => {
      await render();
      const input = await startRename('c2');
      expect(input.value).toBe('History');
      type(input, '  Islamic   history ');
      key(input, 'Enter');
      await settle(async () => expect((await db.categories.get('c2'))!.name).toBe('Islamic history'));
      await settle(() => expect(el.querySelector('[data-testid="rename-input"]')).toBeNull());
    });

    it('Escape cancels without saving', async () => {
      await render();
      const input = await startRename('c2');
      type(input, 'Other');
      key(input, 'Escape');
      expect(el.querySelector('[data-testid="rename-input"]')).toBeNull();
      expect((await db.categories.get('c2'))!.name).toBe('History');
    });

    it('rejects a duplicate name ignoring case, and an empty name, and stays editing', async () => {
      await render();
      const input = await startRename('c2');
      type(input, 'fIqH');
      key(input, 'Enter');
      await settle(() => expect(el.querySelector('[data-testid="error"]')!.textContent).toContain('already exists'));
      expect(el.querySelector('[data-testid="rename-input"]')).not.toBeNull();
      type(input, '   ');
      key(input, 'Enter');
      await settle(() => expect(el.querySelector('[data-testid="error"]')!.textContent).toContain('Enter a name'));
      expect((await db.categories.get('c2'))!.name).toBe('History');
    });
  });

  describe('keeping the selection in view', () => {
    /** Lays the chips out in a 200 px wide strip, each 110 px wide in 120 px steps: only the first two fit. */
    function layOut(offset: { value: number }): { scrolls: number[] } {
      const scrolls: number[] = [];
      const strip = el.querySelector<HTMLElement>('.strip')!;
      Object.defineProperty(strip, 'scrollLeft', { configurable: true, get: () => offset.value, set: (v: number) => { scrolls.push(v); offset.value = v; } });
      const order = ['all', 'uncategorized', 'c1', 'c2', 'c3', '+'];
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        if (this === strip) return { left: 0, right: 200, top: 0, bottom: 40, width: 200, height: 40, x: 0, y: 0, toJSON: () => ({}) };
        const at = order.indexOf(this.dataset['chip'] ?? '');
        if (at < 0) return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) };
        const left = at * 120 - offset.value;
        return { left, right: left + 110, top: 0, bottom: 40, width: 110, height: 40, x: left, y: 0, toJSON: () => ({}) };
      });
      return { scrolls };
    }

    afterEach(() => vi.restoreAllMocks());

    it('scrolls a selected chip that is outside the bar into view, and does not report it hidden', async () => {
      await render();
      const offset = { value: 0 };
      const { scrolls } = layOut(offset);
      const hidden: boolean[] = [];
      fixture.componentInstance.selectionHidden.subscribe((h) => hidden.push(h));
      fixture.componentRef.setInput('selected', ['c3']);
      await settle(() => expect(scrolls.length).toBeGreaterThan(0));
      // c3 spans 480-590 before scrolling; the strip is 0-200, so it is brought to the right edge.
      expect(offset.value).toBe(390);
      expect(hidden).toEqual([]);
    });

    it('reports a selected chip that cannot be fully shown, and clears the report when it can', async () => {
      await render();
      const offset = { value: 0 };
      layOut(offset);
      const hidden: boolean[] = [];
      fixture.componentInstance.selectionHidden.subscribe((h) => hidden.push(h));
      // Two far-apart chips: the first is revealed, the other stays out.
      fixture.componentRef.setInput('selected', ['c1', 'c3']);
      await settle(() => expect(hidden).toEqual([true]));
      fixture.componentRef.setInput('selected', []);
      await settle(() => expect(hidden).toEqual([true, false]));
    });

    it('works mirrored: a chip off the left edge scrolls back (negative offsets in right-to-left)', async () => {
      await render(['c3']);
      const offset = { value: 0 };
      layOut(offset);
      // Chip sits at -200..-90 relative to the strip.
      offset.value = 700;
      fixture.componentRef.setInput('selected', ['c3', 'c2']);
      await settle(() => expect(offset.value).toBeLessThan(700));
    });
  });

  describe('menu and scrolling', () => {
    it('closes the open menu when the page scrolls or the window is resized', async () => {
      await render();
      rightClick(chip('c1'));
      expect(menuItem('menu-rename')).not.toBeNull();
      window.dispatchEvent(new Event('scroll'));
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="menu"]')).toBeNull();
      rightClick(chip('c1'));
      window.dispatchEvent(new Event('resize'));
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="menu"]')).toBeNull();
    });
  });

  describe('add', () => {
    it('the + chip opens a field; Enter creates the category at the end and closes the field', async () => {
      await render();
      click(chip('+'));
      const input = el.querySelector<HTMLInputElement>('[data-testid="add-input"]')!;
      expect(input).not.toBeNull();
      type(input, '  Seerah ');
      key(input, 'Enter');
      await settle(async () => {
        const added = (await db.categories.toArray()).find((c) => c.name === 'Seerah')!;
        expect(added.order).toBe(3);
      });
      await settle(() => expect(el.querySelector('[data-testid="add-input"]')).toBeNull());
    });

    it('a second Enter while the first is saving does not add the name twice', async () => {
      await render();
      click(chip('+'));
      const input = el.querySelector<HTMLInputElement>('[data-testid="add-input"]')!;
      type(input, 'Seerah');
      key(input, 'Enter');
      key(input, 'Enter');
      await settle(async () => expect((await db.categories.toArray()).filter((c) => c.name === 'Seerah')).toHaveLength(1));
      await new Promise((r) => setTimeout(r, 50));
      expect((await db.categories.toArray()).filter((c) => c.name === 'Seerah')).toHaveLength(1);
      expect(el.querySelector('[data-testid="error"]')).toBeNull();
    });

    it('Escape cancels the field; an empty or duplicate name is refused', async () => {
      await render();
      click(chip('+'));
      let input = el.querySelector<HTMLInputElement>('[data-testid="add-input"]')!;
      key(input, 'Enter');
      await settle(() => expect(el.querySelector('[data-testid="error"]')!.textContent).toContain('Enter a name'));
      type(input, 'tafsir');
      key(input, 'Enter');
      await settle(() => expect(el.querySelector('[data-testid="error"]')!.textContent).toContain('already exists'));
      expect(await db.categories.count()).toBe(3);
      key(input, 'Escape');
      expect(el.querySelector('[data-testid="add-input"]')).toBeNull();
      expect(el.querySelector('[data-testid="error"]')).toBeNull();
      click(chip('+'));
      input = el.querySelector<HTMLInputElement>('[data-testid="add-input"]')!;
      expect(input.value).toBe('');
    });
  });

  describe('delete', () => {
    it('soft-deletes the category and unlinks its books; Undo restores both', async () => {
      await db.books.bulkPut([book('b1', ['c2', 'c1']), book('b2', ['c2']), book('b3', ['c1'])]);
      await render();
      rightClick(chip('c2'));
      menuItem('menu-delete').click();
      await settle(async () => {
        expect((await db.categories.get('c2'))!.deleted).toBe(true);
        expect((await db.books.get('b1'))!.categoryIds).toEqual(['c1']);
        expect((await db.books.get('b2'))!.categoryIds).toEqual([]);
        expect((await db.books.get('b3'))!.categoryIds).toEqual(['c1']);
      });
      expect(toast.current()?.message).toBe('Deleted History');
      toast.undo();
      await settle(async () => {
        expect((await db.categories.get('c2'))!.deleted).toBe(false);
        expect((await db.books.get('b1'))!.categoryIds).toEqual(['c1', 'c2']);
        expect((await db.books.get('b2'))!.categoryIds).toEqual(['c2']);
      });
    });

    it('keeps a tab stop in the toolbar after the focused chip is deleted', async () => {
      await render();
      chip('c3').focus();
      rightClick(chip('c3'));
      menuItem('menu-delete').click();
      await settle(async () => expect((await db.categories.get('c3'))!.deleted).toBe(true));
      await sync();
      expect(Array.from(el.querySelectorAll<HTMLElement>('[data-chip]')).filter((c) => c.tabIndex === 0).length).toBe(1);
    });
  });
});
