import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { findSummary } from '../annotations/summary-scope';
import type { Annotation, Book, SummaryScope } from '../core/models';
import { COPY } from '../ui/copy';
import { SheetComponent } from '../ui/sheet.component';
import type { Place } from './jump-history';
import { BookmarksTabComponent } from './bookmarks-tab.component';
import { flattenOutline, nodeRange } from './outline';
import { NotesTabComponent, type NotesFilter } from './notes-tab.component';
import type { PageRenderer } from './pdf-session';
import { SearchService, type SearchHit } from './search.service';

export type PanelTab = 'contents' | 'notes' | 'bookmarks' | 'search';
type Filter = NotesFilter;

const DEBOUNCE_MS = 300;
const INDENT_PX = 16;
const MIN_QUERY = 2;

@Component({
  selector: 'iqra-book-panel-sheet',
  imports: [SheetComponent, NotesTabComponent, BookmarksTabComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <f-sheet [open]="open()" [title]="titles[tab()]" [tall]="true" (closed)="close()">
      <div class="tabs" role="tablist">
        @for (t of tabs; track t.id) {
          <button type="button" role="tab" [attr.aria-selected]="tab() === t.id" [class.on]="tab() === t.id" (click)="tab.set(t.id)">{{ t.label }}</button>
        }
      </div>

      @if (tab() === 'contents') {
        <div class="book-sum">
          <div class="bs-head">
            <span class="bs-title">{{ ann.bookSummary }}</span>
            <button type="button" class="sum" (click)="summarize(bookScope)">{{ bookSummary() ? ann.summary : ann.addSummary }}</button>
          </div>
          @if (bookSummary()?.body; as text) {
            <p class="preview" dir="auto">{{ text }}</p>
          }
        </div>
        @if (entries().length === 0) {
          <p class="note">{{ copy.noContents }}</p>
        } @else {
          <ul class="list">
            @for (e of entries(); track e.node.key) {
              <li class="item">
                <button type="button" class="row" [class.current]="e.node.key === currentKey()" [style.padding-inline-start.px]="e.depth * indent" (click)="go(e.node.page)">
                  <span class="title" dir="auto">{{ e.node.title }}</span>
                  <span class="num">{{ e.node.page }}</span>
                </button>
                <button type="button" class="sum" (click)="summarize(e.scope)">{{ e.has ? ann.summary : ann.addSummary }}</button>
              </li>
            }
          </ul>
        }
      } @else if (tab() === 'notes') {
        <iqra-notes-tab
          [book]="book()"
          [page]="page()"
          [annotations]="annotations()"
          [filter]="filter()"
          (filterChange)="filter.set($event)"
          (jump)="jump.emit($event)"
          (summary)="summary.emit($event)"
          (edit)="edit.emit($event)"
          (note)="note.emit($event)"
          (sideNote)="sideNote.emit($event)"
          (flash)="flash.emit($event)"
          (done)="close()"
        />
      } @else if (tab() === 'bookmarks') {
        <iqra-bookmarks-tab [book]="book()" [annotations]="annotations()" (jump)="jump.emit($event)" (done)="close()" />
      } @else {
        <input
          #field
          id="bp-search"
          class="field"
          type="search"
          dir="auto"
          [placeholder]="copy.searchPlaceholder"
          [attr.aria-label]="copy.searchPlaceholder"
          [value]="query()"
          (input)="onInput($event)"
        />
        @if (query().trim().length < minQuery) {
          <p class="note">{{ copy.searchHint }}</p>
        } @else {
          @if (running()) {
            <p class="note" role="status">{{ copy.searching(progress().done, progress().total) }}</p>
          } @else if (hits().length === 0 && searched()) {
            <p class="note">{{ copy.noResults }}</p>
          } @else if (searched()) {
            <p class="note" role="status">{{ copy.results(hits().length, capped()) }}</p>
          }
          <ul class="list">
            @for (h of hits(); track $index) {
              <li>
                <button type="button" class="hit" (click)="go(h.page)">
                  <span class="pnum">p. {{ h.page }}</span>
                  <span class="snip" dir="auto">{{ h.before }} <mark>{{ h.match }}</mark> {{ h.after }}</span>
                </button>
              </li>
            }
          </ul>
        }
      }
    </f-sheet>
  `,
  styles: `
    .tabs { display: flex; gap: 4px; padding: 3px; margin-bottom: 10px; border-radius: var(--radius-control); background: var(--surface-2); }
    .tabs button { flex: 1; min-height: 40px; border: 0; border-radius: 10px; background: none; color: var(--muted); font: 600 14px var(--ui); cursor: pointer; }
    .tabs button.on { background: var(--surface); color: var(--fg); box-shadow: 0 1px 2px rgb(0 0 0 / 0.12); }
    button:focus-visible, .field:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .note { margin: 12px 2px; color: var(--muted); font-size: 14px; }
    .list { list-style: none; margin: 0; padding: 0; }
    .row, .hit { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 44px; padding-block: 6px; padding-inline-end: 6px; border: 0; border-bottom: 1px solid var(--line); background: none; color: var(--fg); font: 15px var(--ui); text-align: start; cursor: pointer; }
    .row .title { flex: 1; min-width: 0; }
    .row .num, .pnum { flex: none; color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; }
    .item { display: flex; align-items: center; border-bottom: 1px solid var(--line); }
    .item .row { flex: 1; min-width: 0; border-bottom: 0; }
    .sum { flex: none; min-height: 40px; padding: 0 10px; border: 0; background: none; color: var(--accent); font: 600 13px var(--ui); cursor: pointer; }
    .book-sum { margin-bottom: 8px; padding: 6px 4px 6px 12px; border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--surface-2); }
    .bs-head { display: flex; align-items: center; gap: 8px; }
    .bs-title { flex: 1; font-weight: 600; font-size: 15px; }
    .preview { margin: 0 8px 8px 0; font-size: 14px; line-height: 1.45; color: var(--muted); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    .row.current { color: var(--accent); font-weight: 600; }
    .hit { align-items: flex-start; flex-direction: column; gap: 2px; }
    .snip { font-size: 14px; line-height: 1.45; }
    mark { background: var(--hl-yellow); color: inherit; border-radius: 2px; }
    .field { box-sizing: border-box; width: 100%; min-height: 44px; padding: 0 12px; border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--surface); color: var(--fg); font: 16px var(--ui); }
  `,
})
export class BookPanelSheetComponent implements OnDestroy {
  readonly open = input(false);
  /** The tab to show whenever this input changes. */
  readonly initialTab = input<PanelTab>('contents', { alias: 'tab' });
  readonly book = input.required<Book>();
  readonly renderer = input.required<PageRenderer>();
  readonly page = input<number>(1);
  /** This book's live annotations. */
  readonly annotations = input<Annotation[]>([]);
  readonly closed = output<void>();
  readonly jump = output<Place>();
  /** The panel asks for the summary editor on this scope (existing or new). */
  readonly summary = output<SummaryScope>();
  /** Open the editor for an existing side note or summary. */
  readonly edit = output<Annotation>();
  /** Open the note sheet for a highlight, note or area. */
  readonly note = output<Annotation>();
  /** A side note the panel just created; the editor opens on it. */
  readonly sideNote = output<Annotation>();
  /** Flash this annotation once its page is showing. */
  readonly flash = output<string>();

  protected readonly copy = COPY.reader;
  protected readonly ann = COPY.annotations;
  protected readonly tabs: { id: PanelTab; label: string }[] = [
    { id: 'contents', label: COPY.reader.contents },
    { id: 'notes', label: COPY.reader.notes },
    { id: 'bookmarks', label: COPY.reader.bookmarks },
    { id: 'search', label: COPY.reader.search },
  ];
  protected readonly titles: Record<PanelTab, string> = {
    contents: COPY.reader.contents, notes: COPY.reader.notes, bookmarks: COPY.reader.bookmarks, search: COPY.reader.search,
  };
  protected readonly filter = signal<Filter>('all');
  protected readonly bookScope: SummaryScope = { kind: 'book' };
  protected readonly indent = INDENT_PX;
  protected readonly minQuery = MIN_QUERY;
  protected readonly tab = linkedSignal<PanelTab>(() => this.initialTab());

  protected readonly bookSummary = computed(() => findSummary(this.annotations(), this.bookScope));
  protected readonly entries = computed(() => {
    const { outline, pageCount } = this.book();
    return flattenOutline(outline).map((e) => {
      const scope: SummaryScope = { kind: 'outline', nodeKey: e.node.key, title: e.node.title, ...nodeRange(outline, e.node.key, pageCount) };
      return { ...e, scope, has: !!findSummary(this.annotations(), scope) };
    });
  });
  /** The entry with the greatest page not after the current one; later (deeper) entries win ties. */
  protected readonly currentKey = computed(() => {
    const page = this.page();
    let best: { key: string; page: number } | null = null;
    for (const { node } of this.entries()) {
      if (node.page <= page && (best === null || node.page >= best.page)) best = { key: node.key, page: node.page };
    }
    return best?.key ?? null;
  });

  protected readonly query = signal('');
  protected readonly hits = signal<SearchHit[]>([]);
  protected readonly progress = signal({ done: 0, total: 0 });
  protected readonly running = signal(false);
  protected readonly searched = signal(false);
  protected readonly capped = signal(false);

  private readonly searchService = inject(SearchService);
  private readonly injector = inject(Injector);
  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private abort: AbortController | undefined;

  constructor() {
    // Every open starts on the requested tab, whatever tab the last visit ended on.
    effect(() => {
      if (this.open()) untracked(() => this.tab.set(this.initialTab()));
    });
    // Opening on the Search tab puts the cursor in the field.
    effect(() => {
      if (this.open() && this.tab() === 'search') {
        const field = this.field();
        untracked(() => setTimeout(() => field?.nativeElement.focus(), 50));
      }
    });
  }

  ngOnDestroy(): void {
    clearTimeout(this.debounce);
    this.abort?.abort();
  }

  protected close(): void {
    clearTimeout(this.debounce);
    this.abort?.abort();
    this.running.set(false);
    this.closed.emit();
  }

  protected go(page: number): void {
    this.jump.emit({ page, offset: 0 });
    this.close();
  }

  protected summarize(scope: SummaryScope): void {
    this.summary.emit(scope);
    this.close();
  }

  protected onInput(e: Event): void {
    const value = (e.target as HTMLInputElement).value;
    this.query.set(value);
    clearTimeout(this.debounce);
    this.abort?.abort();
    this.abort = undefined;
    this.running.set(false);
    this.searched.set(false);
    this.hits.set([]);
    if (value.trim().length < MIN_QUERY) return;
    this.debounce = setTimeout(() => void this.run(value), DEBOUNCE_MS);
  }

  private async run(query: string): Promise<void> {
    const ctl = new AbortController();
    this.abort = ctl;
    const renderer = this.renderer();
    this.hits.set([]);
    this.capped.set(false);
    this.searched.set(false);
    this.progress.set({ done: 0, total: renderer.numPages });
    this.running.set(true);
    const found: SearchHit[] = [];
    try {
      const { capped } = await this.searchService.search(renderer, query, {
        signal: ctl.signal,
        onProgress: (done, total) => {
          if (!ctl.signal.aborted) this.progress.set({ done, total });
        },
        onHit: (h) => {
          if (ctl.signal.aborted) return;
          found.push(h);
          this.hits.set(found.slice());
        },
      });
      if (ctl.signal.aborted) return;
      this.capped.set(capped);
      this.searched.set(true);
    } catch (err) {
      if (!ctl.signal.aborted) console.warn('Search failed', err);
    } finally {
      if (this.abort === ctl) this.running.set(false);
    }
  }
}
