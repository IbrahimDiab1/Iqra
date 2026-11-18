import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Book, OutlineNode } from '../core/models';
import { COPY } from '../ui/copy';
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
    (closed)="closes = closes + 1"
    (jump)="jumps.push($event)"
  />`,
})
class HostComponent {
  open = signal(true);
  tab = signal<'contents' | 'search'>('contents');
  page = signal(1);
  book = { outline: OUTLINE } as Book;
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

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

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
    create((h) => (h.book = { outline: [] } as unknown as Book));
    expect(rows()).toHaveLength(0);
    expect(el.textContent).toContain(COPY.reader.noContents);
  });

  it('has two tabs, switching with a click', () => {
    create();
    const tabs = Array.from(el.querySelectorAll<HTMLElement>('[role=tab]'));
    expect(tabs.map((t) => t.textContent!.trim())).toEqual([COPY.reader.contents, COPY.reader.search]);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    tabs[1].click();
    fixture.detectChanges();
    expect(el.querySelector('input[type=search]')).not.toBeNull();
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
