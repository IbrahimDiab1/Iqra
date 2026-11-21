import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FilesService } from '../books/files.service';
import { CLOCK } from '../core/clock';
import { DB, IqraDb } from '../core/db';
import { newId } from '../core/ids';
import type { Book } from '../core/models';
import { ToastService } from '../ui/toast.service';
import { ReviewPage } from './review.page';
import { ReviewService } from './review.service';

const NOW = 10 * 86_400_000;

function book(id: string, title: string): Book {
  return { id, title, author: '', updatedAt: 1, deviceId: 'd', pageCount: 9, outline: [], categoryIds: [], tags: [] } as unknown as Book;
}

describe('ReviewPage', () => {
  let db: IqraDb;
  let fixture: ComponentFixture<ReviewPage>;
  let reviews: ReviewService;
  const open = vi.fn();
  const el = () => fixture.nativeElement as HTMLElement;
  const rows = () => Array.from(el().querySelectorAll('[data-testid="review-item"]'));
  const settle = async () => {
    await fixture.whenStable();
    fixture.detectChanges();
  };

  async function seed() {
    await db.books.bulkPut([book('b1', 'Dune'), book('b2', 'Kalila')]);
    await reviews.add({ text: 'serendipity', translation: 'صدفة', sourceLang: 'en', bookId: 'b1', page: 3, context: 'A happy serendipity.' });
    await reviews.add({ text: 'break the ice', translation: 'كسر الجليد', sourceLang: 'en', bookId: 'b2', page: 5, context: '' });
    await reviews.add({ text: 'كتاب', translation: 'book', sourceLang: 'ar', bookId: 'b2', page: 6, context: '' });
  }

  beforeEach(() => {
    open.mockClear();
    db = new IqraDb(`iqra-test-${newId()}`);
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: DB, useValue: db }, { provide: FilesService, useValue: { openBook: open } }, { provide: CLOCK, useValue: { now: () => NOW } }],
    });
    reviews = TestBed.inject(ReviewService);
  });
  afterEach(async () => {
    TestBed.resetTestingModule();
    await db.delete();
  });

  async function create() {
    fixture = TestBed.createComponent(ReviewPage);
    fixture.detectChanges();
    await settle();
  }

  it('shows helpful copy when nothing is saved', async () => {
    await create();
    await vi.waitFor(async () => {
      await settle();
      expect(el().querySelector('[data-testid="review-empty"]')?.textContent).toContain('Translate');
    });
    expect(el().querySelector('[data-testid="start-practice"]')).toBeNull();
  });

  it('lists saved items and filters with multi-select chips and by book; there is no search box', async () => {
    await seed();
    await create();
    await vi.waitFor(async () => {
      await settle();
      expect(rows()).toHaveLength(3);
    });
    expect(el().querySelector('input[type="search"]')).toBeNull();
    const chip = (name: string) => Array.from(el().querySelectorAll<HTMLButtonElement>('.chips .chip')).find((b) => b.textContent?.trim() === name)!;
    expect(Array.from(el().querySelectorAll('.chips .chip')).map((b) => b.textContent?.trim())).toEqual(['All', 'Words', 'Sentences', 'Notes', 'Highlights']);
    chip('Sentences').click();
    await settle();
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toContain('break the ice');
    chip('Words').click();
    await settle();
    expect(rows()).toHaveLength(3);
    expect(chip('All').getAttribute('aria-pressed')).toBe('false');
    chip('All').click();
    await settle();
    expect(chip('Words').getAttribute('aria-pressed')).toBe('false');
    const select = el().querySelector<HTMLSelectElement>('select')!;
    select.value = 'b2';
    select.dispatchEvent(new Event('change'));
    await settle();
    expect(rows()).toHaveLength(2);
  });

  it('lists highlights and notes under their chips, without a translation line', async () => {
    await seed();
    const anchor = { page: 2, start: { item: 0, offset: 0 }, end: { item: 0, offset: 5 }, rects: [], quote: 'A quoted line' };
    const base = { bookId: 'b1', page: 2, tags: [], createdAt: 1, updatedAt: 1, deviceId: 'd', text: anchor };
    await reviews.addAnnotation({ ...base, id: 'h1', type: 'highlight', color: 'yellow' });
    await reviews.addAnnotation({ ...base, id: 'n1', type: 'note', body: 'Why?' });
    await create();
    await vi.waitFor(async () => {
      await settle();
      expect(rows()).toHaveLength(5);
    });
    const chip = (name: string) => Array.from(el().querySelectorAll<HTMLButtonElement>('.chips .chip')).find((b) => b.textContent?.trim() === name)!;
    chip('Notes').click();
    await settle();
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toContain('Why?');
    expect(rows()[0].querySelector('.tr')).toBeNull();
    chip('Highlights').click();
    await settle();
    expect(rows()).toHaveLength(2);
  });

  it('deleting shows Undo, and Undo brings the item back', async () => {
    await seed();
    await create();
    await vi.waitFor(async () => {
      await settle();
      expect(rows()).toHaveLength(3);
    });
    el().querySelector<HTMLButtonElement>('.act.del')!.click();
    await vi.waitFor(async () => {
      await settle();
      expect(rows()).toHaveLength(2);
    });
    const toast = TestBed.inject(ToastService);
    expect(toast.current()?.message).toBe('Deleted');
    toast.undo();
    await vi.waitFor(async () => {
      await settle();
      expect(rows()).toHaveLength(3);
    });
  });

  it('edits an item through the sheet', async () => {
    await seed();
    await create();
    await vi.waitFor(async () => {
      await settle();
      expect(rows()).toHaveLength(3);
    });
    const edit = Array.from(el().querySelectorAll<HTMLButtonElement>('.act')).find((b) => b.textContent?.trim() === 'Edit')!;
    edit.click();
    await settle();
    const [, tr] = Array.from(el().querySelectorAll<HTMLTextAreaElement>('.field textarea'));
    tr.value = 'حظ سعيد';
    tr.dispatchEvent(new Event('input'));
    el().querySelector<HTMLButtonElement>('[data-testid="save-edit"]')!.click();
    await vi.waitFor(async () => expect((await db.review.toArray()).some((r) => r.translation === 'حظ سعيد')).toBe(true));
  });

  it('Open in book opens the book at the saved page', async () => {
    await seed();
    await create();
    await vi.waitFor(async () => {
      await settle();
      expect(rows()).toHaveLength(3);
    });
    const btn = Array.from(rows().find((r) => r.textContent?.includes('serendipity'))!.querySelectorAll<HTMLButtonElement>('.act')).find((b) => b.textContent?.trim() === 'Open in book')!;
    btn.click();
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: 'b1' }), { page: 3 });
  });

  it('Practice starts a session with the due items and offers no direction choice', async () => {
    await seed();
    await create();
    await vi.waitFor(async () => {
      await settle();
      expect(el().querySelector('[data-testid="start-practice"]')?.textContent).toContain('3 due today');
    });
    expect(el().querySelector('[role="radio"]')).toBeNull();
    el().querySelector<HTMLButtonElement>('[data-testid="start-practice"]')!.click();
    await settle();
    expect(el().querySelector('iqra-practice [data-testid="progress"]')?.textContent).toBe('0 of 3');
  });
});
