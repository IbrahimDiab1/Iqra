import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOCK } from '../core/clock';
import { DB, IqraDb } from '../core/db';
import { newId } from '../core/ids';
import type { Annotation, Book, OutlineNode, SummaryScope } from '../core/models';
import { CHROME_COPY } from './chrome-copy';
import type { Place } from './jump-history';
import { PROGRESS_COPY } from './progress-copy';
import { TocTreeComponent, ancestorKeys, defaultExpanded, loadExpanded, tocEntries, visibleEntries } from './toc-tree.component';

const node = (key: string, title: string, page: number, children: OutlineNode[] = []): OutlineNode => ({ key, title, page, children });
const OUTLINE: OutlineNode[] = [
  node('a', 'Alpha', 1, [node('a1', 'Alpha One', 3, [node('a1a', 'Deep', 4)]), node('a2', 'Alpha Two', 6)]),
  node('b', 'كتاب', 10),
  node('c', 'Gamma', 15, [node('c1', 'Gamma One', 16)]),
];
const keys = (list: readonly { node: OutlineNode }[]) => list.map((e) => e.node.key);

describe('toc helpers', () => {
  const entries = tocEntries(OUTLINE);

  it('tocEntries records depth, parent and whether a node has children', () => {
    expect(entries.map((e) => [e.node.key, e.depth, e.parent, e.hasChildren])).toEqual([
      ['a', 0, null, true],
      ['a1', 1, 'a', true],
      ['a1a', 2, 'a1', false],
      ['a2', 1, 'a', false],
      ['b', 0, null, false],
      ['c', 0, null, true],
      ['c1', 1, 'c', false],
    ]);
  });

  it('opens the top level one level by default', () => {
    expect([...defaultExpanded(entries)].sort()).toEqual(['a', 'c']);
    expect(keys(visibleEntries(entries, defaultExpanded(entries)))).toEqual(['a', 'a1', 'a2', 'b', 'c', 'c1']);
  });

  it('a closed ancestor hides every descendant, however deep', () => {
    expect(keys(visibleEntries(entries, new Set()))).toEqual(['a', 'b', 'c']);
    expect(keys(visibleEntries(entries, new Set(['a1'])))).toEqual(['a', 'b', 'c']);
    expect(keys(visibleEntries(entries, new Set(['a', 'a1'])))).toEqual(['a', 'a1', 'a1a', 'a2', 'b', 'c']);
  });

  it('ancestorKeys lists the chain from the top', () => {
    expect(ancestorKeys(entries, 'a1a')).toEqual(['a', 'a1']);
    expect(ancestorKeys(entries, 'b')).toEqual([]);
  });
});

@Component({
  imports: [TocTreeComponent],
  template: `<iqra-toc-tree
    [book]="book()"
    [annotations]="annotations()"
    [marked]="marked()"
    [page]="page()"
    [active]="active()"
    (jump)="jumps.push($event)"
    (summary)="scopes.push($event)"
  />`,
})
class HostComponent {
  book = signal<Book>(makeBook());
  annotations = signal<Annotation[]>([]);
  marked = signal<ReadonlySet<number>>(new Set());
  page = signal(1);
  active = signal(true);
  jumps: Place[] = [];
  scopes: SummaryScope[] = [];
}

function makeBook(over: Partial<Book> = {}): Book {
  return { id: 'b1', pageCount: 20, outline: OUTLINE, progressMode: 'last-page', lastPageReached: 0, ...over } as unknown as Book;
}

const SUM = (scope: SummaryScope): Annotation => ({
  id: newId(), bookId: 'b1', type: 'summary', scope, body: 'text', tags: [], createdAt: 1, updatedAt: 1, deviceId: 'd',
});

