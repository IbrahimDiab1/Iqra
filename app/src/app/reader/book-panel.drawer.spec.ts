import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Annotation, Book, OutlineNode, SummaryScope } from '../core/models';
import { CLOCK } from '../core/clock';
import { DB, IqraDb } from '../core/db';
import { newId } from '../core/ids';
import { COPY } from '../ui/copy';
import { PROGRESS_COPY } from './progress-copy';
import { CHROME_COPY } from './chrome-copy';
import { BookPanelDrawerComponent } from './book-panel.drawer';
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
  imports: [BookPanelDrawerComponent],
  template: `<iqra-book-panel-drawer
    [open]="open()"
    [tab]="tab()"
    [book]="book"
    [renderer]="renderer"
    [page]="page()"
    [annotations]="annotations()"
    [marked]="marked()"
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
  marked = signal<ReadonlySet<number>>(new Set());
  scopes: SummaryScope[] = [];
  edits: Annotation[] = [];
  notes: Annotation[] = [];
  sideNotes: Annotation[] = [];
  flashes: string[] = [];
  book = { id: 'b1', pageCount: 40, outline: OUTLINE, progressMode: 'last-page', lastPageReached: 0 } as unknown as Book;
  renderer = renderer;
  closes = 0;
  jumps: Place[] = [];
}

describe('BookPanelDrawerComponent', () => {
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

  it('the Contents tab shows the collapsible tree, highlights the current chapter and jumps on a row, then closes', () => {
    create((h) => h.page.set(26));
    expect(el.querySelector('iqra-toc-tree')).not.toBeNull();
    expect(rows().map((r) => r.querySelector('.title')!.textContent)).toEqual(['Intro', 'Part Two', 'Nested']);
    expect(rows().map((r) => r.classList.contains('current'))).toEqual([false, false, true]);
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
    const card = () => el.querySelector<HTMLElement>('.book-sum')!;

    it('with no book summary the card is a dashed "Write a summary" button and every row offers Add summary', () => {
      create();
      expect(card().classList.contains('empty')).toBe(true);
      expect(card().tagName).toBe('BUTTON');
      expect(card().textContent!.trim()).toBe(CHROME_COPY.writeSummary);
      expect(el.querySelector('.bs-edit')).toBeNull();
      expect(sumButtons().map((b) => b.getAttribute('aria-label'))).toEqual(Array(3).fill(CHROME_COPY.addSummary));
      expect(el.textContent).not.toContain('+ Summary');
    });

    it('with a book summary the card shows its text and an Edit button; rows with a summary are filled', () => {
      create((h) => h.annotations.set([SUM('a', { kind: 'book' }, 'My whole book'), SUM('b', { kind: 'outline', nodeKey: '1', title: 'Part Two', fromPage: 20, toPage: 40 })]));
      expect(card().classList.contains('empty')).toBe(false);
      expect(card().textContent).toContain(COPY.annotations.bookSummary);
      expect(card().querySelector('.preview')!.textContent).toContain('My whole book');
      expect(card().querySelector('.bs-edit')!.textContent!.trim()).toBe(COPY.annotations.edit);
      expect(sumButtons().map((b) => b.classList.contains('has'))).toEqual([false, true, false]);
    });

    it('the card and the badges ask for the book scope and the node scope with its page range, then close', () => {
      create();
      card().click();
      expect(host.scopes[0]).toEqual({ kind: 'book' });
      expect(host.closes).toBe(1);
      host.open.set(true);
      fixture.detectChanges();
      sumButtons()[1].click();
      expect(host.scopes[1]).toEqual({ kind: 'outline', nodeKey: '1', title: 'Part Two', fromPage: 20, toPage: 40 });
      expect(host.closes).toBe(2);
    });

    it('Edit on a written book summary opens the editor on the book scope', () => {
      create((h) => h.annotations.set([SUM('a', { kind: 'book' }, 'My whole book')]));
      card().querySelector<HTMLButtonElement>('.bs-edit')!.click();
      expect(host.scopes).toEqual([{ kind: 'book' }]);
    });
  });

  it('the tab row is sticky at the top of the scrolling body', () => {
    create();
    const row = el.querySelector<HTMLElement>('[role=tablist]')!;
    const css = getComputedStyle(row);
    expect(css.position).toBe('sticky');
    expect(css.top).toBe('0px');
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

  describe('Notes and Bookmarks tabs in the shell', () => {
    it('the Notes tab renders its content and an action closes the panel', () => {
      const a: Annotation = { id: 'h', bookId: 'b1', type: 'bookmark', page: 3, tags: [], createdAt: 1, updatedAt: 1, deviceId: 'd' };
      create((h) => {
        h.tab.set('notes');
        h.annotations.set([a]);
      });
      expect(el.querySelector('iqra-notes-tab')).not.toBeNull();
      Array.from(el.querySelectorAll<HTMLButtonElement>('.act'))[1].click();
      expect(host.scopes).toEqual([{ kind: 'pages', fromPage: 1, toPage: 1 }]);
      expect(host.closes).toBe(1);
    });

    it('the Bookmarks tab jumps and closes the panel; the Notes filter survives a tab switch', () => {
      const a: Annotation = { id: 'm3', bookId: 'b1', type: 'bookmark', page: 3, tags: [], createdAt: 1, updatedAt: 1, deviceId: 'd' };
      create((h) => {
        h.tab.set('notes');
        h.annotations.set([a]);
      });
      const chips = () => Array.from(el.querySelectorAll<HTMLButtonElement>('.chip'));
      chips()[2].click();
      fixture.detectChanges();
      const tabs = Array.from(el.querySelectorAll<HTMLButtonElement>('[role=tab]'));
      tabs[2].click();
      fixture.detectChanges();
      el.querySelector<HTMLButtonElement>('.row.bm')!.click();
      expect(host.jumps).toEqual([{ page: 3, offset: 0 }]);
      expect(host.closes).toBe(1);
      tabs[1].click();
      fixture.detectChanges();
      expect(chips()[2].getAttribute('aria-pressed')).toBe('true');
    });
  });

  it('passes the marks and progress mode to the tree: marked mode shows the chapter ring toggles', () => {
    create((h) => {
      h.book = { id: 'b1', pageCount: 40, outline: OUTLINE, progressMode: 'marked', lastPageReached: 0 } as unknown as Book;
      h.marked.set(new Set(Array.from({ length: 19 }, (_, i) => i + 1)));
    });
    const rings = Array.from(el.querySelectorAll<HTMLButtonElement>('button.ring'));
    expect(rings).toHaveLength(3);
    expect(rings.map((r) => r.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
    expect(el.textContent).toContain(PROGRESS_COPY.chaptersDone(1, 2));
  });

  it('tells the tab strip about a tab picked by hand', () => {
    create();
    const picked: string[] = [];
    fixture.debugElement.children[0].componentInstance.tabChange.subscribe((t: string) => picked.push(t));
    el.querySelectorAll<HTMLElement>('[role=tab]')[2].click();
    expect(picked).toEqual(['bookmarks']);
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
