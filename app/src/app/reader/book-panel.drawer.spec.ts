import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Annotation, Book, OutlineNode, SummaryScope } from '../core/models';
import { CLOCK } from '../core/clock';
import { DB, IqraDb } from '../core/db';
import { newId } from '../core/ids';
import { COPY } from '../ui/copy';
import { PROGRESS_COPY } from './progress-copy';
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

  describe('progress in Contents', () => {
    const bars = () => Array.from(el.querySelectorAll<HTMLElement>('.bar'));
    const fills = () => Array.from(el.querySelectorAll<HTMLElement>('.bar .fill'));
    const checks = () => Array.from(el.querySelectorAll<HTMLButtonElement>('button.chk'));
    const one: OutlineNode[] = [{ key: '0', title: 'All', page: 1, children: [] }];

    it('shows a chapter bar at 55.6 % when 5 of 9 pages are reached, labelled with the percentage', () => {
      create((h) => {
        h.book = { id: 'b1', pageCount: 9, outline: one, progressMode: 'last-page', lastPageReached: 5 } as unknown as Book;
      });
      expect(fills()[0].style.width).toBe('55.6%');
      expect(bars()[0].getAttribute('aria-label')).toBe(PROGRESS_COPY.chapterPct(56));
      expect(el.textContent).toContain(PROGRESS_COPY.chaptersDone(0, 1));
    });

    it('counts finished top-level chapters in the header line', () => {
      create((h) => {
        h.book = { id: 'b1', pageCount: 40, outline: OUTLINE, progressMode: 'last-page', lastPageReached: 25 } as unknown as Book;
      });
      expect(el.textContent).toContain(PROGRESS_COPY.chaptersDone(1, 2));
      expect(fills().map((f) => f.style.width)).toEqual(['100%', '28.6%', '6.3%']);
    });

    it('hides the chapters-done line when the book has no outline', () => {
      create((h) => {
        h.book = { id: 'b1', pageCount: 9, outline: [], progressMode: 'last-page', lastPageReached: 5 } as unknown as Book;
      });
      expect(el.textContent).not.toContain('chapters done');
      expect(bars()).toHaveLength(0);
    });

    it('never exceeds 100 % and shows 0 for a one-page book', () => {
      create((h) => {
        h.book = { id: 'b1', pageCount: 1, outline: one, progressMode: 'last-page', lastPageReached: 0 } as unknown as Book;
      });
      expect(fills()[0].style.width).toBe('0%');
      fixture.destroy();
      create((h) => {
        h.book = { id: 'b1', pageCount: 9, outline: one, progressMode: 'last-page', lastPageReached: 500 } as unknown as Book;
      });
      expect(fills()[0].style.width).toBe('100%');
    });

    it('has no check buttons in last-page mode', () => {
      create((h) => {
        h.book = { id: 'b1', pageCount: 9, outline: one, progressMode: 'last-page', lastPageReached: 5 } as unknown as Book;
      });
      expect(checks()).toHaveLength(0);
    });

    it('in marked mode the check button marks the chapter range and pressing again clears it', async () => {
      vi.useRealTimers();
      create((h) => {
        h.book = { id: 'b1', pageCount: 40, outline: OUTLINE, progressMode: 'marked', lastPageReached: 0 } as unknown as Book;
      });
      expect(checks()).toHaveLength(3);
      expect(checks()[0].getAttribute('aria-pressed')).toBe('false');
      checks()[0].click();
      await vi.waitFor(async () => {
        const marked = (await db.readMarks.toArray()).filter((m) => m.read).map((m) => m.page).sort((a, b) => a - b);
        expect(marked).toEqual(Array.from({ length: 19 }, (_, i) => i + 1));
      });
      host.marked.set(new Set(Array.from({ length: 19 }, (_, i) => i + 1)));
      fixture.detectChanges();
      expect(checks()[0].getAttribute('aria-pressed')).toBe('true');
      expect(fills()[0].style.width).toBe('100%');
      checks()[0].click();
      await vi.waitFor(async () => expect((await db.readMarks.toArray()).filter((m) => m.read)).toEqual([]));
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
