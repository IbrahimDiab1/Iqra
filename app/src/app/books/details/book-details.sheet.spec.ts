import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOCK } from '../../core/clock';
import { DB, IqraDb } from '../../core/db';
import { newId } from '../../core/ids';
import type { Book } from '../../core/models';
import { DRIVE_ADAPTER } from '../../sync/drive-adapter';
import { FakeDrive } from '../../sync/fake-drive';
import { COPY } from '../../ui/copy';
import { BookDetailsService } from './book-details.service';
import { BookDetailsSheetComponent } from './book-details.sheet';

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    id: 'book-1',
    deviceId: 'device-a',
    updatedAt: 1000,
    title: 'Kitab',
    author: 'Author',
    driveFileId: 'drive-1',
    fileName: 'kitab.pdf',
    sizeBytes: 18.4 * 1024 * 1024,
    sha256: 'abc',
    pageCount: 502,
    outline: [],
    language: 'en',
    direction: 'ltr',
    addedAt: 1000,
    status: 'to-read',
    categoryIds: [],
    tags: [],
    progressMode: 'last-page',
    pageMode: 'swipe',
    lastPageReached: 0,
    ...overrides,
  };
}

describe('BookDetailsSheetComponent', () => {
  let db: IqraDb;
  let fixture: ComponentFixture<BookDetailsSheetComponent>;
  let el: HTMLElement;
  let details: BookDetailsService;

  beforeEach(async () => {
    localStorage.clear();
    db = new IqraDb(`iqra-test-${newId()}`);
    TestBed.configureTestingModule({
      imports: [BookDetailsSheetComponent],
      providers: [
        { provide: DB, useValue: db },
        { provide: CLOCK, useValue: { now: () => 5000 } },
        { provide: DRIVE_ADAPTER, useValue: new FakeDrive() },
      ],
    });
    await db.books.put(makeBook());
    details = TestBed.inject(BookDetailsService);
    fixture = TestBed.createComponent(BookDetailsSheetComponent);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    details.open('book-1');
    await waitFor(() => el.querySelector('#bd-title') !== null);
  });

  afterEach(async () => {
    await db.delete();
  });

  /** Polls until the DOM reflects a database read or a live query. */
  async function waitFor(check: () => boolean | Promise<boolean>): Promise<void> {
    await vi.waitFor(async () => {
      fixture.detectChanges();
      expect(await check()).toBe(true);
    });
    fixture.detectChanges();
  }

  function input(id: string): HTMLInputElement {
    return el.querySelector<HTMLInputElement>(`#${id}`)!;
  }

  function buttonByText(text: string): HTMLButtonElement {
    const found = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text);
    if (!found) throw new Error(`No button "${text}"`);
    return found;
  }

  function click(button: HTMLElement): void {
    button.click();
    fixture.detectChanges();
  }

  async function save(): Promise<void> {
    click(buttonByText(COPY.details.save));
    await waitFor(() => details.openBook() === null);
  }

  it('saves a changed title and keeps dir="auto" on the title input', async () => {
    const titleInput = input('bd-title');
    expect(titleInput.getAttribute('dir')).toBe('auto');

    titleInput.value = 'كليلة ودمنة';
    titleInput.dispatchEvent(new Event('input'));
    await save();

    const stored = await db.books.get('book-1');
    expect(stored?.title).toBe('كليلة ودمنة');
  });

  it('clears the rating when the chosen rating is tapped again', async () => {
    click(buttonByText('8'));
    expect(buttonByText('8').getAttribute('aria-pressed')).toBe('true');
    click(buttonByText('8'));
    expect(buttonByText('8').getAttribute('aria-pressed')).toBe('false');

    click(buttonByText('8'));
    await save();

    expect((await db.books.get('book-1'))?.rating).toBe(8);

    details.open('book-1');
    await waitFor(() => el.querySelector('#bd-title') !== null);
    click(buttonByText('8'));
    await save();

    expect((await db.books.get('book-1'))?.rating).toBeUndefined();
  });

  it('turns a typed tag into lowercase-kebab on Enter', async () => {
    const tagInput = el.querySelector<HTMLInputElement>(`input[placeholder="${COPY.details.tagPlaceholder}"]`)!;
    tagInput.value = 'Big Question';
    tagInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();
    await save();

    expect((await db.books.get('book-1'))?.tags).toEqual(['big-question']);
  });

  it('discards edits and leaves the store unchanged on Cancel', async () => {
    input('bd-title').value = 'Changed';
    input('bd-title').dispatchEvent(new Event('input'));
    click(buttonByText('8'));

    click(buttonByText(COPY.common.cancel));
    await waitFor(() => details.openBook() === null);

    const stored = await db.books.get('book-1');
    expect(stored?.title).toBe('Kitab');
    expect(stored?.rating).toBeUndefined();
  });
});
