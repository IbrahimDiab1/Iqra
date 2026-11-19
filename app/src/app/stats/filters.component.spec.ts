import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { UNCATEGORIZED } from '../books/library/library-query';
import type { Book, Category } from '../core/models';
import { StatsFiltersComponent } from './filters.component';

const cat = (id: string, name: string, order: number): Category => ({ id, name, order, updatedAt: 0, deviceId: 'd' });
const book = (id: string, title: string): Book => ({
  id, deviceId: 'd', updatedAt: 0, title, author: '', driveFileId: '', fileName: '', sizeBytes: 0, sha256: id, pageCount: 1, outline: [],
  language: 'en', direction: 'ltr', addedAt: 0, status: 'reading', categoryIds: [], tags: [], progressMode: 'last-page', pageMode: 'swipe', lastPageReached: 0,
});

describe('StatsFiltersComponent', () => {
  let fixture: ComponentFixture<StatsFiltersComponent>;
  let el: HTMLElement;
  let categoryEvents: (string | null)[];
  let bookEvents: (string | null)[];

  function render(over: { categories?: Category[]; books?: Book[]; categoryId?: string | null; bookId?: string | null } = {}): void {
    fixture = TestBed.createComponent(StatsFiltersComponent);
    el = fixture.nativeElement as HTMLElement;
    const ref = fixture.componentRef;
    ref.setInput('categories', over.categories ?? [cat('a', 'Fiqh', 0), cat('b', 'History', 9)]);
    ref.setInput('books', over.books ?? [book('b1', 'Usul al-Fiqh'), book('b2', 'كتاب الصلاة'), book('b3', 'Zad al-Maad')]);
    ref.setInput('categoryId', over.categoryId ?? null);
    ref.setInput('bookId', over.bookId ?? null);
    categoryEvents = [];
    bookEvents = [];
    fixture.componentInstance.categoryChange.subscribe((v) => categoryEvents.push(v));
    fixture.componentInstance.bookChange.subscribe((v) => bookEvents.push(v));
    fixture.detectChanges();
  }
  const chip = (text: string) => Array.from(el.querySelectorAll<HTMLButtonElement>('.legend button')).find((b) => b.textContent!.trim() === text)!;
  const bookButton = () => el.querySelector<HTMLButtonElement>('[data-testid="book-picker"]')!;
  const rows = () => Array.from(el.querySelectorAll<HTMLButtonElement>('[data-testid="book-option"]'));
  function search(text: string): void {
    const input = el.querySelector<HTMLInputElement>('[data-testid="book-search"]')!;
    input.value = text;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  beforeEach(() => TestBed.configureTestingModule({}));

  describe('category legend', () => {
    it('lists All, each category with its hue and Uncategorized', () => {
      render();
      expect(Array.from(el.querySelectorAll('.legend button')).map((b) => b.textContent!.trim())).toEqual(['All', 'Fiqh', 'History', 'Uncategorized']);
      expect(chip('Fiqh').querySelector<HTMLElement>('.dot')!.style.getPropertyValue('--dot')).toBe('var(--cat-1)');
      expect(chip('History').querySelector<HTMLElement>('.dot')!.style.getPropertyValue('--dot')).toBe('var(--cat-2)');
      expect(chip('Uncategorized').querySelector<HTMLElement>('.dot')!.style.getPropertyValue('--dot')).toBe('var(--accent)');
    });

    it('is hidden when there are no categories', () => {
      render({ categories: [] });
      expect(el.querySelector('.legend')).toBeNull();
    });

    it('a click filters by that category, and a second click on it clears the filter', () => {
      render();
      chip('Fiqh').click();
      expect(categoryEvents).toEqual(['a']);
      fixture.componentRef.setInput('categoryId', 'a');
      fixture.detectChanges();
      expect(chip('Fiqh').getAttribute('aria-pressed')).toBe('true');
      expect(chip('All').getAttribute('aria-pressed')).toBe('false');
      chip('Fiqh').click();
      expect(categoryEvents).toEqual(['a', null]);
    });

    it('All clears the filter and Uncategorized selects its value', () => {
      render({ categoryId: 'a' });
      chip('All').click();
      chip('Uncategorized').click();
      expect(categoryEvents).toEqual([null, UNCATEGORIZED]);
    });

    it('marks All pressed when nothing is selected', () => {
      render();
      expect(chip('All').getAttribute('aria-pressed')).toBe('true');
    });

    it('shows category names with dir="auto"', () => {
      render();
      expect(chip('Fiqh').querySelector('[dir="auto"]')).not.toBeNull();
    });
  });

  describe('book picker', () => {
    it('shows All books, or the chosen title with dir="auto" and a way to clear it', () => {
      render();
      expect(bookButton().textContent).toContain('All books');
      fixture.componentRef.setInput('bookId', 'b2');
      fixture.detectChanges();
      expect(bookButton().textContent).toContain('كتاب الصلاة');
      expect(bookButton().querySelector('[dir="auto"]')).not.toBeNull();
      el.querySelector<HTMLButtonElement>('[data-testid="book-clear"]')!.click();
      expect(bookEvents).toEqual([null]);
    });

    it('opens a searchable list of books, All books first', () => {
      render();
      bookButton().click();
      fixture.detectChanges();
      expect(rows().map((r) => r.textContent!.trim())).toEqual(['All books', 'Usul al-Fiqh', 'Zad al-Maad', 'كتاب الصلاة']);
      expect(rows()[3].querySelector('[dir="auto"]')).not.toBeNull();
    });

    it('filters the list as you type, ignoring case and Arabic diacritics', () => {
      render({ books: [book('b1', 'Usul al-Fiqh'), book('b2', 'كِتَابُ الصَّلَاةِ')] });
      bookButton().click();
      fixture.detectChanges();
      search('USUL');
      expect(rows().map((r) => r.textContent!.trim())).toEqual(['All books', 'Usul al-Fiqh']);
      search('كتاب الصلاة');
      expect(rows().map((r) => r.textContent!.trim())).toEqual(['All books', 'كِتَابُ الصَّلَاةِ']);
      search('nothing like this');
      expect(el.textContent).toContain('No books match.');
    });

    it('choosing a book emits it and closes the list; All books emits null', () => {
      render();
      bookButton().click();
      fixture.detectChanges();
      rows().find((r) => r.textContent!.includes('Zad'))!.click();
      expect(bookEvents).toEqual(['b3']);
      bookButton().click();
      fixture.detectChanges();
      rows()[0].click();
      expect(bookEvents).toEqual(['b3', null]);
    });
  });
});
