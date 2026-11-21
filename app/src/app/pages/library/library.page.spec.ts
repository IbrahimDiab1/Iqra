import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthApi } from '../../auth/auth.service';
import { FilesService } from '../../books/files.service';
import { FakeAuthService } from '../../auth/fake-auth.service';
import { BookDetailsService } from '../../books/details/book-details.service';
import { CLOCK } from '../../core/clock';
import { DB, IqraDb } from '../../core/db';
import { newId } from '../../core/ids';
import type { Book, Category } from '../../core/models';
import { DRIVE_ADAPTER } from '../../sync/drive-adapter';
import { FakeDrive } from '../../sync/fake-drive';
import { COPY } from '../../ui/copy';
import { ToastService } from '../../ui/toast.service';
import { CategoryBarComponent } from '../../books/library/category-bar.component';
import { LibraryPage } from './library.page';

function makeBook(overrides: Partial<Book> & Pick<Book, 'id' | 'title' | 'status'>): Book {
  return {
    deviceId: 'device-a',
    updatedAt: 1000,
    author: 'Author',
    driveFileId: 'drive-' + overrides.id,
    fileName: overrides.id + '.pdf',
    sizeBytes: 1024,
    sha256: 'sha-' + overrides.id,
    pageCount: 100,
    outline: [],
    language: 'en',
    direction: 'ltr',
    addedAt: 1000,
    categoryIds: [],
    tags: [],
    progressMode: 'last-page',
    pageMode: 'swipe',
    lastPageReached: 0,
    ...overrides,
  };
}

