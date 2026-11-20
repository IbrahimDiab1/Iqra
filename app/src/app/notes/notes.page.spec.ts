import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOCK } from '../core/clock';
import { DB, IqraDb } from '../core/db';
import { newId } from '../core/ids';
import type { Annotation, Book } from '../core/models';
import { DRIVE_ADAPTER } from '../sync/drive-adapter';
import { FakeDrive } from '../sync/fake-drive';
import { COPY } from '../ui/copy';
import { NotesPage } from './notes.page';

function makeBook(id: string, title: string): Book {
  return {
    id, deviceId: 'dev', updatedAt: 1, title, author: 'A', driveFileId: 'drive-' + id, fileName: id + '.pdf', sizeBytes: 1,
    sha256: id, pageCount: 50, outline: [], language: 'en', direction: 'ltr', addedAt: 1, status: 'to-read', categoryIds: [],
    tags: [], progressMode: 'last-page', pageMode: 'swipe', lastPageReached: 0,
  };
}

function makeAnn(over: Partial<Annotation> & Pick<Annotation, 'id' | 'bookId' | 'type'>): Annotation {
  return { deviceId: 'dev', updatedAt: 1, tags: [], createdAt: 1, ...over };
}

const anchor = (q: string) => ({ page: 3, start: { item: 0, offset: 0 }, end: { item: 0, offset: 1 }, rects: [{ x: 0.1, y: 0.4, w: 0.2, h: 0.02 }], quote: q });

