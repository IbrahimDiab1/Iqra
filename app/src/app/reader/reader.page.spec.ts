import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, Router, provideRouter, type UrlTree } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOCK } from '../core/clock';
import { DB, IqraDb } from '../core/db';
import { newId } from '../core/ids';
import type { Book } from '../core/models';
import { DRIVE_ADAPTER } from '../sync/drive-adapter';
import { FakeDrive } from '../sync/fake-drive';
import { COPY } from '../ui/copy';
import { ReadMarkService } from '../progress/read-mark.service';
import { PROGRESS_COPY } from './progress-copy';
import { CHROME_COPY } from './chrome-copy';
import { ToastService } from '../ui/toast.service';
import { signal } from '@angular/core';
import type { PendingSelection } from './selection.service';
import { SelectionService } from './selection.service';
import { AnnotationService } from '../annotations/annotation.service';
import { PagerComponent } from './pager.component';
import { PageRenderer, PageSize, ReaderOpenError } from './pdf-session';
import { PositionService, type RestoredPosition } from './position.service';
import { PDF_OPENER, ReaderPage } from './reader.page';
import { ReaderActions } from './reader-actions';
import { UndoStack } from './undo-stack';
import { ScrollerComponent } from './scroller.component';

class FakeSession implements PageRenderer {
  numPages = 50;
  destroyed = false;
  async pageSize(): Promise<PageSize> {
    return { widthPt: 400, heightPt: 600 };
  }
  renderPage(_p: number, _c: HTMLCanvasElement, _w: number, signal: AbortSignal): Promise<void> {
    return new Promise<void>((_, reject) =>
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))),
    );
  }
  renderTextLayer(): Promise<void> {
    return Promise.resolve();
  }
  async textItems() {
    return [{ str: 'Hello world', width: 100, height: 10, transform: [1, 0, 0, 1, 20, 500] }] as never;
  }
  async pageText() {
    return '';
  }
  destroy() {
    this.destroyed = true;
  }
}

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    id: 'book-1',
    deviceId: 'dev',
    updatedAt: 1,
    title: 'Kitab',
    author: 'A',
    driveFileId: 'drive-1',
    fileName: 'k.pdf',
    sizeBytes: 1,
    sha256: 'x',
    pageCount: 50,
    outline: [
      { key: '0', title: 'Intro', page: 1, children: [] },
      { key: '1', title: 'Second', page: 20, children: [] },
    ],
    language: 'en',
    direction: 'ltr',
    addedAt: 1,
    status: 'to-read',
    categoryIds: [],
    tags: [],
    progressMode: 'last-page',
    pageMode: 'swipe',
    lastPageReached: 0,
    ...overrides,
  };
}

