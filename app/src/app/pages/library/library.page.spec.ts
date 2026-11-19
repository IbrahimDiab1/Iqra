import { ComponentFixture, TestBed } from '@angular/core/testing';
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

  it('mirrors the selection in the active-filter chips, and removing one clears it', async () => {
    await seed([reading, loose, history], twoCats);
    await create();
    await waitFor(() => barChip('cat-2') !== null);
    barChip('cat-2').click();
    await waitFor(() => el.querySelector('[aria-label="Remove filter History"]') !== null);
    barChip('uncategorized').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    await waitFor(() => el.querySelector(`[aria-label="Remove filter ${COPY.categoryBar.uncategorized}"]`) !== null);
    expect(JSON.parse(localStorage.getItem('iqra.library')!).categoryIds).toEqual(['cat-2', '__uncategorized__']);

    el.querySelector<HTMLButtonElement>('[aria-label="Remove filter History"]')!.click();
    await waitFor(() => el.querySelector('[aria-label="Remove filter History"]') === null);
    expect(barChip('cat-2').getAttribute('aria-pressed')).toBe('false');
    expect(barChip('uncategorized').getAttribute('aria-pressed')).toBe('true');
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

    const nineOrMore = [...el.querySelectorAll<HTMLButtonElement>('iqra-filter-sheet .chip')].find(
      (c) => c.textContent?.trim() === '9+',
    )!;
    nineOrMore.click();
    button(COPY.filter.apply).click();
    await waitFor(() => el.querySelector('.empty p')?.textContent === COPY.library.emptyFiltered);

    button(COPY.library.clearFilters).click();
    await waitFor(() => mainCards().length === 1);
  });

  it('has a Settings gear that links to /settings', async () => {
    await create();
    const gear = (fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>(`a[aria-label="${COPY.library.settings}"]`)!;
    expect(gear.getAttribute('href')).toBe('/settings');
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