describe('NotesPage', () => {
  let db: IqraDb;
  let fixture: ComponentFixture<NotesPage>;
  let el: HTMLElement;

  async function waitFor(check: () => boolean): Promise<void> {
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(check()).toBe(true);
    });
  }
  async function create(): Promise<void> {
    fixture = TestBed.createComponent(NotesPage);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await waitFor(() => el.querySelector('.card, .empty') !== null);
  }
  const cards = () => [...el.querySelectorAll<HTMLElement>('.card')];
  const rows = cards;

  beforeEach(async () => {
    localStorage.clear();
    db = new IqraDb(`iqra-test-${newId()}`);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'notes', component: NotesPage }]),
        { provide: DB, useValue: db },
        { provide: CLOCK, useValue: { now: () => 5000 } },
        { provide: DRIVE_ADAPTER, useValue: new FakeDrive() },
      ],
    });
    await db.books.bulkPut([makeBook('b1', 'Darwin Letters'), makeBook('b2', 'Origin')]);
    await db.pdfFiles.put({ bookId: 'b1', blob: new Blob(['%PDF']) } as never);
  });

  afterEach(async () => {
    fixture?.destroy();
    TestBed.resetTestingModule();
    await db.delete();
  });

  it('shows the empty state when there are no annotations', async () => {
    await create();
    expect(el.querySelector('.empty')!.textContent).toContain(COPY.annotations.hubEmpty);
  });

  it('renders newest-first cards with book title, relative time and a full-date tooltip', async () => {
    await db.annotations.bulkPut([
      makeAnn({ id: 'h1', bookId: 'b1', type: 'highlight', page: 3, color: 'green', text: anchor('natural selection'), createdAt: 5000 - 3 * 86_400_000 }),
      makeAnn({ id: 'n1', bookId: 'b2', type: 'note', page: 2, body: 'think about this', text: anchor('quote'), createdAt: 5000 - 120_000 }),
    ]);
    await create();
    await waitFor(() => cards().length === 2);
    expect(cards()[0].textContent).toContain('think about this');
    expect(cards()[0].querySelector('.book')!.textContent).toBe('Origin');
    expect(cards()[0].querySelector('time')!.textContent).toBe('2 minutes ago');
    expect(cards()[1].querySelector('time')!.textContent).toBe('3 days ago');
    expect(cards()[1].querySelector('time')!.getAttribute('title')).toBeTruthy();
  });

  it('typing in the search narrows the results, and no match shows the no-results text', async () => {
    await db.annotations.bulkPut([
      makeAnn({ id: 'h1', bookId: 'b1', type: 'highlight', page: 3, text: anchor('natural selection') }),
      makeAnn({ id: 'n1', bookId: 'b2', type: 'note', page: 2, body: 'think about this', text: anchor('quote') }),
    ]);
    await create();
    await waitFor(() => rows().length === 2);
    const input = el.querySelector<HTMLInputElement>('input[type=search]')!;
    input.value = 'think';
    input.dispatchEvent(new Event('input'));
    await waitFor(() => rows().length === 1);
    expect(rows()[0].textContent).toContain('think about this');
    input.value = 'zzzz';
    input.dispatchEvent(new Event('input'));
    await waitFor(() => el.querySelector('.empty') !== null);
    expect(el.querySelector('.empty')!.textContent).toContain(COPY.annotations.hubNoResults);
  });

  it('a type chip and a tag chip filter', async () => {
    await db.annotations.bulkPut([
      makeAnn({ id: 'h1', bookId: 'b1', type: 'highlight', page: 3, tags: ['big-question'], text: anchor('natural selection') }),
      makeAnn({ id: 'n1', bookId: 'b2', type: 'note', page: 2, body: 'think about this', text: anchor('quote') }),
    ]);
    await create();
    await waitFor(() => rows().length === 2);
    const chip = (label: string) => [...el.querySelectorAll<HTMLButtonElement>('.chip')].find((c) => c.textContent!.trim() === label)!;
    chip(COPY.annotations.filters.notes).click();
    await waitFor(() => rows().length === 1);
    chip(COPY.annotations.filters.notes).click();
    chip('big-question').click();
    await waitFor(() => rows().length === 1 && rows()[0].textContent!.includes('natural selection'));
  });

  it('presets the filter from ?book and ?type, and the Notes tab (no params) clears them', async () => {
    await db.annotations.bulkPut([
      makeAnn({ id: 'h1', bookId: 'b1', type: 'highlight', page: 3, text: anchor('natural selection') }),
      makeAnn({ id: 'n1', bookId: 'b1', type: 'note', page: 2, body: 'a note', text: anchor('q') }),
      makeAnn({ id: 'h2', bookId: 'b2', type: 'highlight', page: 3, text: anchor('other book') }),
    ]);
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/notes?book=b1&type=highlight');
    await create();
    await waitFor(() => rows().length === 1);
    expect(rows()[0].textContent).toContain('natural selection');
    expect(el.querySelector('[data-testid="book-chips"]')!.textContent).toContain('Darwin Letters');

    await router.navigateByUrl('/notes');
    await waitFor(() => rows().length === 3);
    expect(el.querySelector('[data-testid="book-chips"]')).toBeNull();
  });

  it('the book chip removes the book filter', async () => {
    await db.annotations.bulkPut([
      makeAnn({ id: 'h1', bookId: 'b1', type: 'highlight', page: 3, text: anchor('natural selection') }),
      makeAnn({ id: 'h2', bookId: 'b2', type: 'highlight', page: 3, text: anchor('other book') }),
    ]);
    await TestBed.inject(Router).navigateByUrl('/notes?book=b1');
    await create();
    await waitFor(() => rows().length === 1);
    el.querySelector<HTMLButtonElement>('[data-testid="book-chips"] .chip')!.click();
    await waitFor(() => rows().length === 2);
  });

  it('types: All by default, areas count as highlights (keeping the area icon), bookmarks are listed', async () => {
    await db.annotations.bulkPut([
      makeAnn({ id: 'h1', bookId: 'b1', type: 'highlight', page: 3, text: anchor('natural selection') }),
      makeAnn({ id: 'a1', bookId: 'b1', type: 'area', page: 4, rect: { x: 0, y: 0, w: 0.5, h: 0.5 } }),
      makeAnn({ id: 'n1', bookId: 'b1', type: 'note', page: 2, body: 'a note', text: anchor('q') }),
      makeAnn({ id: 'k1', bookId: 'b1', type: 'bookmark', page: 9 }),
    ]);
    await create();
    await waitFor(() => rows().length === 4);
    const labels = () => [...el.querySelectorAll('[data-testid="type-chips"] .chip')].map((c) => c.textContent!.trim());
    expect(labels()).toEqual(['All', 'Highlights', 'Notes', 'Summaries', 'Bookmarks']);
    expect(labels()).not.toContain('Areas');
    expect(el.querySelector('[data-testid="type-chips"] .chip')!.getAttribute('aria-pressed')).toBe('true');
    const type = (l: string) => [...el.querySelectorAll<HTMLButtonElement>('[data-testid="type-chips"] .chip')].find((c) => c.textContent!.trim() === l)!;
    type('Highlights').click();
    await waitFor(() => rows().length === 2);
    expect(cards().map((c) => c.dataset['type']).sort()).toEqual(['area', 'highlight']);
    type('Bookmarks').click();
    type('Highlights').click();
    await waitFor(() => rows().length === 1 && cards()[0].dataset['type'] === 'bookmark');
    type('All').click();
    await waitFor(() => rows().length === 4);
  });

  it('filters by category (multi-select, Uncategorized) and by book, combined', async () => {
    await db.categories.bulkPut([
      { id: 'c1', deviceId: 'dev', updatedAt: 1, name: 'Fiqh', order: 0 },
      { id: 'c2', deviceId: 'dev', updatedAt: 1, name: 'History', order: 1 },
    ]);
    await db.books.bulkPut([
      { ...makeBook('b1', 'Darwin Letters'), categoryIds: ['c1'] },
      { ...makeBook('b2', 'Origin'), categoryIds: ['c2'] },
      makeBook('b3', 'Loose'),
    ]);
    await db.annotations.bulkPut([
      makeAnn({ id: 'h1', bookId: 'b1', type: 'highlight', page: 3, text: anchor('one') }),
      makeAnn({ id: 'h2', bookId: 'b2', type: 'highlight', page: 3, text: anchor('two') }),
      makeAnn({ id: 'h3', bookId: 'b3', type: 'highlight', page: 3, text: anchor('three') }),
    ]);
    await create();
    await waitFor(() => rows().length === 3);
    const cat = (l: string) => [...el.querySelectorAll<HTMLButtonElement>('[data-testid="category-chips"] .chip')].find((c) => c.textContent!.trim() === l)!;
    cat('Fiqh').click();
    await waitFor(() => rows().length === 1 && rows()[0].textContent!.includes('one'));
    cat('History').click();
    await waitFor(() => rows().length === 2);
    cat('Fiqh').click();
    cat('History').click();
    cat('Uncategorized').click();
    await waitFor(() => rows().length === 1 && rows()[0].textContent!.includes('three'));
    cat('Uncategorized').click();
    await waitFor(() => rows().length === 3);

    el.querySelector<HTMLButtonElement>('[data-testid="book-picker"]')!.click();
    await waitFor(() => el.querySelectorAll('[data-testid="book-option"]').length === 3);
    const opt = (t: string) => [...el.querySelectorAll<HTMLButtonElement>('[data-testid="book-option"]')].find((o) => o.textContent!.includes(t))!;
    opt('Origin').click();
    opt('Loose').click();
    await waitFor(() => rows().length === 2);
    cat('History').click();
    await waitFor(() => rows().length === 1 && rows()[0].textContent!.includes('two'));
  });

  it('long text is clamped with Show more / Show less that expands in place without navigating', async () => {
    const long = 'word '.repeat(80);
    await db.annotations.bulkPut([
      makeAnn({ id: 'h1', bookId: 'b1', type: 'highlight', page: 3, text: anchor(long) }),
      makeAnn({ id: 'h2', bookId: 'b1', type: 'highlight', page: 4, text: anchor('short'), createdAt: 0 }),
    ]);
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await create();
    await waitFor(() => rows().length === 2);
    expect(cards()[1].querySelector('.more')).toBeNull();
    const text = () => cards()[0].querySelector('.text')!;
    const more = () => cards()[0].querySelector<HTMLButtonElement>('.more')!;
    expect(text().classList.contains('clamped')).toBe(true);
    expect(more().textContent!.trim()).toBe('Show more');
    more().click();
    await waitFor(() => !text().classList.contains('clamped'));
    expect(more().textContent!.trim()).toBe('Show less');
    expect(more().getAttribute('aria-expanded')).toBe('true');
    more().click();
    await waitFor(() => text().classList.contains('clamped'));
    expect(nav).not.toHaveBeenCalled();
  });

  it('"Open in book" opens the book at its page with the annotation id', async () => {
    await db.annotations.put(makeAnn({ id: 'h1', bookId: 'b1', type: 'highlight', page: 3, text: anchor('natural selection') }));
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await create();
    await waitFor(() => rows().length === 1);
    cards()[0].querySelector<HTMLButtonElement>('.open')!.click();
    await vi.waitFor(() => expect(nav).toHaveBeenCalledWith(['/read', 'b1'], { queryParams: { page: 3, a: 'h1' } }));
  });

  it('a summary has Edit (opens the editor in place) and no Open in book', async () => {
    await db.annotations.put(makeAnn({ id: 's1', bookId: 'b1', type: 'summary', scope: { kind: 'book' }, body: 'The gist' }));
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await create();
    await waitFor(() => rows().length === 1);
    expect(cards()[0].querySelector('.open')).toBeNull();
    cards()[0].querySelector<HTMLButtonElement>('.edit')!.click();
    await waitFor(() => el.querySelector<HTMLTextAreaElement>('textarea.body')?.value === 'The gist');
    expect(nav).not.toHaveBeenCalled();
  });
});