describe('ReaderPage', () => {
  let db: IqraDb;
  let fixture: ComponentFixture<ReaderPage>;
  let el: HTMLElement;
  let session: FakeSession;
  let open: ReturnType<typeof vi.fn>;
  let positions: { restore: ReturnType<typeof vi.fn>; schedule: ReturnType<typeof vi.fn>; markOpened: ReturnType<typeof vi.fn>; flush: ReturnType<typeof vi.fn> };
  let restored: RestoredPosition;
  let query: Map<string, string>;

  beforeEach(async () => {
    localStorage.clear();
    query = new Map();
    db = new IqraDb(`iqra-test-${newId()}`);
    session = new FakeSession();
    open = vi.fn(async () => session);
    restored = { place: { page: 7, offset: 0 }, zoom: 1, view: 'page', fromOtherDevice: false };
    positions = {
      restore: vi.fn(async () => restored),
      schedule: vi.fn(),
      markOpened: vi.fn(async () => undefined),
      flush: vi.fn(async () => undefined),
    };
    await db.books.put(makeBook());
    await db.pdfFiles.put({ bookId: 'book-1', blob: new Blob(['%PDF']) } as never);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: DB, useValue: db },
        { provide: CLOCK, useValue: { now: () => 5000 } },
        { provide: DRIVE_ADAPTER, useValue: new FakeDrive() },
        { provide: PositionService, useValue: positions },
        { provide: PDF_OPENER, useValue: open },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['bookId', 'book-1']]), queryParamMap: query } } },
      ],
    });
  });

  afterEach(async () => {
    fixture?.destroy();
    await db.delete();
  });

  async function create(): Promise<void> {
    fixture = TestBed.createComponent(ReaderPage);
    el = fixture.nativeElement as HTMLElement;
    await settled();
  }

  async function settled(): Promise<void> {
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(el.querySelector('.reader.ready, [role=alert].error')).not.toBeNull();
    });
  }

  const label = () => el.querySelector('.pg')!.textContent!.replace(/\s+/g, ' ').trim();
  const tool = (name: string) => el.querySelector<HTMLButtonElement>(`button[data-tool="${name}"]`);
  const btn = (name: string) => el.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
  const pager = () => fixture.debugElement.query(By.directive(PagerComponent)).componentInstance as PagerComponent;

  const key = (k: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) => {
    const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(e);
    fixture.detectChanges();
    return e;
  };

  it('opens at the restored page and shows it in the label', async () => {
    await create();
    expect(positions.restore).toHaveBeenCalled();
    expect(label()).toContain(CHROME_COPY.pageIndicator(7, 50));
    expect(el.querySelector('.chapter')!.textContent).toContain('Intro');
    expect(el.querySelector('iqra-pager')).not.toBeNull();
  });

  it('a jump enables Back and returns to the previous page; a page turn does not', async () => {
    await create();
    expect(btn(COPY.reader.jumpBack)).toBeNull();
    pager().pageChange.emit(8);
    fixture.detectChanges();
    expect(btn(COPY.reader.jumpBack)).toBeNull();

    el.querySelector<HTMLButtonElement>('.pg')!.click();
    fixture.detectChanges();
    const field = el.querySelector<HTMLInputElement>('input[type=number]')!;
    field.value = '30';
    field.form!.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
    expect(label()).toContain(CHROME_COPY.pageIndicator(30, 50));
    expect(btn(COPY.reader.jumpBack)!.disabled).toBe(false);
    expect(btn(COPY.reader.jumpForward)!.disabled).toBe(true);

    btn(COPY.reader.jumpBack)!.click();
    fixture.detectChanges();
    expect(label()).toContain(CHROME_COPY.pageIndicator(8, 50));
    expect(btn(COPY.reader.jumpForward)!.disabled).toBe(false);
  });

  it('shows the synced toast and its Back action jumps to the previous local page', async () => {
    restored = { place: { page: 20, offset: 0 }, zoom: 1, view: 'page', fromOtherDevice: true, previousLocal: { page: 7, offset: 0 } };
    await create();
    const toast = TestBed.inject(ToastService);
    expect(toast.current()?.message).toBe(COPY.reader.syncedFrom(7));
    expect(toast.current()?.actionLabel).toBe(COPY.reader.backAction);
    toast.undo();
    fixture.detectChanges();
    expect(label()).toContain(CHROME_COPY.pageIndicator(7, 50));
    expect(btn(COPY.reader.jumpBack)!.disabled).toBe(false);
  });

  it('maps a password failure and removes the loading text', async () => {
    open.mockRejectedValueOnce(new ReaderOpenError('password'));
    await create();
    expect(el.textContent).toContain(COPY.reader.passwordFailed);
    expect(el.textContent).not.toContain(COPY.reader.loading);
    expect(el.querySelector('a[href="/library"]')).not.toBeNull();
  });

  it('maps a network failure and Retry opens again', async () => {
    open.mockRejectedValueOnce(new ReaderOpenError('network'));
    await create();
    expect(el.textContent).toContain(COPY.reader.networkFailed);
    const retry = Array.from(el.querySelectorAll('button')).find((b) => b.textContent!.includes(COPY.reader.retry))!;
    retry.click();
    await settled();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(el.querySelector('.reader.ready')).not.toBeNull();
    });
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('a book with no file and no drive source fails', async () => {
    await db.pdfFiles.clear();
    await create();
    expect(el.textContent).toContain(COPY.reader.failed);
    expect(open).not.toHaveBeenCalled();
  });

  it('destroys the session and shows the error when restoring the position throws', async () => {
    positions.restore.mockRejectedValueOnce(new Error('db gone'));
    await create();
    expect(session.destroyed).toBe(true);
    expect(el.textContent).toContain(COPY.reader.failed);
  });

  it('has a header and a toolbar and no bottom bar, slider or hide-on-tap', async () => {
    await create();
    expect(el.querySelector('iqra-reader-header')).not.toBeNull();
    expect(el.querySelector('iqra-reader-toolbar [role=toolbar]')).not.toBeNull();
    expect(el.querySelector('.r-bottom, input[type=range]')).toBeNull();
    pager().tap.emit();
    fixture.detectChanges();
    expect(el.querySelector('iqra-reader-header')!.hasAttribute('inert')).toBe(false);
    expect(el.querySelector('.reader')!.classList.contains('immersive')).toBe(false);
  });

  it('the header shows the title, chapter and section, and the page indicator', async () => {
    await db.books.put(
      makeBook({
        title: 'كتاب',
        outline: [{ key: '0', title: 'Intro', page: 1, children: [{ key: '0.0', title: 'Part A', page: 5, children: [] }] }],
      }),
    );
    await create();
    const head = el.querySelector('iqra-reader-header')!;
    expect(head.querySelector('.t1')!.textContent).toContain('كتاب');
    expect(head.querySelector('.t1')!.getAttribute('dir')).toBe('auto');
    expect(head.querySelector('.chapter')!.textContent).toBe('Intro');
    expect(head.querySelector('.section')!.textContent).toBe('Part A');
    expect(head.querySelector('.t2')!.getAttribute('dir')).toBe('auto');
    expect(label()).toBe(CHROME_COPY.pageIndicator(7, 50));
  });

  it('the page indicator opens Go to page; Enter jumps and records history; Escape closes it', async () => {
    await create();
    el.querySelector<HTMLButtonElement>('.pg')!.click();
    fixture.detectChanges();
    const field = el.querySelector<HTMLInputElement>('input[type=number]')!;
    expect(field.getAttribute('aria-label')).toBe(CHROME_COPY.goToPage);
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(el.querySelector('input[type=number]')).toBeNull();
    key('g');
    fixture.detectChanges();
    const again = el.querySelector<HTMLInputElement>('input[type=number]')!;
    again.value = '99';
    again.form!.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
    expect(label()).toBe(CHROME_COPY.pageIndicator(50, 50));
    expect(btn(COPY.reader.jumpBack)!.disabled).toBe(false);
  });

  it('an rtl book keeps the chrome and the logical page indicator', async () => {
    await db.books.put(makeBook({ direction: 'rtl' }));
    await create();
    expect(el.querySelector('.pg')!.getAttribute('dir')).toBe('ltr');
    expect(el.querySelector('iqra-reader-toolbar')).not.toBeNull();
  });

  it('opening marks the book opened and schedules no position', async () => {
    await create();
    expect(positions.markOpened).toHaveBeenCalledWith(expect.objectContaining({ id: 'book-1' }));
    expect(positions.schedule).not.toHaveBeenCalled();
  });

  it('schedules position saves on page changes and flushes on destroy', async () => {
    await create();
    positions.schedule.mockClear();
    pager().pageChange.emit(9);
    expect(positions.schedule).toHaveBeenCalledWith(expect.objectContaining({ id: 'book-1' }), { page: 9, offset: 0, zoom: 1, view: 'page' });
    fixture.destroy();
    expect(positions.flush).toHaveBeenCalled();
    expect(session.destroyed).toBe(true);
  });

  it('flushes when the document becomes hidden', async () => {
    await create();
    positions.flush.mockClear();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(positions.flush).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('does not leak an unhandled rejection when a flush fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await create();
    positions.flush.mockRejectedValue(new Error('disk'));
    fixture.destroy();
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('renders the child for each mode', async () => {
    await db.books.put(makeBook({ pageMode: 'scroll' }));
    await create();
    expect(el.querySelector('iqra-scroller')).not.toBeNull();
    expect(el.querySelector('iqra-pager')).toBeNull();
    expect(fixture.debugElement.query(By.directive(ScrollerComponent))).not.toBeNull();
    fixture.destroy();

    restored = { ...restored, view: 'reflow' };
    await create();
    expect(el.querySelector('iqra-reflow-view')).not.toBeNull();
    expect(el.querySelector('iqra-scroller')).toBeNull();
  });

  it('switching to reading mode keeps the place', async () => {
    await create();
    el.querySelector<HTMLButtonElement>(`button[aria-label="${COPY.reader.readingMode}"]`)!.click();
    fixture.detectChanges();
    expect(el.querySelector('iqra-reflow-view')).not.toBeNull();
    expect(label()).toContain(CHROME_COPY.pageIndicator(7, 50));
  });

  it('the Contents button opens the drawer and an entry jumps', async () => {
    await create();
    tool('contents')!.click();
    fixture.detectChanges();
    el.querySelectorAll<HTMLButtonElement>('.row')[1].click();
    fixture.detectChanges();
    expect(label()).toContain(CHROME_COPY.pageIndicator(20, 50));
    expect(btn(COPY.reader.jumpBack)!.disabled).toBe(false);
  });

  it('Ctrl+F opens the Search tab', async () => {
    await create();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(el.querySelector('input[type=search]')).not.toBeNull();
  });

  it('the settings button opens the sheet and Scrolling switches to the scroller', async () => {
    await create();
    btn(COPY.reader.settings)!.click();
    fixture.detectChanges();
    Array.from(el.querySelectorAll<HTMLButtonElement>('[role=radio]')).find((b) => b.textContent!.trim() === COPY.reader.scroll)!.click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(el.querySelector('iqra-scroller')).not.toBeNull();
    });
    expect(label()).toContain(CHROME_COPY.pageIndicator(7, 50));
  });

  describe('area tool', () => {
    const area = () => el.querySelector<HTMLButtonElement>(`button[aria-label="${COPY.annotations.area}"]`);

    it('the Area button toggles aria-pressed, shows a header chip, and Escape turns it off', async () => {
      await create();
      expect(area()).not.toBeNull();
      expect(area()!.getAttribute('aria-pressed')).toBe('false');
      area()!.click();
      fixture.detectChanges();
      expect(area()!.getAttribute('aria-pressed')).toBe('true');
      expect(el.querySelector('iqra-reader-header [role=status].chip')!.textContent!.trim()).toBe(CHROME_COPY.areaOn);
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      fixture.detectChanges();
      expect(area()!.getAttribute('aria-pressed')).toBe('false');
      expect(el.querySelector('iqra-reader-header .chip')).toBeNull();
      area()!.click();
      fixture.detectChanges();
      area()!.click();
      fixture.detectChanges();
      expect(area()!.getAttribute('aria-pressed')).toBe('false');
    });

    it('the button is off in reading mode and switching to it turns the tool off', async () => {
      await create();
      area()!.click();
      fixture.detectChanges();
      el.querySelector<HTMLButtonElement>(`button[aria-label="${COPY.reader.readingMode}"]`)!.click();
      fixture.detectChanges();
      expect(area()!.disabled).toBe(true);
      expect(area()!.getAttribute('aria-pressed')).toBe('false');
      el.querySelector<HTMLButtonElement>(`button[aria-label="${COPY.reader.pageView}"]`)!.click();
      fixture.detectChanges();
      expect(area()!.getAttribute('aria-pressed')).toBe('false');
    });

    const draw = () => {
      pager().areaDrawn.emit({ page: 7, rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 } });
      fixture.detectChanges();
    };
    const stored = () => db.annotations.toArray();

    it('a drawn area turns the tool off and offers colors; a color saves an area with Undo', async () => {
      await create();
      area()!.click();
      fixture.detectChanges();
      draw();
      expect(area()!.getAttribute('aria-pressed')).toBe('false');
      expect(el.querySelector('iqra-selection-toolbar [role="toolbar"]')).not.toBeNull();
      expect(el.querySelector('iqra-selection-toolbar button.copy')).toBeNull();
      el.querySelector<HTMLButtonElement>(`button[aria-label="${COPY.annotations.colors.blue}"]`)!.click();
      await vi.waitFor(async () => expect(await stored()).toHaveLength(1));
      expect((await stored())[0]).toMatchObject({ type: 'area', page: 7, color: 'blue', rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 } });
      fixture.detectChanges();
      expect(el.querySelector('iqra-selection-toolbar [role="toolbar"]')).toBeNull();
      const toast = TestBed.inject(ToastService);
      expect(toast.current()?.message).toBe(COPY.annotations.highlightSaved);
      toast.undo();
      await vi.waitFor(async () => expect((await stored()).filter((r) => !r.deleted)).toHaveLength(0));
    });

    it('Note on a drawn area saves a yellow area and opens the note sheet', async () => {
      await create();
      draw();
      el.querySelector<HTMLButtonElement>('iqra-selection-toolbar button.note')!.click();
      await vi.waitFor(async () => expect(await stored()).toHaveLength(1));
      expect((await stored())[0]).toMatchObject({ type: 'area', color: 'yellow' });
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(el.querySelector('iqra-note-sheet .panel.open')).not.toBeNull();
      });
    });

    it('Escape dismisses a drawn area without saving', async () => {
      await create();
      draw();
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      fixture.detectChanges();
      expect(el.querySelector('iqra-selection-toolbar [role="toolbar"]')).toBeNull();
      expect(await stored()).toHaveLength(0);
    });
  });

  describe('notes tab and badge', () => {
    const hl = (id: string, page: number) => TestBed.inject(AnnotationService).create({
      bookId: 'book-1', type: 'highlight', page, color: 'green', tags: [],
      text: { page, start: { item: 0, offset: 0 }, end: { item: 0, offset: 5 }, rects: [{ x: 0.1, y: 0.5, w: 0.2, h: 0.02 }], quote: `quote ${id}` },
    });

    it('the Contents button shows how many notes the current page has, and hides at zero; bookmarks do not count', async () => {
      await create();
      const pill = () => tool('contents')!;
      expect(pill().querySelector('.badge')).toBeNull();
      const svc = TestBed.inject(AnnotationService);
      await svc.create({ bookId: 'book-1', type: 'bookmark', page: 7 });
      await hl('a', 7);
      await hl('b', 9);
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(pill().querySelector('.badge')!.textContent!.trim()).toBe('1');
      });
    });

    it('tapping a note row jumps, pushes a history entry and flashes it', async () => {
      await create();
      const rec = await hl('far', 30);
      await vi.waitFor(() => {
        fixture.detectChanges();
        tool('contents')!.click();
        fixture.detectChanges();
        expect(el.querySelector('iqra-book-panel-drawer .tabs')).not.toBeNull();
      });
      Array.from(el.querySelectorAll<HTMLButtonElement>('iqra-book-panel-drawer [role=tab]')).find((t) => t.textContent!.trim() === COPY.reader.notes)!.click();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(el.querySelector('iqra-book-panel-drawer .nrow')).not.toBeNull();
      });
      el.querySelector<HTMLButtonElement>('iqra-book-panel-drawer .nrow')!.click();
      fixture.detectChanges();
      expect(label()).toContain(CHROME_COPY.pageIndicator(30, 50));
      expect(btn(COPY.reader.jumpBack)!.disabled).toBe(false);
      expect((fixture.componentInstance as unknown as { state(): { flash(): string | null } }).state().flash()).toBe(rec.id);
    });

    it('typing into a panel-made side note and closing at once keeps the note with its text', async () => {
      await create();
      tool('contents')!.click();
      fixture.detectChanges();
      Array.from(el.querySelectorAll<HTMLButtonElement>('iqra-book-panel-drawer [role=tab]')).find((t) => t.textContent!.trim() === COPY.reader.notes)!.click();
      fixture.detectChanges();
      Array.from(el.querySelectorAll<HTMLButtonElement>('iqra-book-panel-drawer .act')).find((b) => b.textContent!.includes('Side note'))!.click();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(el.querySelector('iqra-text-editor-sheet .panel.open')).not.toBeNull();
      });
      const ta = el.querySelector<HTMLTextAreaElement>('iqra-text-editor-sheet textarea')!;
      ta.value = 'keep me';
      ta.dispatchEvent(new Event('input'));
      el.querySelector<HTMLButtonElement>('iqra-text-editor-sheet button.close')!.click();
      await new Promise((r) => setTimeout(r, 200));
      const live = (await db.annotations.toArray()).filter((r) => r.type === 'side-note' && !r.deleted);
      expect(live).toHaveLength(1);
      expect(live[0].body).toBe('keep me');
    });

    it('a side note made from the panel opens the editor; closing it empty removes it', async () => {
      await create();
      tool('contents')!.click();
      fixture.detectChanges();
      Array.from(el.querySelectorAll<HTMLButtonElement>('iqra-book-panel-drawer [role=tab]')).find((t) => t.textContent!.trim() === COPY.reader.notes)!.click();
      fixture.detectChanges();
      Array.from(el.querySelectorAll<HTMLButtonElement>('iqra-book-panel-drawer .act')).find((b) => b.textContent!.includes('Side note'))!.click();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(el.querySelector('iqra-text-editor-sheet .panel.open')).not.toBeNull();
      });
      expect((await db.annotations.toArray()).filter((r) => r.type === 'side-note' && !r.deleted)).toHaveLength(1);
      el.querySelector<HTMLButtonElement>('iqra-text-editor-sheet button.close')!.click();
      await vi.waitFor(async () => expect((await db.annotations.toArray()).filter((r) => r.type === 'side-note' && !r.deleted)).toHaveLength(0));
    });
  });

  describe('bookmarks and summaries', () => {
    const stored = () => db.annotations.toArray();
    const bookmarkBtn = () => el.querySelector<HTMLButtonElement>('button[data-tool="bookmark"]')!;

    it('the bookmark button toggles a bookmark on the current page; removing offers Undo', async () => {
      await create();
      expect(bookmarkBtn().getAttribute('aria-label')).toBe(COPY.annotations.addBookmark);
      bookmarkBtn().click();
      await vi.waitFor(async () => expect((await stored()).filter((r) => !r.deleted && r.type === 'bookmark' && r.page === 7)).toHaveLength(1));
      const toast = TestBed.inject(ToastService);
      expect(toast.current()?.message).toBe(COPY.annotations.bookmarkAdded);
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(bookmarkBtn().getAttribute('aria-label')).toBe(COPY.annotations.removeBookmark);
        expect(bookmarkBtn().getAttribute('aria-pressed')).toBe('true');
      });
      bookmarkBtn().click();
      await vi.waitFor(async () => expect((await stored()).filter((r) => !r.deleted)).toHaveLength(0));
      expect(toast.current()?.message).toBe(COPY.annotations.deleted);
      toast.undo();
      await vi.waitFor(async () => expect((await stored()).filter((r) => !r.deleted && r.type === 'bookmark')).toHaveLength(1));
    });

    it('a fast double tap on the bookmark button is add then remove: one record, none left live', async () => {
      await create();
      bookmarkBtn().click();
      bookmarkBtn().click();
      await vi.waitFor(async () => {
        const rows = (await stored()).filter((r) => r.type === 'bookmark');
        expect(rows).toHaveLength(1);
        expect(rows[0].deleted).toBe(true);
      });
      fixture.detectChanges();
      expect(bookmarkBtn().getAttribute('aria-pressed')).toBe('false');
    });

    async function openContents() {
      tool('contents')!.click();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(el.querySelector('iqra-book-panel-drawer .book-sum')).not.toBeNull();
      });
    }

    it('Contents shows the Write a summary card; it opens the editor and closing it untouched creates nothing', async () => {
      await create();
      await openContents();
      el.querySelector<HTMLButtonElement>('iqra-book-panel-drawer .book-sum')!.click();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(el.querySelector('iqra-text-editor-sheet .panel.open')).not.toBeNull();
      });
      el.querySelector<HTMLButtonElement>('iqra-text-editor-sheet button.close')!.click();
      await new Promise((r) => setTimeout(r, 50));
      expect(await stored()).toHaveLength(0);
    });

    it('typing in a new summary creates it with the chapter scope', async () => {
      await create();
      await openContents();
      el.querySelectorAll<HTMLButtonElement>('iqra-book-panel-drawer .sum')[1].click();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(el.querySelector('iqra-text-editor-sheet .panel.open')).not.toBeNull();
      });
      const ta = el.querySelector<HTMLTextAreaElement>('iqra-text-editor-sheet textarea')!;
      ta.value = 'About the second part';
      ta.dispatchEvent(new Event('input'));
      el.querySelector<HTMLButtonElement>('iqra-text-editor-sheet button.close')!.click();
      await vi.waitFor(async () => {
        const rows = (await stored()).filter((r) => r.type === 'summary');
        expect(rows).toHaveLength(1);
        expect(rows[0].scope).toEqual({ kind: 'outline', nodeKey: '1', title: 'Second', fromPage: 20, toPage: 50 });
        expect(rows[0].body).toBe('About the second part');
      });
    });
  });

  describe('highlighting a selection', () => {
    const fakeSelection = {
      pending: signal<PendingSelection | null>(null),
      active: signal(false),
      attach: vi.fn(),
      clear: vi.fn(),
    };

    beforeEach(() => {
      fakeSelection.pending.set({
        page: 7,
        start: { item: 0, offset: 0 },
        end: { item: 0, offset: 5 },
        quote: 'Hello',
        rect: { left: 50, top: 100, right: 100, bottom: 120, width: 50, height: 20, x: 50, y: 100, toJSON: () => ({}) } as DOMRect,
        source: 'page',
      });
      fakeSelection.clear.mockClear();
      TestBed.overrideComponent(ReaderPage, { set: { providers: [{ provide: SelectionService, useValue: fakeSelection }, UndoStack, ReaderActions] } });
    });

    const stored = () => db.annotations.toArray();

    it('a failed save shows an error toast and keeps the selection', async () => {
      await create();
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      vi.spyOn(TestBed.inject(AnnotationService), 'addHighlight').mockRejectedValue(new Error('db'));
      fixture.detectChanges();
      el.querySelector<HTMLButtonElement>(`button[aria-label="${COPY.annotations.colors.pink}"]`)!.click();
      const toast = TestBed.inject(ToastService);
      await vi.waitFor(() => expect(toast.current()?.message).toBe(COPY.annotations.saveFailed));
      expect(fakeSelection.clear).not.toHaveBeenCalled();
      expect(fakeSelection.pending()).not.toBeNull();
    });

    it('a failed copy shows an error toast; a good copy says Copied', async () => {
      await create();
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const write = vi.fn().mockRejectedValue(new Error('denied'));
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true });
      fixture.detectChanges();
      const copy = () => el.querySelector<HTMLButtonElement>('iqra-selection-toolbar button.copy')!.click();
      copy();
      const toast = TestBed.inject(ToastService);
      await vi.waitFor(() => expect(toast.current()?.message).toBe(COPY.annotations.copyFailed));
      write.mockResolvedValue(undefined);
      copy();
      await vi.waitFor(() => expect(toast.current()?.message).toBe(COPY.annotations.copied));
      expect(write).toHaveBeenLastCalledWith('Hello');
    });

    it('with no selection (a page without text) no toolbar is shown', async () => {
      fakeSelection.pending.set(null);
      await create();
      fixture.detectChanges();
      expect(el.querySelector('iqra-selection-toolbar [role="toolbar"]')).toBeNull();
    });

    it('a color creates one highlight with an Undo toast; Undo removes it', async () => {
      await create();
      fixture.detectChanges();
      el.querySelector<HTMLButtonElement>(`button[aria-label="${COPY.annotations.colors.green}"]`)!.click();
      await vi.waitFor(async () => expect(await stored()).toHaveLength(1));
      const [a] = await stored();
      expect(a).toMatchObject({ type: 'highlight', color: 'green', page: 7, bookId: 'book-1' });
      expect(a.text?.quote).toBe('Hello');
      expect(fakeSelection.clear).toHaveBeenCalled();
      const toast = TestBed.inject(ToastService);
      expect(toast.current()?.message).toBe(COPY.annotations.highlightSaved);
      toast.undo();
      await vi.waitFor(async () => expect((await stored()).filter((r) => !r.deleted)).toHaveLength(0));
    });

    it('Note creates a note, opens the sheet focused, and closing it empty removes the note', async () => {
      await create();
      fixture.detectChanges();
      el.querySelector<HTMLButtonElement>('iqra-selection-toolbar button.note')!.click();
      await vi.waitFor(async () => expect(await stored()).toHaveLength(1));
      const [n] = await stored();
      expect(n).toMatchObject({ type: 'note', page: 7, bookId: 'book-1' });
      expect(fakeSelection.clear).toHaveBeenCalled();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(el.querySelector('iqra-note-sheet .panel.open')).not.toBeNull();
        expect(document.activeElement).toBe(el.querySelector('iqra-note-sheet textarea'));
      });
      expect(el.querySelector('iqra-note-sheet .quote')!.textContent).toContain('Hello');
      el.querySelector<HTMLButtonElement>('iqra-note-sheet button.close')!.click();
      await vi.waitFor(async () => expect((await stored()).filter((r) => !r.deleted)).toHaveLength(0));
      fixture.detectChanges();
      expect(el.querySelector('iqra-note-sheet .panel.open')).toBeNull();
    });

    it('Note, typing and closing keeps the note with its text', async () => {
      await create();
      fixture.detectChanges();
      el.querySelector<HTMLButtonElement>('iqra-selection-toolbar button.note')!.click();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(el.querySelector('iqra-note-sheet textarea')).not.toBeNull();
      });
      const ta = el.querySelector<HTMLTextAreaElement>('iqra-note-sheet textarea')!;
      ta.value = 'worth remembering';
      ta.dispatchEvent(new Event('input'));
      el.querySelector<HTMLButtonElement>('iqra-note-sheet button.close')!.click();
      await vi.waitFor(async () => expect((await stored())[0].body).toBe('worth remembering'));
      expect((await stored())[0].deleted).toBeFalsy();
    });

    it('tapping an old empty note and closing does not delete it', async () => {
      await create();
      fakeSelection.pending.set(null);
      const rec = await TestBed.inject(AnnotationService).create({
        bookId: 'book-1', type: 'note', page: 7, tags: [],
        text: { page: 7, start: { item: 0, offset: 0 }, end: { item: 0, offset: 5 }, rects: [], quote: 'Hello' },
      });
      pager().annotationTap.emit(rec);
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(el.querySelector('iqra-note-sheet .panel.open')).not.toBeNull();
      });
      el.querySelector<HTMLButtonElement>('iqra-note-sheet button.close')!.click();
      await new Promise((r) => setTimeout(r, 50));
      expect((await stored()).filter((r) => !r.deleted)).toHaveLength(1);
    });

    it('tapping a highlight opens its note sheet', async () => {
      await create();
      fakeSelection.pending.set(null);
      const rec = await TestBed.inject(AnnotationService).create({
        bookId: 'book-1', type: 'highlight', page: 7, color: 'pink', tags: [],
        text: { page: 7, start: { item: 0, offset: 0 }, end: { item: 0, offset: 5 }, rects: [], quote: 'Hello' },
      });
      pager().annotationTap.emit(rec);
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(el.querySelector('iqra-note-sheet .panel.open')).not.toBeNull();
      });
      expect(el.querySelector('iqra-note-sheet .quote')!.textContent).toContain('Hello');
    });
  });

  describe('opening at an annotation (?page=&a=)', () => {
    const stateOf = () => (fixture.componentInstance as unknown as { state(): { flash(): string | null } }).state();

    async function seedHighlight(deleted = false): Promise<void> {
      await db.annotations.put({
        id: 'ann-1', bookId: 'book-1', deviceId: 'dev', updatedAt: 1, type: 'highlight', page: 7, color: 'green', tags: [], createdAt: 1,
        ...(deleted ? { deleted: true } : {}),
        text: { page: 7, start: { item: 0, offset: 0 }, end: { item: 0, offset: 3 }, quote: 'Hel', rects: [{ x: 0.1, y: 0.4, w: 0.2, h: 0.02 }] },
      });
    }

    it('shows that page and flashes the annotation', async () => {
      restored = { place: { page: 3, offset: 0 }, zoom: 1, view: 'page', fromOtherDevice: false };
      query.set('page', '7');
      query.set('a', 'ann-1');
      await seedHighlight();
      await create();
      expect(label()).toContain(CHROME_COPY.pageIndicator(7, 50));
      expect(stateOf().flash()).toBe('ann-1');
      expect(btn(COPY.reader.jumpBack)!.disabled).toBe(false);
    });

    it('drops page and a from the URL once consumed, so a reload keeps the reader\'s own place', async () => {
      const router = TestBed.inject(Router);
      const go = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
      vi.spyOn(router, 'url', 'get').mockReturnValue('/read/book-1?source=drive&page=7&a=ann-1');
      query.set('page', '7');
      query.set('a', 'ann-1');
      await seedHighlight();
      await create();
      expect(go).toHaveBeenCalledTimes(1);
      const [tree, extras] = go.mock.calls[0];
      expect(router.serializeUrl(tree as UrlTree)).toBe('/read/book-1?source=drive');
      expect(extras).toEqual({ replaceUrl: true });
    });

    it('does not touch the URL when there is no open target', async () => {
      const go = vi.spyOn(TestBed.inject(Router), 'navigateByUrl');
      await create();
      expect(go).not.toHaveBeenCalled();
    });

    it('is not overwritten by the other-device position toast', async () => {
      restored = { place: { page: 20, offset: 0 }, zoom: 1, view: 'page', fromOtherDevice: true, previousLocal: { page: 3, offset: 0 } };
      query.set('page', '7');
      await create();
      expect(label()).toContain(CHROME_COPY.pageIndicator(7, 50));
      expect(TestBed.inject(ToastService).current()).toBeNull();
    });

    it('ignores an invalid page', async () => {
      query.set('page', 'abc');
      query.set('a', 'ann-1');
      await seedHighlight();
      await create();
      expect(label()).toContain(CHROME_COPY.pageIndicator(7, 50));
      expect(stateOf().flash()).toBeNull();
    });

    it('does not flash a deleted annotation', async () => {
      query.set('page', '9');
      query.set('a', 'ann-1');
      await seedHighlight(true);
      await create();
      expect(label()).toContain(CHROME_COPY.pageIndicator(9, 50));
      expect(stateOf().flash()).toBeNull();
    });
  });
  describe('progress', () => {
    const markButton = () => el.querySelector<HTMLButtonElement>('button[data-tool="mark"]');

    it('the Mark page read button is disabled with a hint in last-page mode, and in marked mode it toggles', async () => {
      await create();
      expect(markButton()!.getAttribute('aria-disabled')).toBe('true');
      expect(markButton()!.getAttribute('aria-label')).toBe(CHROME_COPY.markDisabled);
      expect(markButton()!.hasAttribute('aria-pressed')).toBe(false);
      markButton()!.click();
      key('m');
      expect(await db.readMarks.count()).toBe(0);
      fixture.destroy();
      await db.books.put(makeBook({ progressMode: 'marked' }));
      await create();
      const b = markButton()!;
      expect(b.hasAttribute('aria-disabled')).toBe(false);
      expect(b.getAttribute('aria-label')).toBe(CHROME_COPY.markPageRead);
      expect(b.getAttribute('aria-pressed')).toBe('false');
      b.click();
      await vi.waitFor(async () => {
        fixture.detectChanges();
        expect((await db.readMarks.get('book-1:7'))?.read).toBe(true);
        expect(markButton()!.getAttribute('aria-pressed')).toBe('true');
      });
      expect(markButton()!.getAttribute('aria-label')).toBe(CHROME_COPY.unmarkPageRead);
      markButton()!.click();
      await vi.waitFor(async () => expect((await db.readMarks.get('book-1:7'))?.read).toBe(false));
    });

    it('offers to mark finished once when the last page is reached, and the action finishes the book', async () => {
      await create();
      const toast = TestBed.inject(ToastService);
      expect(toast.current()).toBeNull();
      pager().pageChange.emit(50);
      fixture.detectChanges();
      expect(toast.current()?.message).toBe(PROGRESS_COPY.finishPrompt);
      expect(toast.current()?.actionLabel).toBe(PROGRESS_COPY.markFinished);
      toast.dismiss();
      pager().pageChange.emit(49);
      fixture.detectChanges();
      pager().pageChange.emit(50);
      fixture.detectChanges();
      expect(toast.current()).toBeNull();

      pager().pageChange.emit(49);
      fixture.detectChanges();
      pager().pageChange.emit(50);
      fixture.detectChanges();
      expect(toast.current()).toBeNull();
    });

    it('the finish action sets status and finishedAt', async () => {
      await create();
      const toast = TestBed.inject(ToastService);
      pager().pageChange.emit(50);
      fixture.detectChanges();
      toast.undo();
      await vi.waitFor(async () => {
        const stored = (await db.books.get('book-1'))!;
        expect(stored.status).toBe('finished');
        expect(stored.finishedAt).toBe(5000);
      });
    });

    it('does not offer it again for a book already at its end or finished', async () => {
      fixture?.destroy();
      await db.books.put(makeBook({ lastPageReached: 50 }));
      await create();
      pager().pageChange.emit(50);
      fixture.detectChanges();
      expect(TestBed.inject(ToastService).current()).toBeNull();
    });

    it('in marked mode, marking the last unmarked page offers it', async () => {
      fixture?.destroy();
      await db.books.put(makeBook({ progressMode: 'marked' }));
      for (let p = 1; p <= 50; p++) {
        if (p !== 7) await db.readMarks.put({ id: `book-1:${p}`, bookId: 'book-1', page: p, read: true, updatedAt: 1, deviceId: 'dev' });
      }
      await create();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(markButton()).not.toBeNull();
      });
      pager().pageChange.emit(50);
      fixture.detectChanges();
      expect(TestBed.inject(ToastService).current()).toBeNull();
      pager().pageChange.emit(7);
      fixture.detectChanges();
      markButton()!.click();
      await vi.waitFor(() => expect(TestBed.inject(ToastService).current()?.message).toBe(PROGRESS_COPY.finishPrompt));
    });

    it('in marked mode, marking the last unmarked page through the Contents range write offers it once', async () => {
      fixture?.destroy();
      await db.books.put(makeBook({ progressMode: 'marked' }));
      for (let p = 1; p <= 50; p++) {
        if (p < 10 || p > 12) await db.readMarks.put({ id: `book-1:${p}`, bookId: 'book-1', page: p, read: true, updatedAt: 1, deviceId: 'dev' });
      }
      await create();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(markButton()).not.toBeNull();
      });
      const toast = TestBed.inject(ToastService);
      expect(toast.current()).toBeNull();
      const marks = TestBed.inject(ReadMarkService);
      await marks.setRange('book-1', 10, 12, true);
      await vi.waitFor(() => expect(toast.current()?.message).toBe(PROGRESS_COPY.finishPrompt));
      toast.dismiss();
      await marks.setRange('book-1', 10, 12, false);
      await marks.setRange('book-1', 10, 12, true);
      await new Promise((r) => setTimeout(r, 100));
      expect(toast.current()).toBeNull();
    });

    it('closing the reader releases the live read-mark query', async () => {
      fixture?.destroy();
      await db.books.put(makeBook({ progressMode: 'marked' }));
      await create();
      const marks = TestBed.inject(ReadMarkService);
      const release = vi.spyOn(marks, 'release');
      fixture.destroy();
      expect(release).toHaveBeenCalledWith('book-1');
    });
  });

  describe('shortcuts', () => {
    const area = () => tool('area')!;
    const annotationsOf = () => db.annotations.toArray();

    it('B toggles the bookmark, A the area tool, R the reading mode, C/N/\\/ open the drawer', async () => {
      await create();
      key('b');
      await vi.waitFor(async () => expect((await annotationsOf()).filter((r) => r.type === 'bookmark' && !r.deleted)).toHaveLength(1));
      key('a');
      expect(area().getAttribute('aria-pressed')).toBe('true');
      key('a');
      expect(area().getAttribute('aria-pressed')).toBe('false');
      key('r');
      expect(el.querySelector('iqra-reflow-view')).not.toBeNull();
      key('r');
      expect(el.querySelector('iqra-pager')).not.toBeNull();
      key('c');
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(el.querySelector('iqra-drawer .panel.open')).not.toBeNull();
        expect(el.querySelector('iqra-drawer h3')!.textContent).toBe(COPY.reader.contents);
      });
      key('n');
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(el.querySelector('iqra-drawer h3')!.textContent).toBe(COPY.reader.notes);
      });
      key('/');
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(el.querySelector('input[type=search]')).not.toBeNull();
      });
    });

    it('M marks the page in marked mode and explains itself in last-page mode', async () => {
      await create();
      key('m');
      expect(TestBed.inject(ToastService).current()?.message).toBe(CHROME_COPY.markDisabled);
      fixture.destroy();
      await db.books.put(makeBook({ progressMode: 'marked' }));
      await create();
      key('m');
      await vi.waitFor(async () => expect((await db.readMarks.get('book-1:7'))?.read).toBe(true));
    });

    it('F toggles full screen, G opens Go to page, ? opens the cheat-sheet, Ctrl+F is taken', async () => {
      await create();
      const request = vi.fn(async () => undefined);
      (document.documentElement as unknown as { requestFullscreen: () => Promise<void> }).requestFullscreen = request;
      key('f');
      expect(request).toHaveBeenCalled();
      key('g');
      expect(el.querySelector('input[type=number]')).not.toBeNull();
      key('?', { shiftKey: true });
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(el.querySelector('iqra-shortcut-help .panel.open')).not.toBeNull();
      });
      expect(key('f', { ctrlKey: true }).defaultPrevented).toBe(true);
      delete (document.documentElement as unknown as { requestFullscreen?: unknown }).requestFullscreen;
    });

    it('browser shortcuts stay alone: Ctrl+B, Ctrl+A and Ctrl+R do nothing here', async () => {
      await create();
      for (const k of ['b', 'a', 'r', 'c', 'm']) expect(key(k, { ctrlKey: true }).defaultPrevented).toBe(false);
      expect(area().getAttribute('aria-pressed')).toBe('false');
      expect(el.querySelector('iqra-reflow-view')).toBeNull();
      expect(await annotationsOf()).toHaveLength(0);
    });

    it('is ignored while typing in a field', async () => {
      await create();
      tool('contents')!.click();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(el.querySelector('iqra-drawer .panel.open')).not.toBeNull();
      });
      key('/');
      let field!: HTMLInputElement;
      await vi.waitFor(() => {
        fixture.detectChanges();
        field = el.querySelector<HTMLInputElement>('input[type=search]')!;
        expect(field).not.toBeNull();
      });
      for (const k of ['b', 'a', 'r', 'm', 'g', 'f', '?']) key(k, {}, field);
      expect(area().getAttribute('aria-pressed')).toBe('false');
      expect(el.querySelector('iqra-reflow-view')).toBeNull();
      expect(await annotationsOf()).toHaveLength(0);
      expect(el.querySelector('input[type=number]')).toBeNull();
    });
  });

  describe('progress mode switch', () => {
    const choose = async (label: string) => {
      tool('progress')!.click();
      fixture.detectChanges();
      Array.from(el.querySelectorAll<HTMLButtonElement>('[role=menuitemradio]')).find((b) => b.textContent!.includes(label))!.click();
    };

    it('switches to marked mode, keeps the data, and the Mark button becomes active', async () => {
      await db.books.put(makeBook({ lastPageReached: 12 }));
      await db.readMarks.put({ id: 'book-1:3', bookId: 'book-1', page: 3, read: true, updatedAt: 1, deviceId: 'dev' });
      await create();
      expect(tool('mark')!.getAttribute('aria-disabled')).toBe('true');
      await choose(CHROME_COPY.trackByMarked);
      await vi.waitFor(async () => {
        fixture.detectChanges();
        expect((await db.books.get('book-1'))!.progressMode).toBe('marked');
        expect(tool('mark')!.hasAttribute('aria-disabled')).toBe(false);
      });
      expect(TestBed.inject(ToastService).current()?.message).toBe(CHROME_COPY.nowMarked);
      expect((await db.books.get('book-1'))!.lastPageReached).toBe(12);
      expect((await db.readMarks.get('book-1:3'))!.read).toBe(true);
    });

    it('switches back to last-page mode and says so', async () => {
      await db.books.put(makeBook({ progressMode: 'marked' }));
      await create();
      await choose(CHROME_COPY.trackByLast);
      await vi.waitFor(async () => {
        fixture.detectChanges();
        expect((await db.books.get('book-1'))!.progressMode).toBe('last-page');
        expect(tool('mark')!.getAttribute('aria-disabled')).toBe('true');
      });
      expect(TestBed.inject(ToastService).current()?.message).toBe(CHROME_COPY.nowLast);
    });
  });

  describe('undo and redo', () => {
    const fakeSelection = {
      pending: signal<PendingSelection | null>(null),
      active: signal(false),
      attach: vi.fn(),
      clear: vi.fn(),
    };
    const live = async () => (await db.annotations.toArray()).filter((r) => !r.deleted);
    const undoBtn = () => tool('undo')!;
    const redoBtn = () => tool('redo')!;
    const toast = () => TestBed.inject(ToastService);

    beforeEach(() => {
      fakeSelection.pending.set({
        page: 7,
        start: { item: 0, offset: 0 },
        end: { item: 0, offset: 5 },
        quote: 'Hello',
        rect: { left: 50, top: 100, right: 100, bottom: 120, width: 50, height: 20, x: 50, y: 100, toJSON: () => ({}) } as DOMRect,
        source: 'page',
      });
      TestBed.overrideComponent(ReaderPage, { set: { providers: [{ provide: SelectionService, useValue: fakeSelection }, UndoStack, ReaderActions] } });
    });

    async function highlightGreen(): Promise<void> {
      fixture.detectChanges();
      el.querySelector<HTMLButtonElement>(`iqra-selection-toolbar button[aria-label="${COPY.annotations.colors.green}"]`)!.click();
      await vi.waitFor(async () => expect(await live()).toHaveLength(1));
      fakeSelection.pending.set(null);
      fixture.detectChanges();
    }

    it('Undo and Redo start disabled and the keys keep their browser meaning', async () => {
      await create();
      expect(undoBtn().disabled).toBe(true);
      expect(redoBtn().disabled).toBe(true);
      expect(key('z', { ctrlKey: true }).defaultPrevented).toBe(true);
      expect(await live()).toHaveLength(0);
    });

    it('Ctrl+Z removes a just-created highlight, Ctrl+Shift+Z brings it back, with Undid and Redo toasts', async () => {
      await create();
      await highlightGreen();
      expect(undoBtn().disabled).toBe(false);
      key('z', { ctrlKey: true });
      await vi.waitFor(async () => expect(await live()).toHaveLength(0));
      expect(toast().current()?.message).toBe(CHROME_COPY.undid(CHROME_COPY.actions.highlight));
      expect(toast().current()?.actionLabel).toBe(CHROME_COPY.redo);
      fixture.detectChanges();
      expect(redoBtn().disabled).toBe(false);
      key('z', { ctrlKey: true, shiftKey: true });
      await vi.waitFor(async () => expect(await live()).toHaveLength(1));
      expect((await live())[0]).toMatchObject({ type: 'highlight', color: 'green' });
      expect(toast().current()?.message).toBe(CHROME_COPY.redid(CHROME_COPY.actions.highlight));
    });

    it('Ctrl+Y redoes too, and the toolbar buttons do the same as the keys', async () => {
      await create();
      await highlightGreen();
      undoBtn().click();
      await vi.waitFor(async () => expect(await live()).toHaveLength(0));
      key('y', { ctrlKey: true });
      await vi.waitFor(async () => expect(await live()).toHaveLength(1));
      key('z', { ctrlKey: true });
      await vi.waitFor(async () => expect(await live()).toHaveLength(0));
      fixture.detectChanges();
      redoBtn().click();
      await vi.waitFor(async () => expect(await live()).toHaveLength(1));
    });

    it("the toast's Redo button redoes", async () => {
      await create();
      await highlightGreen();
      key('z', { ctrlKey: true });
      await vi.waitFor(async () => expect(await live()).toHaveLength(0));
      toast().undo();
      await vi.waitFor(async () => expect(await live()).toHaveLength(1));
    });

    it('the highlight toast Undo goes through the stack: pressing Ctrl+Z afterwards undoes nothing twice', async () => {
      await create();
      await highlightGreen();
      toast().undo();
      await vi.waitFor(async () => expect(await live()).toHaveLength(0));
      fixture.detectChanges();
      expect(undoBtn().disabled).toBe(true);
      key('z', { ctrlKey: true });
      await new Promise((r) => setTimeout(r, 50));
      expect(await live()).toHaveLength(0);
      expect(toast().current()?.message).not.toBe(CHROME_COPY.undid(CHROME_COPY.actions.highlight));
    });

    it('Ctrl+Z first, then the old toast Undo, does nothing more', async () => {
      await create();
      await highlightGreen();
      const stale = toast().current()!;
      key('z', { ctrlKey: true });
      await vi.waitFor(async () => expect(await live()).toHaveLength(0));
      stale.undo!();
      await new Promise((r) => setTimeout(r, 50));
      expect(await live()).toHaveLength(0);
      expect((await db.annotations.toArray()).length).toBe(1);
    });

    it('undoing a highlight that merged two restores the originals; redo merges again', async () => {
      await create();
      const svc = TestBed.inject(AnnotationService);
      const text = (a: number, b: number) => ({ page: 7, start: { item: 0, offset: a }, end: { item: 0, offset: b }, rects: [], quote: 'x'.repeat(b - a) });
      const first = await svc.create({ bookId: 'book-1', type: 'highlight', page: 7, color: 'pink', tags: [], text: text(0, 3) });
      fixture.detectChanges();
      await highlightGreen();
      const merged = await live();
      expect(merged).toHaveLength(1);
      expect(merged[0].id).not.toBe(first.id);
      key('z', { ctrlKey: true });
      await vi.waitFor(async () => expect((await live()).map((r) => r.id)).toEqual([first.id]));
      key('z', { ctrlKey: true, shiftKey: true });
      await vi.waitFor(async () => expect((await live()).map((r) => r.id)).toEqual([merged[0].id]));
    });

    it('a new action clears what could be redone', async () => {
      await create();
      await highlightGreen();
      key('z', { ctrlKey: true });
      await vi.waitFor(async () => expect(await live()).toHaveLength(0));
      fixture.detectChanges();
      expect(redoBtn().disabled).toBe(false);
      key('b');
      await vi.waitFor(async () => expect(await live()).toHaveLength(1));
      fixture.detectChanges();
      expect(redoBtn().disabled).toBe(true);
    });

    it('toggling the bookmark twice leaves none, and Ctrl+Z puts it back', async () => {
      await create();
      key('b');
      await vi.waitFor(async () => expect(await live()).toHaveLength(1));
      fixture.detectChanges();
      key('b');
      await vi.waitFor(async () => expect(await live()).toHaveLength(0));
      fixture.detectChanges();
      expect(tool('bookmark')!.getAttribute('aria-pressed')).toBe('false');
      key('z', { ctrlKey: true });
      await vi.waitFor(async () => expect(await live()).toHaveLength(1));
      fixture.detectChanges();
      expect(tool('bookmark')!.getAttribute('aria-pressed')).toBe('true');
      key('z', { ctrlKey: true });
      await vi.waitFor(async () => expect(await live()).toHaveLength(0));
      fixture.detectChanges();
      expect(tool('bookmark')!.getAttribute('aria-pressed')).toBe('false');
    });

    it('a drawn area is undoable', async () => {
      await create();
      fakeSelection.pending.set(null);
      pager().areaDrawn.emit({ page: 7, rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 } });
      fixture.detectChanges();
      el.querySelector<HTMLButtonElement>(`iqra-selection-toolbar button[aria-label="${COPY.annotations.colors.blue}"]`)!.click();
      await vi.waitFor(async () => expect(await live()).toHaveLength(1));
      key('z', { ctrlKey: true });
      await vi.waitFor(async () => expect(await live()).toHaveLength(0));
      expect(toast().current()?.message).toBe(CHROME_COPY.undid(CHROME_COPY.actions.area));
    });

    it('marking a page read is undoable', async () => {
      await db.books.put(makeBook({ progressMode: 'marked' }));
      await create();
      key('m');
      await vi.waitFor(async () => expect((await db.readMarks.get('book-1:7'))?.read).toBe(true));
      key('z', { ctrlKey: true });
      await vi.waitFor(async () => expect((await db.readMarks.get('book-1:7'))?.read).toBe(false));
      key('y', { ctrlKey: true });
      await vi.waitFor(async () => expect((await db.readMarks.get('book-1:7'))?.read).toBe(true));
    });

    it('a colour change in the note sheet is one undoable step', async () => {
      await create();
      fakeSelection.pending.set(null);
      const rec = await TestBed.inject(AnnotationService).create({
        bookId: 'book-1', type: 'highlight', page: 7, color: 'pink', tags: [],
        text: { page: 7, start: { item: 0, offset: 0 }, end: { item: 0, offset: 5 }, rects: [], quote: 'Hello' },
      });
      pager().annotationTap.emit(rec);
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(el.querySelector('iqra-note-sheet .panel.open')).not.toBeNull();
      });
      el.querySelector<HTMLButtonElement>(`iqra-note-sheet button[aria-label="${COPY.annotations.colors.blue}"]`)!.click();
      await vi.waitFor(async () => expect((await db.annotations.get(rec.id))!.color).toBe('blue'));
      el.querySelector<HTMLButtonElement>('iqra-note-sheet button.close')!.click();
      fixture.detectChanges();
      key('z', { ctrlKey: true });
      await vi.waitFor(async () => expect((await db.annotations.get(rec.id))!.color).toBe('pink'));
      key('z', { ctrlKey: true, shiftKey: true });
      await vi.waitFor(async () => expect((await db.annotations.get(rec.id))!.color).toBe('blue'));
    });

    it('deleting a note from its sheet is undoable with Ctrl+Z', async () => {
      await create();
      fakeSelection.pending.set(null);
      const rec = await TestBed.inject(AnnotationService).create({
        bookId: 'book-1', type: 'highlight', page: 7, color: 'pink', tags: [],
        text: { page: 7, start: { item: 0, offset: 0 }, end: { item: 0, offset: 5 }, rects: [], quote: 'Hello' },
      });
      pager().annotationTap.emit(rec);
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(el.querySelector('iqra-note-sheet .panel.open')).not.toBeNull();
      });
      el.querySelector<HTMLButtonElement>('iqra-note-sheet button.del')!.click();
      await vi.waitFor(async () => expect(await live()).toHaveLength(0));
      fixture.detectChanges();
      key('z', { ctrlKey: true });
      await vi.waitFor(async () => expect(await live()).toHaveLength(1));
    });

    it('a note closed empty leaves nothing to undo', async () => {
      await create();
      fixture.detectChanges();
      el.querySelector<HTMLButtonElement>('iqra-selection-toolbar button.note')!.click();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(el.querySelector('iqra-note-sheet .panel.open')).not.toBeNull();
      });
      el.querySelector<HTMLButtonElement>('iqra-note-sheet button.close')!.click();
      await vi.waitFor(async () => expect(await live()).toHaveLength(0));
      fixture.detectChanges();
      expect(undoBtn().disabled).toBe(true);
    });

    it('the history belongs to one reader session', async () => {
      await create();
      await highlightGreen();
      fixture.destroy();
      await create();
      expect(undoBtn().disabled).toBe(true);
    });
  });

  describe('page actions menu', () => {
    const fakeSelection = {
      pending: signal<PendingSelection | null>(null),
      active: signal(false),
      attach: vi.fn(),
      clear: vi.fn(),
    };
    const live = async () => (await db.annotations.toArray()).filter((r) => !r.deleted);
    const menu = () => el.querySelector<HTMLElement>('iqra-context-menu [role=menu]');
    const items = () => Array.from(el.querySelectorAll<HTMLButtonElement>('iqra-context-menu [role=menuitem]'));
    const item = (action: string) => el.querySelector<HTMLButtonElement>(`iqra-context-menu [data-action="${action}"]`)!;
    const rightClick = (target: Element = el.querySelector('.stage')!, x = 200, y = 150) => {
      const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y });
      target.dispatchEvent(e);
      fixture.detectChanges();
      return e;
    };
    const opened = () =>
      vi.waitFor(() => {
        fixture.detectChanges();
        expect(menu()).not.toBeNull();
      });

    beforeEach(() => {
      fakeSelection.pending.set(null);
      TestBed.overrideComponent(ReaderPage, { set: { providers: [{ provide: SelectionService, useValue: fakeSelection }, UndoStack, ReaderActions] } });
    });

    it('right-click in the page area opens the menu at the pointer and stops the browser menu', async () => {
      await create();
      const e = rightClick();
      expect(e.defaultPrevented).toBe(true);
      await opened();
      expect(items().map((b) => b.dataset['action'])).toEqual(['sideNote', 'bookmark', 'mark', 'area', 'summary', 'goto', 'copyPage']);
      expect(item('sideNote').textContent).toContain('Add side note on p. 7');
      expect(el.querySelector('iqra-context-menu .dot')).toBeNull();
      expect(menu()!.style.left).toBe('200px');
    });

    it('right-click on the header or the toolbar keeps the browser menu', async () => {
      await create();
      expect(rightClick(el.querySelector('iqra-reader-header')!).defaultPrevented).toBe(false);
      expect(rightClick(el.querySelector('iqra-reader-toolbar')!).defaultPrevented).toBe(false);
      expect(menu()).toBeNull();
    });

    it('with a selection the menu adds the four colours, Note and Copy', async () => {
      fakeSelection.pending.set({
        page: 7, start: { item: 0, offset: 0 }, end: { item: 0, offset: 5 }, quote: 'Hello',
        rect: { left: 50, top: 100, right: 100, bottom: 120, width: 50, height: 20, x: 50, y: 100, toJSON: () => ({}) } as DOMRect,
        source: 'page',
      });
      await create();
      rightClick();
      await opened();
      expect(el.querySelectorAll('iqra-context-menu .dot')).toHaveLength(4);
      expect(items().map((b) => b.dataset['action']).filter(Boolean).slice(0, 2)).toEqual(['note', 'copySelection']);
      // The floating selection toolbar steps aside while the menu is open.
      expect(el.querySelector('iqra-selection-toolbar [role=toolbar]')).toBeNull();
      el.querySelector<HTMLButtonElement>(`iqra-context-menu button[aria-label="${COPY.annotations.colors.pink}"]`)!.click();
      await vi.waitFor(async () => expect(await live()).toHaveLength(1));
      expect((await live())[0]).toMatchObject({ type: 'highlight', color: 'pink' });
      fixture.detectChanges();
      expect(menu()).toBeNull();
    });

    it('Esc closes it and focus goes back where it was', async () => {
      await create();
      const opener = tool('search')!;
      opener.focus();
      rightClick();
      await opened();
      await vi.waitFor(() => expect(document.activeElement).toBe(menu()));
      menu()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      fixture.detectChanges();
      expect(menu()).toBeNull();
      expect(document.activeElement).toBe(opener);
    });

    it('a press elsewhere closes it', async () => {
      await create();
      rightClick();
      await opened();
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      fixture.detectChanges();
      expect(menu()).toBeNull();
    });

    it('Shift+F10 and the Menu key open it, arrows move, Enter activates', async () => {
      await create();
      key('F10', { shiftKey: true });
      await opened();
      await vi.waitFor(() => expect(document.activeElement).toBe(items()[0]));
      items()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      expect(document.activeElement).toBe(items()[1]);
      items()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
      items()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
      expect(document.activeElement).toBe(items().at(-1));
      items()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      fixture.detectChanges();
      expect(menu()).toBeNull();
      key('ContextMenu');
      await opened();
      item('bookmark').click();
      await vi.waitFor(async () => expect((await live()).filter((r) => r.type === 'bookmark')).toHaveLength(1));
      fixture.detectChanges();
      expect(menu()).toBeNull();
    });

    it('while the menu is open the reader shortcuts do not fire behind it', async () => {
      await create();
      rightClick();
      await opened();
      await vi.waitFor(() => expect(document.activeElement).toBe(menu()));
      menu()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 30));
      expect(await live()).toHaveLength(0);
    });

    it('Add side note creates a side note on this page and opens its editor', async () => {
      await create();
      rightClick();
      await opened();
      item('sideNote').click();
      await vi.waitFor(async () => expect((await live()).filter((r) => r.type === 'side-note' && r.page === 7)).toHaveLength(1));
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(el.querySelector('iqra-text-editor-sheet .panel.open')).not.toBeNull();
      });
    });

    it('Bookmark flips to Remove bookmark and Mark page is explained in last-page mode', async () => {
      await create();
      rightClick();
      await opened();
      expect(item('mark').getAttribute('aria-disabled')).toBe('true');
      item('mark').click();
      expect(TestBed.inject(ToastService).current()?.message).toBe(CHROME_COPY.markDisabled);
      key('b');
      await vi.waitFor(async () => expect(await live()).toHaveLength(1));
      fixture.detectChanges();
      rightClick();
      await opened();
      expect(item('bookmark').textContent).toContain(COPY.annotations.removeBookmark);
    });

    it('Area highlight, Go to page and Page-range summary run their actions', async () => {
      await create();
      rightClick();
      await opened();
      item('area').click();
      fixture.detectChanges();
      expect(tool('area')!.getAttribute('aria-pressed')).toBe('true');
      key('Escape');
      rightClick();
      await opened();
      item('goto').click();
      fixture.detectChanges();
      expect(el.querySelector('iqra-reader-header input[type=number]')).not.toBeNull();
      el.querySelector<HTMLInputElement>('iqra-reader-header input[type=number]')!.blur();
      fixture.detectChanges();
      rightClick();
      await opened();
      item('summary').click();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(el.querySelector('iqra-text-editor-sheet .panel.open')).not.toBeNull();
      });
    });

    it('Copy page text copies the page text and says so; a page without text says that', async () => {
      await create();
      const write = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true });
      session.pageText = async () => 'page words';
      rightClick();
      await opened();
      item('copyPage').click();
      await vi.waitFor(() => expect(write).toHaveBeenCalledWith('page words'));
      expect(TestBed.inject(ToastService).current()?.message).toBe(CHROME_COPY.pageTextCopied);
      session.pageText = async () => '  ';
      fixture.detectChanges();
      rightClick();
      await opened();
      item('copyPage').click();
      await vi.waitFor(() => expect(TestBed.inject(ToastService).current()?.message).toBe(CHROME_COPY.noPageText));
    });

    it('the Area tool cancels on right-click without opening the menu, on a second press and on Esc', async () => {
      await create();
      key('a');
      expect(tool('area')!.getAttribute('aria-pressed')).toBe('true');
      const e = rightClick();
      expect(e.defaultPrevented).toBe(true);
      expect(tool('area')!.getAttribute('aria-pressed')).toBe('false');
      expect(menu()).toBeNull();
      key('a');
      key('a');
      expect(tool('area')!.getAttribute('aria-pressed')).toBe('false');
      key('a');
      key('Escape');
      expect(tool('area')!.getAttribute('aria-pressed')).toBe('false');
    });

    it('a touch long-press on blank page area opens the menu; moving first cancels it', async () => {
      vi.useFakeTimers();
      try {
        await create();
      } finally {
        vi.useRealTimers();
      }
      vi.useFakeTimers();
      try {
        const stage = el.querySelector('.stage')!;
        const pt = (type: string, x: number, y: number) => {
          const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
          Object.defineProperties(e, { pointerType: { value: 'touch' }, pointerId: { value: 3 }, isPrimary: { value: true } });
          stage.dispatchEvent(e);
        };
        pt('pointerdown', 100, 100);
        pt('pointermove', 140, 100);
        vi.advanceTimersByTime(700);
        fixture.detectChanges();
        expect(menu()).toBeNull();
        pt('pointerdown', 100, 100);
        vi.advanceTimersByTime(700);
        fixture.detectChanges();
        expect(menu()).not.toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