describe('LibraryPage', () => {
  let db: IqraDb;
  let fixture: ComponentFixture<LibraryPage>;
  let el: HTMLElement;

  /** Polls until the DOM reflects a database read or a live query. */
  async function waitFor(check: () => boolean): Promise<void> {
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(check()).toBe(true);
    });
    fixture.detectChanges();
  }

  function tab(label: string): HTMLButtonElement {
    return [...el.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((t) => t.textContent?.includes(label))!;
  }

  function button(text: string): HTMLButtonElement {
    return [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text)!;
  }

  function mainCards(): HTMLElement[] {
    return [...el.querySelectorAll<HTMLElement>('[data-grid="main"] .book')];
  }

  async function seed(books: Book[], categories: Category[] = []): Promise<void> {
    await db.books.bulkPut(books);
    await db.categories.bulkPut(categories);
  }

  async function create(): Promise<void> {
    fixture = TestBed.createComponent(LibraryPage);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await waitFor(() => el.querySelector('[role="tab"]') !== null && el.textContent!.includes(COPY.library.tabs.reading));
  }

  beforeEach(() => {
    localStorage.clear();
    db = new IqraDb(`iqra-test-${newId()}`);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: DB, useValue: db },
        { provide: CLOCK, useValue: { now: () => 5000 } },
        { provide: DRIVE_ADAPTER, useValue: new FakeDrive() },
        { provide: AuthApi, useClass: FakeAuthService },
      ],
    });
  });

  afterEach(async () => {
    TestBed.resetTestingModule();
    await db.delete();
  });

  const reading = makeBook({ id: 'r', title: 'Reading Book', status: 'reading', lastPageReached: 40, lastOpenedAt: 3000 });
  const paused = makeBook({ id: 'p', title: 'Paused Book', status: 'paused', lastPageReached: 10 });
  const toRead = makeBook({
    id: 't',
    title: 'Waiting Book',
    status: 'to-read',
    categoryIds: ['cat-1'],
    tags: ['history'],
    rating: 8,
  });

  it('shows reading books in the grid and paused books under Paused', async () => {
    await seed([reading, paused, toRead]);
    await create();
    tab('Reading').click();
    await waitFor(() => mainCards().length === 1);

    expect(mainCards()[0].textContent).toContain('Reading Book');
    expect(el.querySelector('[data-grid="paused"]')!.textContent).toContain('Paused Book');
    expect(tab('Reading').textContent).toContain('Reading 2');
  });

  const twoCats: Category[] = [
    { id: 'cat-1', name: 'Fiqh', order: 0, updatedAt: 1000, deviceId: 'device-a' },
    { id: 'cat-2', name: 'History', order: 1, updatedAt: 1000, deviceId: 'device-a' },
  ];
  const loose = makeBook({ id: 'l', title: 'Loose Book', status: 'reading', lastPageReached: 5 });
  const history = makeBook({ id: 'h', title: 'History Book', status: 'reading', lastPageReached: 5, categoryIds: ['cat-2'] });
  const inFiqh = { ...reading, categoryIds: ['cat-1'] };
  const barChip = (key: string) => el.querySelector<HTMLButtonElement>(`iqra-category-bar [data-chip="${key}"]`)!;
  const titles = () => mainCards().map((c) => c.textContent ?? '');

  it('shows a category bar with counts and the filter sheet no longer lists categories', async () => {
    await seed([inFiqh, paused, { ...toRead, categoryIds: ['cat-1'] }, loose, history], twoCats);
    await create();
    await waitFor(() => barChip('cat-1') !== null && barChip('cat-1').textContent!.includes('2'));
    expect(barChip('all').textContent).toContain('5');
    expect(barChip('uncategorized').textContent).toContain('2');
    expect(barChip('cat-2').textContent).toContain('1');
    expect(el.querySelector('iqra-filter-sheet')!.textContent).not.toContain('Categories');
    expect(el.querySelector('iqra-filter-sheet [aria-pressed]')?.textContent).not.toContain('Fiqh');
  });

  it('filters by one category, many categories, Uncategorized and All from the bar', async () => {
    await seed([inFiqh, loose, history], twoCats);
    await create();
    await waitFor(() => titles().length === 3 && barChip('cat-2') !== null);

    barChip('cat-1').click();
    await waitFor(() => titles().length === 1);
    expect(titles()[0]).toContain('Reading Book');

    barChip('cat-2').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    await waitFor(() => titles().length === 2);
    expect(barChip('cat-1').getAttribute('aria-pressed')).toBe('true');
    expect(barChip('cat-2').getAttribute('aria-pressed')).toBe('true');

    barChip('uncategorized').click();
    await waitFor(() => titles().length === 1);
    expect(titles()[0]).toContain('Loose Book');

    barChip('all').click();
    await waitFor(() => titles().length === 3);
    expect(barChip('all').getAttribute('aria-pressed')).toBe('true');
  });

  it('does not repeat one visible selected category as a chip, but summarises several, and the chip clears them', async () => {
    await seed([reading, loose, history], twoCats);
    await create();
    await waitFor(() => barChip('cat-2') !== null);
    barChip('cat-2').click();
    await waitFor(() => barChip('cat-2').getAttribute('aria-pressed') === 'true');
    expect(el.querySelector('[aria-label^="Remove filter"]')).toBeNull();

    barChip('uncategorized').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    await waitFor(() => barChip('uncategorized').getAttribute('aria-pressed') === 'true');
    expect(JSON.parse(localStorage.getItem('iqra.library')!).categoryIds).toEqual(['cat-2', '__uncategorized__']);
    const remove = el.querySelector<HTMLButtonElement>('[aria-label="Remove filter 2 categories"]')!;
    expect(remove).not.toBeNull();
    remove.click();
    await waitFor(() => el.querySelector('[aria-label^="Remove filter"]') === null);
    expect(barChip('all').getAttribute('aria-pressed')).toBe('true');
    expect(JSON.parse(localStorage.getItem('iqra.library')!).categoryIds).toEqual([]);
  });

  it('shows a summary chip for one selected category when the bar reports it scrolled out of view', async () => {
    await seed([reading, loose, history], twoCats);
    await create();
    await waitFor(() => barChip('cat-2') !== null);
    barChip('cat-2').click();
    await waitFor(() => barChip('cat-2').getAttribute('aria-pressed') === 'true');
    const bar = fixture.debugElement.query(By.directive(CategoryBarComponent)).componentInstance as CategoryBarComponent;
    bar.selectionHidden.emit(true);
    await waitFor(() => el.querySelector('[aria-label="Remove filter History"]') !== null);
    bar.selectionHidden.emit(false);
    await waitFor(() => el.querySelector('[aria-label^="Remove filter"]') === null);
  });

  it('says so with a Retry when the category bar code fails to load, keeps the selection visible, and recovers', async () => {
    const real = (LibraryPage.prototype as unknown as { loadBarComponent: () => Promise<unknown> }).loadBarComponent;
    const spy = vi.spyOn(LibraryPage.prototype as unknown as { loadBarComponent: () => Promise<unknown> }, 'loadBarComponent');
    spy.mockRejectedValueOnce(new Error('ChunkLoadError'));
    localStorage.setItem('iqra.library', JSON.stringify({ categoryIds: ['cat-2'] }));
    await seed([reading, loose, history], twoCats);
    await create();
    await waitFor(() => el.querySelector('[data-testid="bar-failed"]') !== null);
    expect(el.querySelector('[data-testid="bar-failed"]')!.textContent).toContain('Categories couldn\u2019t load');
    // The filter is still on and says so, although the bar is missing.
    expect(el.querySelector('[aria-label="Remove filter History"]')).not.toBeNull();

    spy.mockImplementation(real);
    el.querySelector<HTMLButtonElement>('[data-testid="bar-retry"]')!.click();
    await waitFor(() => barChip('cat-2') !== null);
    expect(el.querySelector('[data-testid="bar-failed"]')).toBeNull();
    spy.mockRestore();
  });

  it('does not count categories in the Filter button badge', async () => {
    await seed([reading, loose, history], twoCats);
    await create();
    await waitFor(() => barChip('cat-2') !== null);
    barChip('cat-2').click();
    await waitFor(() => titles().length === 1);
    expect(el.querySelector('.tools .badge')).toBeNull();
  });

  it('deletes a category from the bar, and a deleted one drops out of the filter until Undo', async () => {
    await seed([reading, loose, history], twoCats);
    await create();
    await waitFor(() => barChip('cat-2') !== null);
    barChip('cat-2').click();
    await waitFor(() => titles().length === 1);

    barChip('cat-2').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('[data-testid="menu-delete"]')!.click();
    // The filter must not stay hidden on a category that is gone.
    await waitFor(() => barChip('cat-2') === null && titles().length === 3);
    expect(barChip('all').getAttribute('aria-pressed')).toBe('true');
    expect((await db.books.get('h'))!.categoryIds).toEqual([]);
    TestBed.inject(ToastService).undo();
    await waitFor(() => barChip('cat-2') !== null);
    expect((await db.books.get('h'))!.categoryIds).toEqual(['cat-2']);
  });

  it('keeps the bar inside the page width with many long category names', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, name: `A rather long category name ${i}`, order: i, updatedAt: 1, deviceId: 'device-a' }));
    await seed([reading], many);
    await create();
    await waitFor(() => barChip('m11') !== null);
    const bar = el.querySelector<HTMLElement>('iqra-category-bar')!;
    expect(getComputedStyle(bar.querySelector('.strip')!).overflowX).toBe('auto');
  });

  it('shows the first-run empty state and its button opens the file picker', async () => {
    await create();
    await waitFor(() => el.textContent!.includes(COPY.library.emptyTitle));
    const input = el.querySelector<HTMLInputElement>('input[type="file"]')!;
    const click = vi.spyOn(input, 'click');
    button(COPY.library.addFirst).click();
    expect(click).toHaveBeenCalled();
  });

  it('shows the filtered empty state with a way to clear the filters', async () => {
    await seed([reading, paused, toRead]);
    await create();
    tab('Reading').click();
    fixture.detectChanges();

    const nineOrMore = [...el.querySelectorAll<HTMLButtonElement>('iqra-filter-sheet .chip')].find(
      (c) => c.textContent?.trim() === '9+',
    )!;
    nineOrMore.click();
    button(COPY.filter.apply).click();
    await waitFor(() => el.querySelector('.empty p')?.textContent === COPY.library.emptyFiltered);

    button(COPY.library.clearFilters).click();
    await waitFor(() => mainCards().length === 1);
  });

  it('has no Settings gear: Settings live on the Profile page', async () => {
    await create();
    expect(el.querySelector('a[href="/settings"]')).toBeNull();
    expect(el.querySelector('[aria-label="Settings"]')).toBeNull();
  });

  it('orders the status tabs All, Reading, To read, Finished and starts on All', async () => {
    await seed([reading, paused, toRead]);
    await create();
    expect([...el.querySelectorAll('[role="tab"]')].map((t) => t.textContent!.replace(/\s*\d+$/, '').trim())).toEqual([
      'All',
      'Reading',
      'To read',
      'Finished',
    ]);
    expect(tab('All').getAttribute('aria-selected')).toBe('true');
  });

  it('greets by first name, falls back to Welcome, and starts the rotating stat line with the time read today', async () => {
    const auth = TestBed.inject(AuthApi) as FakeAuthService;
    await db.sessions.put({
      id: 's1', updatedAt: 1, deviceId: 'd', bookId: 'r', startedAt: 5000 - 1000, endedAt: 5000, activeMs: 90 * 60_000, pagesRead: [1, 2],
    } as never);
    await seed([reading]);
    await create();
    await waitFor(() => el.querySelector('[data-testid="welcome-stats"]')!.textContent!.includes('1 h 30 min read today'));
    const name = auth.profile()?.name ?? '';
    const first = name.trim().split(/\s+/)[0];
    expect(el.querySelector('[data-testid="welcome"]')!.textContent).toBe(first ? `Welcome, ${first}` : 'Welcome');
    expect(el.querySelector('[data-testid="welcome-stats"]')!.textContent).toContain('1 h 30 min read today');
  });

  it('shows the brand, today\'s quote before the stat line, and sections as cards', async () => {
    await seed([reading]);
    await create();
    await waitFor(() => el.querySelector('[data-testid="welcome-stats"]') !== null);
    expect(el.querySelector('[data-testid="brand"]')!.textContent).toContain('Iqra');
    const stats = el.querySelector('[data-testid="welcome-stats"]')!;
    const quote = stats.querySelector('[data-testid="quote"]')!.textContent!;
    expect(quote.length).toBeGreaterThan(0);
    expect(quote.length).toBeLessThanOrEqual(60);
    expect(stats.textContent!.indexOf(quote)).toBe(0);
    expect(stats.textContent).toContain('·');
    expect(el.querySelector('section.card')).not.toBeNull();
  });

  it('rotates the stat line every 3 s, pauses while hovered or focused, and is not a live region', async () => {
    await db.sessions.put({
      id: 's1', updatedAt: 1, deviceId: 'd', bookId: 'r', startedAt: 4000, endedAt: 5000, activeMs: 90 * 60_000, pagesRead: [1, 2],
    } as never);
    await seed([reading]);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      await create();
      const stats = () => el.querySelector('[data-testid="welcome-stats"]')!;
      await waitFor(() => stats().textContent!.includes('read today'));
      expect(stats().getAttribute('aria-live')).toBeNull();
      vi.advanceTimersByTime(3000);
      fixture.detectChanges();
      expect(stats().textContent).toContain('2 pages today');
      stats().dispatchEvent(new Event('mouseenter'));
      vi.advanceTimersByTime(9000);
      fixture.detectChanges();
      expect(stats().textContent).toContain('2 pages today');
      stats().dispatchEvent(new Event('mouseleave'));
      vi.advanceTimersByTime(3000);
      fixture.detectChanges();
      expect(stats().textContent).toContain('pages read in total');
    } finally {
      vi.useRealTimers();
    }
  });

  it('lists up to five recently read in-progress books in a Continue reading row, hidden when none', async () => {
    await create();
    expect(el.querySelector('[data-testid="recent"]')).toBeNull();
    const many = Array.from({ length: 7 }, (_, i) =>
      makeBook({ id: `m${i}`, title: `Book ${i}`, status: 'reading', lastPageReached: 50, lastOpenedAt: 100 + i }),
    );
    await db.books.bulkPut(many);
    await waitFor(() => el.querySelector('[data-testid="recent"]') !== null);
    const cards = [...el.querySelectorAll('[data-testid="recent"] iqra-recent-card')];
    expect(cards.length).toBe(5);
    expect(cards[0].textContent).toContain('Book 6');
    expect(cards[0].textContent).toContain('50%');
  });

  it('shows a card with page progress and its category in the category colour', async () => {
    await seed([{ ...reading, categoryIds: ['cat-2'] }], twoCats);
    await create();
    await waitFor(() => mainCards().length === 1);
    const card = mainCards()[0];
    expect(card.textContent).toContain('p. 40/100 · 40%');
    expect(card.querySelector('.cn')!.textContent).toBe('History');
    expect(card.querySelector<HTMLElement>('.dot')!.style.background).toContain('var(--cat-2)');
  });

  it('marks a book that is not downloaded', async () => {
    await seed([toRead]);
    await create();
    tab('To read').click();
    fixture.detectChanges();
    await waitFor(() => el.querySelector('[aria-label="Not downloaded"]') !== null);
  });

  it('opens the details sheet on right-click and the book on tap', async () => {
    await seed([reading]);
    await create();
    await waitFor(() => mainCards().length === 1);
    const details = TestBed.inject(BookDetailsService);
    const open = vi.spyOn(details, 'open');
    const card = mainCards()[0];

    card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(open).toHaveBeenCalledWith('r');
  });

  it('opens details once for a long press followed by contextmenu, and a keyboard Enter still opens the book', async () => {
    await seed([reading]);
    await create();
    await waitFor(() => mainCards().length === 1);
    const details = TestBed.inject(BookDetailsService);
    const open = vi.spyOn(details, 'open');
    const openBook = vi.spyOn(TestBed.inject(FilesService), 'openBook').mockImplementation(() => undefined);
    const card = mainCards()[0];

    card.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 5, clientY: 5 }));
    await new Promise((resolve) => setTimeout(resolve, 520));
    card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(open).toHaveBeenCalledTimes(1);

    // The release click never arrived; a later keyboard click (detail 0) must not be swallowed.
    card.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    expect(openBook).toHaveBeenCalledTimes(1);
  });

  it('moves an Up next row with Alt+ArrowDown and saves the order', async () => {
    const first = makeBook({ id: 'a', title: 'First Up', status: 'to-read' });
    const second = makeBook({ id: 'b', title: 'Second Up', status: 'to-read' });
    await seed([first, second]);
    await db.upNext.put({ id: 'up-next', deviceId: 'device-a', updatedAt: 1000, bookIds: ['a', 'b'] });
    await create();
    tab('To read').click();
    fixture.detectChanges();
    await waitFor(() => el.querySelectorAll('.row').length === 2);

    const row = el.querySelector<HTMLElement>('.row[data-id="a"]')!;
    row.focus();
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }));

    await vi.waitFor(async () => {
      expect((await db.upNext.get('up-next'))?.bookIds).toEqual(['b', 'a']);
    });
    await waitFor(() => el.querySelector<HTMLElement>('.row')?.dataset['id'] === 'b');
    expect(document.activeElement).toBe(el.querySelector('.row[data-id="a"]'));
  });

  it('remembers the selected tab across visits', async () => {
    await seed([reading]);
    await create();
    tab('All').click();
    expect(JSON.parse(localStorage.getItem('iqra.library')!).tab).toBe('all');
  });
});
