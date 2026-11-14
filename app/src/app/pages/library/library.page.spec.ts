import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthApi } from '../../auth/auth.service';
import { FakeAuthService } from '../../auth/fake-auth.service';
import { BookDetailsService } from '../../books/details/book-details.service';
import { CLOCK } from '../../core/clock';
import { DB, IqraDb } from '../../core/db';
import { newId } from '../../core/ids';
import type { Book, Category } from '../../core/models';
import { DRIVE_ADAPTER } from '../../sync/drive-adapter';
import { FakeDrive } from '../../sync/fake-drive';
import { COPY } from '../../ui/copy';
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

  it('filters by category through the sheet, and removing the chip restores the list', async () => {
    await seed([reading, paused, toRead], [{ id: 'cat-1', name: 'Fiqh', order: 0, updatedAt: 1000, deviceId: 'device-a' }]);
    await create();
    tab('All').click();
    fixture.detectChanges();
    await waitFor(() => mainCards().length === 3);

    const sheetChip = [...el.querySelectorAll<HTMLButtonElement>('iqra-filter-sheet .chip')].find(
      (c) => c.textContent?.trim() === 'Fiqh',
    )!;
    sheetChip.click();
    button(COPY.filter.apply).click();
    await waitFor(() => mainCards().length === 1);

    const remove = el.querySelector<HTMLButtonElement>('[aria-label="Remove filter Fiqh"]');
    expect(remove).not.toBeNull();
    remove!.click();
    await waitFor(() => mainCards().length === 3);
    expect(el.querySelector('[aria-label="Remove filter Fiqh"]')).toBeNull();
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
