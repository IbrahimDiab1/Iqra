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
    await waitFor(() => el.querySelector('.group, .empty') !== null);
  }
  const rows = () => [...el.querySelectorAll<HTMLButtonElement>('.nrow')];

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

  it('renders annotations grouped by book', async () => {
    await db.annotations.bulkPut([
      makeAnn({ id: 'h1', bookId: 'b1', type: 'highlight', page: 3, color: 'green', text: anchor('natural selection') }),
      makeAnn({ id: 'n1', bookId: 'b2', type: 'note', page: 2, body: 'think about this', text: anchor('quote') }),
    ]);
    await create();
    await waitFor(() => rows().length === 2);
    expect([...el.querySelectorAll('.group h2')].map((h) => h.textContent)).toEqual(['Darwin Letters', 'Origin']);
    expect(rows()[0].textContent).toContain('natural selection');
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

  it('presets the filter from ?book and ?type, shows chips, and the Notes tab (no params) clears them', async () => {
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
    expect(el.querySelectorAll('.group h2')).toHaveLength(1);
    expect(el.querySelector('.filters')!.textContent).toContain('Darwin Letters');

    await router.navigateByUrl('/notes');
    await waitFor(() => rows().length === 3);
    expect(el.querySelector('.filters')).toBeNull();
  });

  it('the book chip clears the book filter; the type chip clears only the type', async () => {
    await db.annotations.bulkPut([
      makeAnn({ id: 'h1', bookId: 'b1', type: 'highlight', page: 3, text: anchor('natural selection') }),
      makeAnn({ id: 'n1', bookId: 'b1', type: 'note', page: 2, body: 'a note', text: anchor('q') }),
      makeAnn({ id: 'h2', bookId: 'b2', type: 'highlight', page: 3, text: anchor('other book') }),
    ]);
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/notes?book=b1&type=highlight');
    await create();
    await waitFor(() => rows().length === 1);
    const chips = () => [...el.querySelectorAll<HTMLButtonElement>('.filters .chip')];
    expect(chips()).toHaveLength(2);
    chips()[1].click();
    await waitFor(() => rows().length === 2);
    expect(el.querySelectorAll('.group h2')).toHaveLength(1);
    chips()[0].click();
    await waitFor(() => rows().length === 3);
    expect(el.querySelector('.filters')).toBeNull();
    expect(router.url).toBe('/notes');
  });

  it('tapping a highlight opens the book at its page with the annotation id', async () => {
    await db.annotations.put(makeAnn({ id: 'h1', bookId: 'b1', type: 'highlight', page: 3, text: anchor('natural selection') }));
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await create();
    await waitFor(() => rows().length === 1);
    rows()[0].click();
    await vi.waitFor(() => expect(nav).toHaveBeenCalledWith(['/read', 'b1'], { queryParams: { page: 3, a: 'h1' } }));
  });

  it('tapping a summary opens the text editor in place', async () => {
    await db.annotations.put(makeAnn({ id: 's1', bookId: 'b1', type: 'summary', scope: { kind: 'book' }, body: 'The gist' }));
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await create();
    await waitFor(() => rows().length === 1);
    rows()[0].click();
    await waitFor(() => el.querySelector<HTMLTextAreaElement>('textarea.body')?.value === 'The gist');
    expect(nav).not.toHaveBeenCalled();
  });
});