describe('TocTreeComponent', () => {
  let db: IqraDb;
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let el: HTMLElement;
  let scrollTo: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sessionStorage.clear();
    db = new IqraDb(`iqra-test-${newId()}`);
    scrollTo = vi.fn();
    Element.prototype.scrollIntoView = scrollTo as unknown as typeof Element.prototype.scrollIntoView;
    TestBed.configureTestingModule({ providers: [{ provide: DB, useValue: db }, { provide: CLOCK, useValue: { now: () => 5000 } }] });
  });

  afterEach(async () => {
    fixture?.destroy();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    await db.delete();
  });

  function create(setup?: (h: HostComponent) => void) {
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    setup?.(host);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  }
  const update = (fn: () => void) => {
    fn();
    fixture.detectChanges();
  };
  const rows = () => Array.from(el.querySelectorAll<HTMLButtonElement>('.row'));
  const shown = () => rows().map((r) => r.getAttribute('data-key'));
  const chevron = (key: string) => el.querySelector<HTMLButtonElement>(`.row[data-key="${key}"]`)!.closest('.line')!.querySelector<HTMLButtonElement>('.chev');
  const lineOf = (key: string) => el.querySelector<HTMLElement>(`.row[data-key="${key}"]`)!.closest<HTMLElement>('.line')!;
  const key = (k: string, key2: string, init: KeyboardEventInit = {}) => {
    const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
    el.querySelector(`.row[data-key="${key2}"]`)!.dispatchEvent(e);
    fixture.detectChanges();
    return e;
  };

  it('lists the outline indented, truncating titles with the full title as a tooltip, titles dir=auto', () => {
    create();
    expect(shown()).toEqual(['a', 'a1', 'a2', 'b', 'c', 'c1']);
    expect(['a', 'a1', 'b'].map((k) => lineOf(k).style.paddingInlineStart)).toEqual(['0px', '14px', '0px']);
    const arabic = el.querySelector('.row[data-key="b"]')!;
    expect(arabic.querySelector('.title')!.getAttribute('dir')).toBe('auto');
    expect(arabic.getAttribute('title')).toBe('كتاب');
    expect(arabic.querySelector('.num')!.textContent).toBe('10');
  });

  it('a row jumps to its page', () => {
    create();
    el.querySelector<HTMLButtonElement>('.row[data-key="a2"]')!.click();
    expect(host.jumps).toEqual([{ page: 6, offset: 0 }]);
  });

  it('only nodes with children get a chevron, with aria-expanded and a name', () => {
    create();
    expect(chevron('b')).toBeNull();
    expect(chevron('a2')).toBeNull();
    expect(chevron('a')!.getAttribute('aria-expanded')).toBe('true');
    expect(chevron('a')!.getAttribute('aria-label')).toBe(CHROME_COPY.collapse('Alpha'));
    expect(chevron('a1')!.getAttribute('aria-expanded')).toBe('false');
    expect(chevron('a1')!.getAttribute('aria-label')).toBe(CHROME_COPY.expand('Alpha One'));
  });

  it('collapsing a branch hides its descendants and expanding brings them back', () => {
    create();
    chevron('a1')!.click();
    fixture.detectChanges();
    expect(shown()).toEqual(['a', 'a1', 'a1a', 'a2', 'b', 'c', 'c1']);
    chevron('a')!.click();
    fixture.detectChanges();
    expect(shown()).toEqual(['a', 'b', 'c', 'c1']);
    chevron('a')!.click();
    fixture.detectChanges();
    expect(shown()).toEqual(['a', 'a1', 'a1a', 'a2', 'b', 'c', 'c1']);
  });

  it('Expand all and Collapse all', () => {
    create();
    const buttons = () => Array.from(el.querySelectorAll<HTMLButtonElement>('.head .link'));
    expect(buttons().map((b) => b.textContent!.trim())).toEqual([CHROME_COPY.expandAll, CHROME_COPY.collapseAll]);
    buttons()[0].click();
    fixture.detectChanges();
    expect(shown()).toEqual(['a', 'a1', 'a1a', 'a2', 'b', 'c', 'c1']);
    buttons()[1].click();
    fixture.detectChanges();
    expect(shown()).toEqual(['a', 'b', 'c']);
  });

  it('a flat outline has no Expand all or Collapse all', () => {
    create((h) => h.book.set(makeBook({ outline: [node('x', 'One', 1), node('y', 'Two', 5)] })));
    expect(el.querySelector('.head .link')).toBeNull();
    expect(el.querySelector('.chev')).toBeNull();
  });

  it('the current chapter\'s branch is opened and its row scrolled into view when the list becomes active', () => {
    create((h) => {
      h.page.set(4);
      h.active.set(false);
    });
    sessionStorage.clear();
    expect(shown()).not.toContain('a1a');
    update(() => host.active.set(true));
    expect(shown()).toContain('a1a');
    expect(el.querySelector('.row[data-key="a1a"]')!.classList.contains('current')).toBe(true);
    expect(el.querySelector('.row[data-key="a1"]')!.classList.contains('current')).toBe(false);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo.mock.contexts[0]).toBe(el.querySelector('.row[data-key="a1a"]'));

    // Closed again by hand, it reopens the next time the list is shown.
    chevron('a1')!.click();
    fixture.detectChanges();
    expect(shown()).not.toContain('a1a');
    update(() => host.active.set(false));
    update(() => host.active.set(true));
    expect(shown()).toContain('a1a');
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it('opens the current chapter at creation too', () => {
    create((h) => h.page.set(16));
    expect(shown()).toContain('c1');
    expect(el.querySelector('.row[data-key="c1"]')!.classList.contains('current')).toBe(true);
  });

  describe('keyboard', () => {
    it('→ opens a closed branch, ← closes an open one, and a leaf ignores both', () => {
      create();
      expect(key('ArrowRight', 'a1').defaultPrevented).toBe(true);
      expect(shown()).toContain('a1a');
      expect(key('ArrowRight', 'a1').defaultPrevented).toBe(false);
      expect(key('ArrowLeft', 'a1').defaultPrevented).toBe(true);
      expect(shown()).not.toContain('a1a');
      expect(key('ArrowLeft', 'a1').defaultPrevented).toBe(false);
      expect(key('ArrowRight', 'b').defaultPrevented).toBe(false);
      expect(key('ArrowLeft', 'b').defaultPrevented).toBe(false);
    });

    it('* opens every branch', () => {
      create();
      key('*', 'b');
      expect(shown()).toContain('a1a');
    });

    it('keeps browser shortcuts: Ctrl+→ does nothing here', () => {
      create();
      expect(key('ArrowRight', 'a1', { ctrlKey: true }).defaultPrevented).toBe(false);
      expect(shown()).not.toContain('a1a');
    });
  });

  describe('remembering what is open', () => {
    it('keeps the choice per book in sessionStorage and restores it', () => {
      create();
      chevron('a')!.click();
      fixture.detectChanges();
      TestBed.flushEffects?.();
      fixture.detectChanges();
      expect(loadExpanded('b1')).toEqual(new Set(['c']));
      expect(loadExpanded('other')).toBeNull();
      fixture.destroy();
      create();
      expect(shown()).toEqual(['a', 'b', 'c', 'c1']);
    });

    it('works when storage throws', () => {
      const blocked = () => {
        throw new Error('blocked');
      };
      vi.stubGlobal('sessionStorage', { getItem: blocked, setItem: blocked });
      create();
      expect(shown()).toEqual(['a', 'a1', 'a2', 'b', 'c', 'c1']);
      chevron('a')!.click();
      fixture.detectChanges();
      expect(shown()).toEqual(['a', 'b', 'c', 'c1']);
    });

    it('ignores a damaged stored value', () => {
      sessionStorage.setItem('iqra.toc.b1', '{not json');
      create();
      expect(shown()).toEqual(['a', 'a1', 'a2', 'b', 'c', 'c1']);
      fixture.destroy();
      sessionStorage.setItem('iqra.toc.b1', '{"a":1}');
      create();
      expect(shown()).toEqual(['a', 'a1', 'a2', 'b', 'c', 'c1']);
    });
  });

  describe('summary badges', () => {
    const sums = () => Array.from(el.querySelectorAll<HTMLButtonElement>('.sum'));
    const rangeOf = (key: string): SummaryScope => {
      const ranges: Record<string, [number, number]> = { a: [1, 9], a1: [3, 5], a1a: [4, 5], a2: [6, 9], b: [10, 14], c: [15, 20], c1: [16, 20] };
      const title = { a: 'Alpha', a1: 'Alpha One', a2: 'Alpha Two', b: 'كتاب', c: 'Gamma', c1: 'Gamma One', a1a: 'Deep' }[key]!;
      return { kind: 'outline', nodeKey: key, title, fromPage: ranges[key][0], toPage: ranges[key][1] };
    };

    it('an outlined add badge for rows with no summary, a filled one for chapters and sections that have one', () => {
      create((h) => h.annotations.set([SUM(rangeOf('a')), SUM(rangeOf('a2'))]));
      const byKey = (k: string) => lineOf(k).querySelector<HTMLButtonElement>('.sum')!;
      expect(byKey('a').classList.contains('has')).toBe(true);
      expect(byKey('a').getAttribute('aria-label')).toBe(CHROME_COPY.summaryWritten);
      expect(byKey('a2').classList.contains('has')).toBe(true);
      expect(byKey('a1').classList.contains('has')).toBe(false);
      expect(byKey('a1').getAttribute('aria-label')).toBe(CHROME_COPY.addSummary);
      expect(byKey('b').getAttribute('aria-label')).toBe(CHROME_COPY.addSummary);
      expect(byKey('a').querySelector('svg')).not.toBeNull();
    });

    it('carries no text, so there is no "Summary" or "+ Summary" word on any row', () => {
      create((h) => h.annotations.set([SUM(rangeOf('a'))]));
      for (const s of sums()) expect(s.textContent!.trim()).toBe('');
      expect(el.textContent).not.toMatch(/Summary|\+ Summary/);
    });

    it('a badge asks for the summary editor on the node scope with its page range', () => {
      create();
      lineOf('a1').querySelector<HTMLButtonElement>('.sum')!.click();
      lineOf('c').querySelector<HTMLButtonElement>('.sum')!.click();
      expect(host.scopes).toEqual([rangeOf('a1'), rangeOf('c')]);
    });
  });

  describe('progress ring', () => {
    const ring = (k: string) => lineOf(k).querySelector<HTMLElement>('.ring')!;
    const lastPage = (n: number) => makeBook({ lastPageReached: n });

    it('last-page mode: a non-interactive progress indicator labelled with the percentage', () => {
      create((h) => h.book.set(lastPage(5)));
      // Alpha One covers pages 3-5: 3 of 3 pages are reached; Alpha Two (6-9) none; Alpha 1-9: 5 of 9.
      expect(ring('a').tagName).toBe('SPAN');
      expect(ring('a').getAttribute('role')).toBe('progressbar');
      expect(ring('a').getAttribute('aria-valuenow')).toBe('56');
      expect(ring('a').getAttribute('aria-label')).toBe(PROGRESS_COPY.chapterRead(56));
      expect(ring('a1').getAttribute('aria-label')).toBe(PROGRESS_COPY.chapterRead(100));
      expect(ring('a2').getAttribute('aria-label')).toBe(PROGRESS_COPY.chapterRead(0));
      expect(el.querySelectorAll('button.ring')).toHaveLength(0);
      ring('a').click();
      expect(host.jumps).toEqual([]);
    });

    it('the arc grows with the share read', () => {
      create((h) => h.book.set(lastPage(5)));
      const dash = (k: string) => parseFloat(ring(k).querySelector('.arc')!.getAttribute('stroke-dasharray')!);
      // Nothing read draws no arc at all, rather than a dot.
      expect(ring('a2').querySelector('.arc')).toBeNull();
      expect(dash('a')).toBeGreaterThan(0);
      expect(dash('a1')).toBeGreaterThan(dash('a'));
    });

    it('counts finished top-level chapters in the header line', () => {
      create((h) => h.book.set(lastPage(14)));
      expect(el.querySelector('.done-line')!.textContent).toBe(PROGRESS_COPY.chaptersDone(2, 3));
    });

    it('marked mode: the ring is a pressed toggle that marks the whole chapter range, then clears it', async () => {
      create((h) => h.book.set(makeBook({ progressMode: 'marked' })));
      expect(ring('a1').tagName).toBe('BUTTON');
      expect(ring('a1').getAttribute('aria-pressed')).toBe('false');
      expect(ring('a1').getAttribute('aria-label')).toBe(`${PROGRESS_COPY.markChapter} (${PROGRESS_COPY.chapterRead(0)})`);
      expect(ring('a1').querySelector('.tick')).toBeNull();
      ring('a1').click();
      await vi.waitFor(async () => {
        const marked = (await db.readMarks.toArray()).filter((m) => m.read).map((m) => m.page).sort((a, b) => a - b);
        expect(marked).toEqual([3, 4, 5]);
      });
      update(() => host.marked.set(new Set([3, 4, 5])));
      expect(ring('a1').getAttribute('aria-pressed')).toBe('true');
      expect(ring('a1').querySelector('.tick')).not.toBeNull();
      expect(ring('a1').getAttribute('aria-label')).toBe(`${PROGRESS_COPY.unmarkChapter} (${PROGRESS_COPY.chapterRead(100)})`);
      expect(ring('a').getAttribute('aria-pressed')).toBe('false');
      ring('a1').click();
      await vi.waitFor(async () => expect((await db.readMarks.toArray()).filter((m) => m.read)).toEqual([]));
      expect(host.jumps).toEqual([]);
    });

    it('marking a chapter that is partly marked completes it', async () => {
      create((h) => {
        h.book.set(makeBook({ progressMode: 'marked' }));
        h.marked.set(new Set([6]));
      });
      expect(ring('a2').getAttribute('aria-pressed')).toBe('false');
      ring('a2').click();
      await vi.waitFor(async () => {
        const marked = (await db.readMarks.toArray()).filter((m) => m.read).map((m) => m.page).sort((a, b) => a - b);
        expect(marked).toEqual([6, 7, 8, 9]);
      });
    });
  });

  it('shows the empty message when there is no outline, and no header line', () => {
    create((h) => h.book.set(makeBook({ outline: [] })));
    expect(el.textContent).toContain('This PDF has no chapters');
    expect(el.querySelector('.done-line')).toBeNull();
    expect(rows()).toHaveLength(0);
  });
});
