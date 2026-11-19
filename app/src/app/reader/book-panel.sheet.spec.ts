import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Annotation, Book, OutlineNode, SummaryScope } from '../core/models';
import { AnnotationService } from '../annotations/annotation.service';
import { CLOCK } from '../core/clock';
import { DB, IqraDb } from '../core/db';
import { newId } from '../core/ids';
import { COPY } from '../ui/copy';
import { ToastService } from '../ui/toast.service';
import { BookPanelSheetComponent } from './book-panel.sheet';
import type { Place } from './jump-history';
import type { PageRenderer } from './pdf-session';
import { SearchService } from './search.service';

const OUTLINE: OutlineNode[] = [
  { key: '0', title: 'Intro', page: 1, children: [] },
  {
    key: '1',
    title: 'Part Two',
    page: 20,
    children: [{ key: '1.0', title: 'Nested', page: 25, children: [] }],
  },
];

const PAGES = ['The origin of species', 'nothing', '', 'Species and origin'];
const renderer = {
  numPages: 4,
  pageText: async (p: number) => PAGES[p - 1],
} as unknown as PageRenderer;

@Component({
  imports: [BookPanelSheetComponent],
  template: `<iqra-book-panel-sheet
    [open]="open()"
    [tab]="tab()"
    [book]="book"
    [renderer]="renderer"
    [page]="page()"
    [annotations]="annotations()"
    (summary)="scopes.push($event)"
    (edit)="edits.push($event)"
    (note)="notes.push($event)"
    (sideNote)="sideNotes.push($event)"
    (flash)="flashes.push($event)"
    (closed)="closes = closes + 1"
    (jump)="jumps.push($event)"
  />`,
})
class HostComponent {
  open = signal(true);
  tab = signal<'contents' | 'notes' | 'bookmarks' | 'search'>('contents');
  page = signal(1);
  annotations = signal<Annotation[]>([]);
  scopes: SummaryScope[] = [];
  edits: Annotation[] = [];
  notes: Annotation[] = [];
  sideNotes: Annotation[] = [];
  flashes: string[] = [];
  book = { id: 'b1', pageCount: 40, outline: OUTLINE } as Book;
  renderer = renderer;
  closes = 0;
  jumps: Place[] = [];
}

