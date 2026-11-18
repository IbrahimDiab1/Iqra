import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOCK } from '../core/clock';
import { DB, IqraDb } from '../core/db';
import { newId } from '../core/ids';
import type { Book } from '../core/models';
import { DRIVE_ADAPTER } from '../sync/drive-adapter';
import { FakeDrive } from '../sync/fake-drive';
import { COPY } from '../ui/copy';
import { ToastService } from '../ui/toast.service';
import { signal } from '@angular/core';
import type { PendingSelection } from './selection.service';
import { SelectionService } from './selection.service';
import { PagerComponent } from './pager.component';
import { PageRenderer, PageSize, ReaderOpenError } from './pdf-session';
import { PositionService, type RestoredPosition } from './position.service';
import { PDF_OPENER, ReaderPage } from './reader.page';
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

  beforeEach(async () => {
    localStorage.clear();
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
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['bookId', 'book-1']]), queryParamMap: new Map() } } },
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
  const btn = (name: string) => el.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
  const pager = () => fixture.debugElement.query(By.directive(PagerComponent)).componentInstance as PagerComponent;

  it('opens at the restored page and shows it in the label', async () => {
    await create();
    expect(positions.restore).toHaveBeenCalled();
    expect(label()).toContain(COPY.reader.pageOf(7, 50));
    expect(el.querySelector('.chapter')!.textContent).toContain('Intro');
    expect(el.querySelector('iqra-pager')).not.toBeNull();
  });

  it('a jump enables Back and returns to the previous page; a page turn does not', async () => {
    await create();
    expect(btn(COPY.reader.jumpBack)).toBeNull();
    pager().pageChange.emit(8);
    fixture.detectChanges();
    expect(btn(COPY.reader.jumpBack)).toBeNull();

    const slider = el.querySelector<HTMLInputElement>('input[type=range]')!;
    slider.value = '30';
    slider.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(label()).toContain(COPY.reader.pageOf(30, 50));
    expect(btn(COPY.reader.jumpBack)!.disabled).toBe(false);
    expect(btn(COPY.reader.jumpForward)!.disabled).toBe(true);

    btn(COPY.reader.jumpBack)!.click();
    fixture.detectChanges();
    expect(label()).toContain(COPY.reader.pageOf(8, 50));
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
    expect(label()).toContain(COPY.reader.pageOf(7, 50));
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

  it('hidden bars are inert so the keyboard cannot reach them', async () => {
    await create();
    const bars = () => Array.from(el.querySelectorAll<HTMLElement>('.r-top, .r-bottom'));
    expect(bars().every((b) => !b.hasAttribute('inert'))).toBe(true);
    pager().tap.emit();
    fixture.detectChanges();
    expect(bars()).toHaveLength(2);
    expect(bars().every((b) => b.hasAttribute('inert'))).toBe(true);
  });

  it('opening marks the book opened and schedules no position', async () => {
    await create();
    expect(positions.markOpened).toHaveBeenCalledWith(expect.objectContaining({ id: 'book-1' }));
    expect(positions.schedule).not.toHaveBeenCalled();
  });

  it('an rtl book mirrors the bottom bar: left chevron is next, the slider runs right to left, the label stays logical', async () => {
    await db.books.put(makeBook({ direction: 'rtl' }));
    await create();
    expect(el.querySelector('.r-row')!.getAttribute('dir')).toBe('rtl');
    expect(el.querySelector('.r-range')!.getAttribute('dir')).toBe('rtl');
    expect(el.querySelector('.pg')!.getAttribute('dir')).toBe('ltr');
    // The "next" button shows the left-pointing chevron (path starts at x=15) and "previous" the right-pointing one.
    expect(btn(COPY.reader.nextPage)!.innerHTML).toContain('M15 18');
    expect(btn(COPY.reader.prevPage)!.innerHTML).toContain('M9 6');
    btn(COPY.reader.nextPage)!.click();
    fixture.detectChanges();
    expect(label()).toContain(COPY.reader.pageOf(8, 50));
  });

  it('an ltr book keeps the usual chevrons and no dir override', async () => {
    await create();
    expect(el.querySelector('.r-row')!.hasAttribute('dir')).toBe(false);
    expect(btn(COPY.reader.prevPage)!.innerHTML).toContain('M15 18');
  });

  it('reserves the bars space for content via --reader-top / --reader-bottom and releases it when hidden', async () => {
    await create();
    const root = el.querySelector<HTMLElement>('.reader')!;
    expect(root.style.getPropertyValue('--reader-top')).toMatch(/px$/);
    expect(root.style.getPropertyValue('--reader-bottom')).toMatch(/px$/);
    pager().tap.emit();
    fixture.detectChanges();
    expect(root.style.getPropertyValue('--reader-top')).toBe('0px');
    expect(root.style.getPropertyValue('--reader-bottom')).toBe('0px');
  });

  it('tapping the page toggles the immersive class', async () => {
    await create();
    const root = el.querySelector('.reader')!;
    expect(root.classList.contains('immersive')).toBe(false);
    pager().tap.emit();
    fixture.detectChanges();
    expect(root.classList.contains('immersive')).toBe(true);
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
    expect(label()).toContain(COPY.reader.pageOf(7, 50));
  });

  it('the Contents pill opens the sheet and an entry jumps', async () => {
    await create();
    Array.from(el.querySelectorAll<HTMLButtonElement>('.pill')).find((b) => b.textContent!.includes(COPY.reader.contents))!.click();
    fixture.detectChanges();
    el.querySelectorAll<HTMLButtonElement>('.row')[1].click();
    fixture.detectChanges();
    expect(label()).toContain(COPY.reader.pageOf(20, 50));
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
    expect(label()).toContain(COPY.reader.pageOf(7, 50));
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
      TestBed.overrideComponent(ReaderPage, { set: { providers: [{ provide: SelectionService, useValue: fakeSelection }] } });
    });

    const stored = () => db.annotations.toArray();

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
  });
});
