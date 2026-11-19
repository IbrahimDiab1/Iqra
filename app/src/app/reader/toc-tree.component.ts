import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, effect, inject, input, linkedSignal, output, untracked } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { findSummary } from '../annotations/summary-scope';
import type { Annotation, Book, OutlineNode, SummaryScope } from '../core/models';
import { chapterProgress, chaptersDone } from '../progress/progress';
import { ReadMarkService } from '../progress/read-mark.service';
import { COPY } from '../ui/copy';
import { icon } from '../ui/icons';
import { ToastService } from '../ui/toast.service';
import { CHROME_COPY } from './chrome-copy';
import type { Place } from './jump-history';
import { flattenOutline, nodeRange } from './outline';
import { PROGRESS_COPY } from './progress-copy';

const INDENT_PX = 14;
const RING_R = 6.5;
const RING_C = 2 * Math.PI * RING_R;

/** One outline node with its place in the tree. */
export interface TocEntry {
  node: OutlineNode;
  depth: number;
  /** The key of the parent node, null at the top level. */
  parent: string | null;
  hasChildren: boolean;
}

/** The outline in reading order with each node's parent. */
export function tocEntries(outline: OutlineNode[]): TocEntry[] {
  const parents: (string | null)[] = [];
  return flattenOutline(outline).map(({ node, depth }) => {
    parents.length = depth + 1;
    const parent = depth === 0 ? null : parents[depth - 1];
    parents[depth] = node.key;
    return { node, depth, parent, hasChildren: node.children.length > 0 };
  });
}

/** What is open before the reader has chosen: the top level, so its children show. */
export function defaultExpanded(entries: readonly TocEntry[]): Set<string> {
  return new Set(entries.filter((e) => e.depth === 0 && e.hasChildren).map((e) => e.node.key));
}

/** The keys of a node's ancestors, nearest last. */
export function ancestorKeys(entries: readonly TocEntry[], key: string): string[] {
  const parentOf = new Map(entries.map((e) => [e.node.key, e.parent]));
  const out: string[] = [];
  for (let p = parentOf.get(key) ?? null; p !== null; p = parentOf.get(p) ?? null) out.unshift(p);
  return out;
}

/** The rows whose ancestors are all open. */
export function visibleEntries(entries: readonly TocEntry[], open: ReadonlySet<string>): TocEntry[] {
  const shown = new Set<string>();
  const out: TocEntry[] = [];
  for (const e of entries) {
    if (e.parent === null || (shown.has(e.parent) && open.has(e.parent))) {
      shown.add(e.node.key);
      out.push(e);
    }
  }
  return out;
}

const storageKey = (bookId: string) => `iqra.toc.${bookId}`;

/** The keys this book had open earlier in the session, or null. A blocked or damaged store is no store. */
export function loadExpanded(bookId: string): Set<string> | null {
  try {
    const raw = sessionStorage.getItem(storageKey(bookId));
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((k): k is string => typeof k === 'string')) : null;
  } catch {
    return null;
  }
}

export function saveExpanded(bookId: string, open: ReadonlySet<string>): void {
  try {
    sessionStorage.setItem(storageKey(bookId), JSON.stringify([...open]));
  } catch {
    // Private windows and full stores simply forget.
  }
}

