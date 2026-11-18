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
import type { Book } from '../core/models';
import { COPY } from '../ui/copy';
import { SheetComponent } from '../ui/sheet.component';
import type { Place } from './jump-history';
import { flattenOutline } from './outline';
import type { PageRenderer } from './pdf-session';
import { SearchService, type SearchHit } from './search.service';

const DEBOUNCE_MS = 300;
const INDENT_PX = 16;
const MIN_QUERY = 2;

@Component({
  selector: 'iqra-book-panel-sheet',
  imports: [SheetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <f-sheet [open]="open()" [title]="tab() === 'contents' ? copy.contents : copy.search" [tall]="true" (closed)="close()">
      <div class="tabs" role="tablist">
        <button type="button" role="tab" [attr.aria-selected]="tab() === 'contents'" [class.on]="tab() === 'contents'" (click)="tab.set('contents')">{{ copy.contents }}</button>
        <button type="button" role="tab" [attr.aria-selected]="tab() === 'search'" [class.on]="tab() === 'search'" (click)="tab.set('search')">{{ copy.search }}</button>
      </div>

      @if (tab() === 'contents') {
        @if (entries().length === 0) {
          <p class="note">{{ copy.noContents }}</p>
        } @else {
          <ul class="list">
            @for (e of entries(); track e.node.key) {
              <li>
                <button type="button" class="row" [class.current]="e.node.key === currentKey()" [style.padding-inline-start.px]="e.depth * indent" (click)="go(e.node.page)">
                  <span class="title" dir="auto">{{ e.node.title }}</span>
                  <span class="num">{{ e.node.page }}</span>
                </button>
              </li>
            }
          </ul>
        }
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
  readonly initialTab = input<'contents' | 'search'>('contents', { alias: 'tab' });
  readonly book = input.required<Book>();
  readonly renderer = input.required<PageRenderer>();
  readonly page = input<number>(1);
  readonly closed = output<void>();
  readonly jump = output<Place>();

  protected readonly copy = COPY.reader;
  protected readonly indent = INDENT_PX;
  protected readonly minQuery = MIN_QUERY;
  protected readonly tab = linkedSignal<'contents' | 'search'>(() => this.initialTab());

  protected readonly entries = computed(() => flattenOutline(this.book().outline));
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