describe('BookPanelSheetComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let el: HTMLElement;

  function create(setup?: (h: HostComponent) => void) {
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    setup?.(host);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  }

  const rows = () => Array.from(el.querySelectorAll<HTMLButtonElement>('.row'));

  let db: IqraDb;
  beforeEach(() => {
    vi.useFakeTimers();
    db = new IqraDb(`iqra-test-${newId()}`);
    TestBed.configureTestingModule({
      providers: [{ provide: DB, useValue: db }, { provide: CLOCK, useValue: { now: () => 5000 } }],
    });
  });
  afterEach(async () => {
    vi.useRealTimers();
    fixture?.destroy();
    await db.delete();
  });

  it('lists the outline indented and highlights the current chapter', () => {
    create((h) => h.page.set(26));
    expect(rows().map((r) => r.querySelector('.title')!.textContent)).toEqual(['Intro', 'Part Two', 'Nested']);
    expect(rows().map((r) => r.style.paddingInlineStart)).toEqual(['0px', '0px', '16px']);
    expect(rows().map((r) => r.classList.contains('current'))).toEqual([false, false, true]);
    expect(rows()[1].querySelector('.num')!.textContent).toBe('20');
    expect(rows()[0].querySelector('.title')!.getAttribute('dir')).toBe('auto');
  });

  it('tapping an entry jumps to its page and closes', () => {
    create();
    rows()[1].click();
    expect(host.jumps).toEqual([{ page: 20, offset: 0 }]);
    expect(host.closes).toBe(1);
  });

  it('shows the empty message when there is no outline', () => {
    create((h) => (h.book = { id: 'b1', pageCount: 40, outline: [] } as unknown as Book));
    expect(rows()).toHaveLength(0);
    expect(el.textContent).toContain(COPY.reader.noContents);
    expect(COPY.reader.noContents).toContain('summarize a page range');
  });

  describe('summaries in Contents', () => {
    const SUM = (id: string, scope: SummaryScope, body = 'text'): Annotation => ({
      id, bookId: 'b1', type: 'summary', scope, body, tags: [], createdAt: 1, updatedAt: 1, deviceId: 'd',
    });
    const sumButtons = () => Array.from(el.querySelectorAll<HTMLButtonElement>('.sum'));

    it('shows a book summary card on top and + Summary on every row', () => {
      create();
      expect(el.querySelector('.book-sum')!.textContent).toContain(COPY.annotations.bookSummary);
      expect(sumButtons().map((b) => b.textContent!.trim())).toEqual(Array(4).fill(COPY.annotations.addSummary));
    });

    it('a row with a summary shows Summary and its text preview on the card', () => {
      create((h) => h.annotations.set([SUM('a', { kind: 'book' }, 'My whole book'), SUM('b', { kind: 'outline', nodeKey: '1', title: 'Part Two', fromPage: 20, toPage: 40 })]));
      const labels = sumButtons().map((b) => b.textContent!.trim());
      expect(labels[0]).toBe(COPY.annotations.summary);
      expect(labels.slice(1)).toEqual([COPY.annotations.addSummary, COPY.annotations.summary, COPY.annotations.addSummary]);
      expect(el.querySelector('.book-sum .preview')!.textContent).toContain('My whole book');
    });

    it('the buttons ask for the book scope and the node scope with its page range, then close', () => {
      create();
      sumButtons()[0].click();
      expect(host.scopes[0]).toEqual({ kind: 'book' });
      expect(host.closes).toBe(1);
      host.open.set(true);
      fixture.detectChanges();
      sumButtons()[2].click();
      expect(host.scopes[1]).toEqual({ kind: 'outline', nodeKey: '1', title: 'Part Two', fromPage: 20, toPage: 40 });
    });
  });

  it('has four tabs, switching with a click', () => {
    create();
    const tabs = Array.from(el.querySelectorAll<HTMLElement>('[role=tab]'));
    expect(tabs.map((t) => t.textContent!.trim())).toEqual([COPY.reader.contents, COPY.reader.notes, COPY.reader.bookmarks, COPY.reader.search]);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    tabs[3].click();
    fixture.detectChanges();
    expect(el.querySelector('input[type=search]')).not.toBeNull();
  });

  it('reopens on the requested tab after being closed on another', () => {
    create();
    el.querySelectorAll<HTMLElement>('[role=tab]')[3].click();
    fixture.detectChanges();
    expect(el.querySelector('input[type=search]')).not.toBeNull();
    host.open.set(false);
    fixture.detectChanges();
    host.open.set(true);
    fixture.detectChanges();
    expect(el.querySelector('input[type=search]')).toBeNull();
    expect(el.querySelector('.row')).not.toBeNull();
  });

  describe('Notes tab', () => {
    const rect = (y: number) => ({ x: 0.1, y, w: 0.5, h: 0.02 });
    const hl = (id: string, page: number, quote: string, y = 0.4): Annotation => ({
      id, bookId: 'b1', type: 'highlight', page, color: 'yellow', tags: ['t1'], createdAt: page, updatedAt: 1, deviceId: 'd',
      text: { page, start: { item: 0, offset: 0 }, end: { item: 0, offset: 3 }, rects: [rect(y)], quote },
    });
    const side = (id: string, page: number, body: string): Annotation => ({
      id, bookId: 'b1', type: 'side-note', page, body, tags: [], createdAt: page, updatedAt: 1, deviceId: 'd',
    });
    const sum = (id: string, body: string): Annotation => ({
      id, bookId: 'b1', type: 'summary', scope: { kind: 'book' }, body, tags: [], createdAt: 1, updatedAt: 1, deviceId: 'd',
    });
    const group = (id: string) => Array.from(el.querySelectorAll<HTMLElement>(`[data-group="${id}"] .prev`)).map((n) => n.textContent!.trim());
    const chip = (name: string) => Array.from(el.querySelectorAll<HTMLButtonElement>('.chip')).find((c) => c.textContent!.trim() === name)!;

    function notesTab(anns: Annotation[], page = 2) {
      create((h) => {
        h.tab.set('notes');
        h.page.set(page);
        h.annotations.set(anns);
      });
    }

    it('groups notes into On this page and Rest of the book, in page order', () => {
      notesTab([hl('h9', 9, 'ninth'), hl('h2', 2, 'second'), side('s5', 5, 'five')]);
      expect(group('here')).toEqual(['second']);
      expect(group('rest')).toEqual(['five', 'ninth']);
      expect(Array.from(el.querySelectorAll('.group')).map((g) => g.textContent)).toEqual([COPY.annotations.onThisPage, COPY.annotations.restOfBook]);
      expect(el.querySelector('[data-group=here] .prev')!.getAttribute('dir')).toBe('auto');
      expect(el.querySelector('[data-group=here] .tag')!.textContent).toBe('t1');
      expect(el.querySelector('[data-group=here] .num')!.textContent).toBe('p. 2');
    });

    it('lists the book summary first in the rest, before page 5', () => {
      notesTab([side('s5', 5, 'five'), sum('b', 'whole')], 1);
      expect(group('rest')).toEqual(['whole', 'five']);
    });

    it('the Summaries chip hides highlights; All brings them back', () => {
      notesTab([hl('h2', 2, 'second'), sum('b', 'whole')]);
      chip(COPY.annotations.filters.summaries).click();
      fixture.detectChanges();
      expect([...group('here'), ...group('rest')]).toEqual(['whole']);
      expect(chip(COPY.annotations.filters.summaries).getAttribute('aria-pressed')).toBe('true');
      chip(COPY.annotations.filters.all).click();
      fixture.detectChanges();
      expect([...group('here'), ...group('rest')]).toEqual(['second', 'whole']);
    });

    it('the Notes chip covers notes and side notes', () => {
      notesTab([hl('h2', 2, 'second'), side('s5', 5, 'five')]);
      chip(COPY.annotations.filters.notes).click();
      fixture.detectChanges();
      expect([...group('here'), ...group('rest')]).toEqual(['five']);
    });

    it('shows the empty state', () => {
      notesTab([]);
      expect(el.textContent).toContain(COPY.annotations.noNotes);
    });

    it('tapping a highlight row jumps just above it and asks for a flash', () => {
      notesTab([hl('h9', 9, 'ninth', 0.4), hl('h8', 8, 'eighth', 0.02)]);
      const rows = Array.from(el.querySelectorAll<HTMLButtonElement>('.nrow'));
      rows[1].click();
      expect(host.jumps).toEqual([{ page: 9, offset: 0.4 - 0.05 }]);
      expect(host.flashes).toEqual(['h9']);
      expect(host.closes).toBe(1);
      rows[0].click();
      expect(host.jumps[1].page).toBe(8);
      expect(host.jumps[1].offset).toBe(0);
    });

    it('tapping a side note or summary row opens the editor; the pencil opens the note sheet', () => {
      notesTab([hl('h2', 2, 'second'), side('s5', 5, 'five'), sum('b', 'whole')]);
      const rows = Array.from(el.querySelectorAll<HTMLButtonElement>('.nrow'));
      rows[1].click(); // book summary sorts first in the rest group
      rows[2].click();
      expect(host.edits.map((a) => a.id)).toEqual(['b', 's5']);
      expect(host.jumps).toEqual([]);
      const pencils = Array.from(el.querySelectorAll<HTMLButtonElement>('button.tool'));
      expect(pencils).toHaveLength(1);
      pencils[0].click();
      expect(host.notes.map((a) => a.id)).toEqual(['h2']);
    });

    it('the side-note action creates one on the current page and hands it over', async () => {
      notesTab([], 4);
      vi.useRealTimers();
      const btn = Array.from(el.querySelectorAll<HTMLButtonElement>('.act')).find((b) => b.textContent!.trim() === COPY.annotations.sideNoteOn(4))!;
      btn.click();
      await vi.waitFor(() => expect(host.sideNotes).toHaveLength(1));
      expect(host.sideNotes[0]).toMatchObject({ type: 'side-note', page: 4, bookId: 'b1' });
      expect((await db.annotations.toArray()).filter((a) => a.type === 'side-note')).toHaveLength(1);
    });

    it('the page-range action creates nothing and asks for a pages scope on this page', async () => {
      notesTab([], 6);
      Array.from(el.querySelectorAll<HTMLButtonElement>('.act')).find((b) => b.textContent!.trim() === COPY.annotations.pageRangeSummary)!.click();
      expect(host.scopes).toEqual([{ kind: 'pages', fromPage: 6, toPage: 6 }]);
      vi.useRealTimers();
      expect(await db.annotations.count()).toBe(0);
    });
  });

  describe('Bookmarks tab', () => {
    const mark = (id: string, page: number): Annotation => ({
      id, bookId: 'b1', type: 'bookmark', page, tags: [], createdAt: page, updatedAt: 1, deviceId: 'd',
    });

    it('lists bookmarks by page with the chapter title; tapping jumps', () => {
      create((h) => {
        h.tab.set('bookmarks');
        h.annotations.set([mark('m30', 30), mark('m3', 3), mark('m0', 0)]);
      });
      const rows = Array.from(el.querySelectorAll<HTMLButtonElement>('.row.bm'));
      expect(rows.map((r) => [r.querySelector('.num')!.textContent, r.querySelector('.title')!.textContent])).toEqual([['p. 0', ''], ['p. 3', 'Intro'], ['p. 30', 'Nested']]);
      rows[1].click();
      expect(host.jumps).toEqual([{ page: 3, offset: 0 }]);
    });

    it('shows the empty state', () => {
      create((h) => h.tab.set('bookmarks'));
      expect(el.textContent).toContain(COPY.annotations.noBookmarks);
    });

    it('the trash button removes with an Undo toast; Undo brings it back', async () => {
      vi.useRealTimers();
      const rec = await TestBed.inject(AnnotationService).create({ bookId: 'b1', type: 'bookmark', page: 3 });
      create((h) => {
        h.tab.set('bookmarks');
        h.annotations.set([rec]);
      });
      el.querySelector<HTMLButtonElement>('button.tool')!.click();
      await vi.waitFor(async () => expect((await db.annotations.get(rec.id))?.deleted).toBe(true));
      const toast = TestBed.inject(ToastService);
      expect(toast.current()?.message).toBe(COPY.annotations.deleted);
      toast.undo();
      await vi.waitFor(async () => expect((await db.annotations.get(rec.id))?.deleted).toBeFalsy());
    });
  });

  it('closing within the debounce window cancels the pending search', async () => {
    const search = vi.fn(() => new Promise(() => undefined));
    TestBed.overrideProvider(SearchService, { useValue: { search } });
    create((h) => h.tab.set('search'));
    const input = el.querySelector<HTMLInputElement>('input[type=search]')!;
    input.value = 'species';
    input.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(100);
    el.querySelector<HTMLButtonElement>('.close')!.click();
    await vi.advanceTimersByTimeAsync(500);
    expect(search).not.toHaveBeenCalled();
  });

  async function type(value: string) {
    const input = el.querySelector<HTMLInputElement>('input[type=search]')!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(300);
    fixture.detectChanges();
  }

  it('searches after the debounce and shows highlighted hits', async () => {
    create((h) => h.tab.set('search'));
    expect(el.textContent).toContain(COPY.reader.searchHint);
    await type('species');
    await vi.advanceTimersByTimeAsync(10);
    fixture.detectChanges();
    const hits = Array.from(el.querySelectorAll<HTMLButtonElement>('.hit'));
    expect(hits).toHaveLength(2);
    expect(hits[0].querySelector('mark')!.textContent!.toLowerCase()).toBe('species');
    expect(hits[0].textContent).toContain('p. 1');
    expect(el.textContent).toContain(COPY.reader.results(2, false));
    hits[1].click();
    expect(host.jumps).toEqual([{ page: 4, offset: 0 }]);
    expect(host.closes).toBe(1);
  });

  it('shows no-results text', async () => {
    create((h) => h.tab.set('search'));
    await type('zzzz');
    await vi.advanceTimersByTimeAsync(10);
    fixture.detectChanges();
    expect(el.textContent).toContain(COPY.reader.noResults);
  });

  it('a new query aborts the previous search', async () => {
    const signals: AbortSignal[] = [];
    TestBed.overrideProvider(SearchService, {
      useValue: {
        search: (_r: unknown, _q: string, o: { signal: AbortSignal }) => {
          signals.push(o.signal);
          return new Promise(() => undefined);
        },
      },
    });
    create((h) => h.tab.set('search'));
    await type('abc');
    await type('abcd');
    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    expect(el.textContent).toContain(COPY.reader.searching(0, 4));
  });
});