/** The collapsible Contents list: progress rings, summary badges and per-chapter marking. */
@Component({
  selector: 'iqra-toc-tree',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (entries().length === 0) {
      <p class="note">{{ copy.noContents }}</p>
    } @else {
      <div class="head">
        <p class="done-line">{{ prog.chaptersDone(chapters().done, chapters().total) }}</p>
        @if (branches()) {
          <button type="button" class="link" (click)="expandAll()">{{ toc.expandAll }}</button>
          <button type="button" class="link" (click)="collapseAll()">{{ toc.collapseAll }}</button>
        }
      </div>
      <ul class="list">
        @for (e of rows(); track e.node.key) {
          <li class="item">
            <div class="line" [class.current]="e.node.key === currentKey()" [style.padding-inline-start.px]="e.depth * indent" (keydown)="onKey($event, e)">
              @if (e.hasChildren) {
                <button
                  type="button"
                  class="chev"
                  [class.open]="e.isOpen"
                  [attr.aria-expanded]="e.isOpen"
                  [attr.aria-label]="e.isOpen ? toc.collapse(e.node.title) : toc.expand(e.node.title)"
                  (click)="toggle(e.node.key)"
                  [innerHTML]="chevron"
                ></button>
              } @else {
                <span class="chev-gap" aria-hidden="true"></span>
              }
              <button type="button" class="row" [class.current]="e.node.key === currentKey()" [attr.data-key]="e.node.key" [attr.title]="e.node.title" (click)="go(e.node.page)">
                <span class="title" dir="auto">{{ e.node.title }}</span>
                <span class="num">{{ e.node.page }}</span>
              </button>
              @if (markable()) {
                <button
                  type="button"
                  class="ring"
                  [class.done]="e.done"
                  [attr.aria-pressed]="e.done"
                  [attr.aria-label]="(e.done ? prog.unmarkChapter : prog.markChapter) + ' (' + prog.chapterRead(e.pct) + ')'"
                  (click)="markChapter(e)"
                >
                  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                    <circle cx="8" cy="8" r="6.5" class="track" />
                    @if (e.pct > 0) {
                      <circle cx="8" cy="8" r="6.5" class="arc" transform="rotate(-90 8 8)" [attr.stroke-dasharray]="e.dash" />
                    }
                    @if (e.done) {
                      <circle cx="8" cy="8" r="7.5" class="fill" />
                      <path d="M4.8 8.2l2.2 2.2 4.2-4.6" class="tick" />
                    }
                  </svg>
                </button>
              } @else {
                <span class="ring static" role="progressbar" aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="e.pct" [attr.aria-label]="prog.chapterRead(e.pct)">
                  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                    <circle cx="8" cy="8" r="6.5" class="track" />
                    @if (e.pct > 0) {
                      <circle cx="8" cy="8" r="6.5" class="arc" transform="rotate(-90 8 8)" [attr.stroke-dasharray]="e.dash" />
                    }
                  </svg>
                </span>
              }
              <button
                type="button"
                class="sum"
                [class.has]="e.has"
                [attr.aria-label]="e.has ? toc.summaryWritten : toc.addSummary"
                (click)="summary.emit(e.scope)"
                [innerHTML]="e.has ? noteFilled : notePlus"
              ></button>
            </div>
          </li>
        }
      </ul>
    }
  `,
  styles: `
    :host { display: block; }
    button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .note { margin: 12px 2px; color: var(--muted); font-size: 14px; }
    .head { display: flex; align-items: center; gap: 4px; margin: 4px 0 6px; }
    .done-line { flex: 1; margin: 0 2px; color: var(--muted); font-size: 13px; }
    .link { min-height: 32px; padding: 0 8px; border: 0; border-radius: 8px; background: none; color: var(--accent); font: 600 12.5px var(--ui); cursor: pointer; }
    .link:hover { background: var(--accent-soft); }
    .list { list-style: none; margin: 0; padding: 0; }
    .item { border-bottom: 1px solid var(--line); }
    .line { display: flex; align-items: center; min-width: 0; }
    .chev, .chev-gap { flex: none; width: 40px; height: 40px; }
    .chev { display: inline-grid; place-items: center; padding: 0; border: 0; border-radius: var(--radius-control); background: none; color: var(--muted); cursor: pointer; }
    .chev:hover { background: var(--surface-2); }
    .chev { transition: transform 150ms; }
    .chev.open { transform: rotate(90deg); }
    .row { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 6px 4px; border: 0; background: none; color: var(--fg); font: 15px var(--ui); text-align: start; cursor: pointer; }
    .row .title { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .row .num { flex: none; color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; }
    .row.current { color: var(--accent); font-weight: 600; }
    .ring { flex: none; display: inline-grid; place-items: center; width: 40px; height: 40px; padding: 0; border: 0; border-radius: var(--radius-control); background: none; cursor: pointer; }
    .ring.static { width: 28px; cursor: default; }
    button.ring:hover { background: var(--surface-2); }
    .ring svg { overflow: visible; }
    .ring .track { fill: none; stroke: var(--line); stroke-width: 2.4; }
    .ring .arc { fill: none; stroke: var(--accent); stroke-width: 2.4; stroke-linecap: round; }
    .ring .fill { fill: var(--accent); stroke: none; }
    .ring .tick { fill: none; stroke: var(--accent-fg); stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .sum { flex: none; display: inline-grid; place-items: center; width: 40px; height: 40px; padding: 0; border: 0; border-radius: var(--radius-control); background: none; color: var(--muted); cursor: pointer; opacity: 0; transition: opacity 120ms; }
    .sum.has { opacity: 1; color: var(--accent); }
    .line:hover .sum, .line:focus-within .sum, .sum:focus-visible { opacity: 0.6; }
    .line:hover .sum.has, .line:focus-within .sum.has { opacity: 1; }
    .sum:hover { background: var(--surface-2); opacity: 1; }
    @media (hover: none) { .sum { opacity: 0.55; } .sum.has { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .chev, .sum { transition: none; } }
  `,
})
export class TocTreeComponent {
  readonly book = input.required<Book>();
  readonly annotations = input<Annotation[]>([]);
  /** The pages marked read in this book (marked mode). */
  readonly marked = input<ReadonlySet<number>>(new Set());
  /** The page being read: its chapter's branch opens and scrolls into view. */
  readonly page = input(1);
  /** Whether the list is on screen; becoming active reveals the current chapter. */
  readonly active = input(true);
  readonly jump = output<Place>();
  /** Ask for the summary editor on this scope. */
  readonly summary = output<SummaryScope>();

  protected readonly copy = COPY.reader;
  protected readonly toc = CHROME_COPY;
  protected readonly prog = PROGRESS_COPY;
  protected readonly indent = INDENT_PX;
  private readonly sanitizer = inject(DomSanitizer);
  protected readonly chevron = this.sanitizer.bypassSecurityTrustHtml(icon('chevR', 18));
  protected readonly noteFilled = this.sanitizer.bypassSecurityTrustHtml(icon('noteFill', 20));
  protected readonly notePlus = this.sanitizer.bypassSecurityTrustHtml(icon('notePlus', 20));
  private readonly readMarks = inject(ReadMarkService);
  private readonly toast = inject(ToastService);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  private readonly tree = computed(() => tocEntries(this.book().outline));
  protected readonly entries = this.tree;
  protected readonly branches = computed(() => this.tree().some((e) => e.hasChildren));
  protected readonly markable = computed(() => this.book().progressMode === 'marked');
  protected readonly chapters = computed(() => chaptersDone(this.book(), this.marked()));

  private readonly bookId = computed(() => this.book().id);
  /** The open branches: what this session left for this book, else the top level. */
  private readonly open = linkedSignal<string, ReadonlySet<string>>({
    source: this.bookId,
    computation: (id) => loadExpanded(id) ?? defaultExpanded(untracked(() => this.tree())),
  });

  /** The entry with the greatest page not after the current one; later (deeper) entries win ties. */
  protected readonly currentKey = computed(() => {
    const page = this.page();
    let best: { key: string; page: number } | null = null;
    for (const { node } of this.tree()) {
      if (node.page <= page && (best === null || node.page >= best.page)) best = { key: node.key, page: node.page };
    }
    return best?.key ?? null;
  });

  protected readonly rows = computed(() => {
    const book = this.book();
    const open = this.open();
    const annotations = this.annotations();
    const marked = this.marked();
    return visibleEntries(this.tree(), open).map((e) => {
      const scope: SummaryScope = { kind: 'outline', nodeKey: e.node.key, title: e.node.title, ...nodeRange(book.outline, e.node.key, book.pageCount) };
      const { fraction, done } = chapterProgress(book, e.node, marked);
      return {
        ...e,
        scope,
        done,
        pct: Math.round(fraction * 100),
        dash: `${(fraction * RING_C).toFixed(2)} ${RING_C.toFixed(2)}`,
        has: !!findSummary(annotations, scope),
        isOpen: open.has(e.node.key),
      };
    });
  });

  constructor() {
    effect(() => {
      saveExpanded(this.bookId(), this.open());
    });
    effect(() => {
      if (this.active()) untracked(() => this.reveal());
    });
  }

  /** Opens the branch holding the current chapter and brings its row into view. */
  private reveal(): void {
    const key = this.currentKey();
    if (key === null) return;
    const missing = ancestorKeys(this.tree(), key).filter((k) => !this.open().has(k));
    if (missing.length > 0) this.open.update((o) => new Set([...o, ...missing]));
    afterNextRender(
      () => {
        const row = this.host.nativeElement.querySelector<HTMLElement>(`.row[data-key="${CSS.escape(key)}"]`);
        row?.scrollIntoView?.({ block: 'center' });
      },
      { injector: this.injector },
    );
  }

  protected toggle(key: string): void {
    this.open.update((o) => {
      const next = new Set(o);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  protected expandAll(): void {
    this.open.set(new Set(this.tree().filter((e) => e.hasChildren).map((e) => e.node.key)));
  }

  protected collapseAll(): void {
    this.open.set(new Set());
  }

  /** → opens a closed branch, ← closes an open one, * opens every branch. */
  protected onKey(e: KeyboardEvent, entry: TocEntry): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const isOpen = this.open().has(entry.node.key);
    if (e.key === '*') {
      this.expandAll();
    } else if (e.key === 'ArrowRight' && entry.hasChildren && !isOpen) {
      this.toggle(entry.node.key);
    } else if (e.key === 'ArrowLeft' && entry.hasChildren && isOpen) {
      this.toggle(entry.node.key);
    } else {
      return;
    }
    e.preventDefault();
  }

  protected go(page: number): void {
    this.jump.emit({ page, offset: 0 });
  }

  /** Marks every page of the chapter, or clears them when the whole chapter is already marked. */
  protected markChapter(e: { scope: SummaryScope; done: boolean }): void {
    if (e.scope.kind !== 'outline') return;
    const { fromPage, toPage } = e.scope;
    this.readMarks.setRange(this.book().id, fromPage, toPage, !e.done).catch((err) => {
      console.warn('Could not change the read marks', err);
      this.toast.show(COPY.annotations.saveFailed);
    });
  }
}
