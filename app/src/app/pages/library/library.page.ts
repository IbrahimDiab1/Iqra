import {
  Component,
  ElementRef,
  HostListener,
  DestroyRef,
  Injector,
  ViewContainerRef,
  afterEveryRender,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { CatalogService } from '../../books/catalog.service';
import { FilesService } from '../../books/files.service';
import { ImportService } from '../../books/import/import.service';
import {
  activeFilterCount,
  bookProgress,
  categoryCounts,
  recentBooks,
  queryLibrary,
  tabCounts,
  UNCATEGORIZED,
  type LibraryCtx,
  type LibraryState,
  type LibraryTab,
  type SortKey,
} from '../../books/library/library-query';
import { UploadQueue } from '../../books/upload-queue';
import { FAKE_DRIVE } from '../../../environments/environment';
import { introDue } from '../../onboarding/intro-due';
import { openIntro } from '../../onboarding/open-intro';
import { DB } from '../../core/db';
import type { Book, ID } from '../../core/models';
import { Repo } from '../../core/repo';
import { COPY } from '../../ui/copy';
import { icon, type IconName } from '../../ui/icons';
import type { CategoryBarComponent } from '../../books/library/category-bar.component';
import { BookCardComponent, type BookView } from './book-card.component';
import { FilterSheetComponent } from './filter-sheet.component';
import { DEFAULT_DIR, loadLibraryState, saveLibraryState, sortHasDirection, type FilterValue } from './library-state';
import { SortMenuComponent } from './sort-menu.component';
import { UpNextComponent } from './up-next.component';

const TABS: readonly LibraryTab[] = ['all', 'reading', 'to-read', 'finished'];
const RECENT_LIMIT = 5;

/** The palette slot (1 to 8) of a category, the same rule Stats uses (its `order` modulo eight), so colours match. */
const categoryHue = (order: number): number => (((Math.trunc(order) % 8) + 8) % 8) + 1;

type BarComponentType = typeof import('../../books/library/category-bar.component').CategoryBarComponent;

/** An active filter shown as a chip above the grid. */
interface FilterChip {
  key: string;
  label: string;
  remove: () => void;
}

/**
 * Puts a new visible order back into the full Up next list. Books not in `nextVisible` (filtered
 * out or on another tab) keep their slots.
 */
function mergeOrder(full: readonly ID[], nextVisible: readonly ID[]): ID[] {
  const visible = new Set(nextVisible);
  const queue = [...nextVisible];
  return full.map((id) => (visible.has(id) ? (queue.shift() ?? id) : id));
}

function hasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files');
}

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

/** The library: status tabs, filters, sort, the continue card, Up next and the grid. */
@Component({
  selector: 'f-library-page',
  imports: [
    BookCardComponent,
    FilterSheetComponent,
    SortMenuComponent,
    UpNextComponent,
  ],
  template: `
    <section class="page">
      <!-- The greeting and Continue reading row load on demand (see mountTop), so their code stays out of the initial bundle. -->
      <div class="top-slot"><ng-container #topHost /></div>

      <section class="card">
      <div class="lib-head">
        <h2 class="sec-h">{{ copy.section }}</h2>
        <div class="actions">
          <button
            type="button"
            class="icon-btn"
            [attr.aria-label]="copy.search"
            [attr.aria-pressed]="searchOpen()"
            (click)="toggleSearch()"
            [innerHTML]="searchIcon"
          ></button>
          <button type="button" class="add" (click)="pickFiles()">
            <span [innerHTML]="uploadIcon"></span>{{ copy.add }}
          </button>
          <input #fileInput type="file" accept="application/pdf" multiple hidden (change)="onPicked($event)" />
        </div>
      </div>

      @if (searchOpen()) {
        <label class="search">
          <span [innerHTML]="searchIcon"></span>
          <input
            #searchInput
            type="search"
            autocomplete="off"
            [attr.placeholder]="copy.searchPlaceholder"
            [value]="state().query"
            (input)="onSearchInput($event)"
          />
        </label>
      }

      <div class="seg" role="tablist" [attr.aria-label]="copy.title">
        @for (tab of tabs; track tab; let i = $index) {
          <button
            type="button"
            role="tab"
            class="seg-tab"
            [attr.aria-selected]="state().tab === tab"
            [attr.tabindex]="state().tab === tab ? 0 : -1"
            (click)="selectTab(tab)"
            (keydown)="onTabKey($event, i)"
          >{{ copy.tabs[tab] }} <span class="ct">{{ counts()[tab] }}</span></button>
        }
      </div>

      <div class="cat-row">
        @if (showCategoryBar()) {
          <!-- The bar's code loads on demand (see mountBar), so it stays out of the initial bundle. -->
          <div class="bar-slot">
            <ng-container #barHost />
            @if (barFailed()) {
              <p class="bar-failed" role="status" data-testid="bar-failed">
                <span>{{ barCopy.loadFailed }}</span> ·
                <button type="button" class="retry" data-testid="bar-retry" (click)="retryBar()">{{ barCopy.retry }}</button>
              </p>
            }
          </div>
        }
        <div class="tools">
          <button type="button" class="pill" aria-haspopup="dialog" (click)="filterOpen.set(true)">
            <span [innerHTML]="filterIcon"></span>{{ copy.filter }}
            @if (sheetFilterCount() > 0) {
              <span class="badge">{{ sheetFilterCount() }}</span>
            }
          </button>
          <button type="button" class="pill" aria-haspopup="dialog" (click)="sortOpen.set(true)">
            <span>{{ sortLabel() }}</span>
            @if (sortHasDirection(state().sort)) {
              <span aria-hidden="true">{{ state().dir === 'desc' ? '↓' : '↑' }}</span>
            }
          </button>
        </div>
      </div>

      @if (chips().length > 0) {
        <div class="chips">
          @for (chip of chips(); track chip.key) {
            <span class="fchip">
              <span dir="auto">{{ chip.label }}</span>
              <button
                type="button"
                class="x"
                [attr.aria-label]="removeLabel(chip.label)"
                (click)="chip.remove()"
                [innerHTML]="closeIcon"
              ></button>
            </span>
          }
        </div>
      }

      @if (state().tab === 'to-read' && upNextViews().length > 0) {
        <iqra-up-next [rows]="upNextViews()" (reorder)="saveOrder($event)" />
      }

      @if (mainViews().length > 0) {
        <ul class="grid" data-grid="main">
          @for (v of mainViews(); track v.book.id) {
            <li><iqra-book-card [view]="v" /></li>
          }
        </ul>
      }

      @if (state().tab === 'reading' && pausedViews().length > 0) {
        <h2 class="section-title">{{ copy.paused }}</h2>
        <ul class="grid" data-grid="paused">
          @for (v of pausedViews(); track v.book.id) {
            <li><iqra-book-card [view]="v" /></li>
          }
        </ul>
      }

      @if (noBooks()) {
        <div class="empty first">
          <svg class="art" style="margin-bottom:20px" width="120" height="96" viewBox="0 0 120 96" aria-hidden="true">
            <rect x="14" y="26" width="18" height="64" rx="3" fill="var(--accent)" opacity=".55"/>
            <rect x="36" y="14" width="20" height="76" rx="3" fill="var(--accent)"/>
            <rect x="60" y="30" width="18" height="60" rx="3" fill="var(--accent)" opacity=".35" transform="rotate(-6 69 90)"/>
            <rect x="84" y="34" width="26" height="40" rx="3" fill="var(--surface)" stroke="var(--line)" stroke-width="2" transform="rotate(8 97 54)"/>
            <rect x="89" y="46" width="16" height="7" rx="2" fill="var(--hl-yellow)" transform="rotate(8 97 54)"/>
            <path d="M4 91h112" stroke="var(--line)" stroke-width="2" stroke-linecap="round"/>
          </svg>
          <h2>{{ copy.emptyTitle }}</h2>
          <p>{{ copy.emptyBody }}</p>
          <button type="button" class="add big" (click)="pickFiles()">
            <span [innerHTML]="uploadIcon"></span>{{ copy.addFirst }}
          </button>
          <p class="hint">{{ copy.emptyDropHint }}</p>
        </div>
      } @else if (noMatches()) {
        <div class="empty">
          <p>{{ copy.emptyFiltered }}</p>
          @if (hasActiveFilters()) {
            <button type="button" class="link" (click)="clearFilters()">{{ copy.clearFilters }}</button>
          }
        </div>
      }
      </section>
    </section>

    @if (dropActive()) {
      <div class="drop" aria-hidden="true">{{ copy.dropHint }}</div>
    }

    <iqra-filter-sheet
      [open]="filterOpen()"
      [value]="filterValue()"
      [tags]="allTags()"
      (apply)="applyFilters($event)"
      (closed)="filterOpen.set(false)"
    />
    <iqra-sort-menu
      [open]="sortOpen()"
      [sort]="state().sort"
      [dir]="state().dir"
      (choose)="chooseSort($event)"
      (closed)="sortOpen.set(false)"
    />
  `,
  styles: `
    :host { position: relative; display: block; min-height: 100%; }
    .page {
      max-width: 1080px;
      margin: 0 auto;
      padding: 20px var(--gutter) 24px;
    }
    .top-slot { min-height: 120px; }
    .card { padding: 14px 16px; border: 1px solid var(--line); border-radius: var(--radius-card); background: var(--surface); }
    .sec-h { margin: 0; font-size: 17px; font-weight: 600; letter-spacing: -0.01em; }
    .lib-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
    .actions { display: flex; align-items: center; gap: 2px; }
    .icon-btn {
      display: grid;
      place-items: center;
      width: 40px;
      height: 40px;
      border: 0;
      border-radius: var(--radius-control);
      background: none;
      color: var(--fg);
    }
    .icon-btn:hover, .icon-btn[aria-pressed='true'] { background: var(--surface-2); }
    .add {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 40px;
      margin-inline-start: 4px;
      padding: 8px 12px;
      border: 0;
      border-radius: var(--radius-control);
      background: var(--accent);
      color: var(--accent-fg);
      font-size: 13px;
      font-weight: 600;
      white-space: nowrap;
    }

    .search {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
      padding: 0 12px;
      border-radius: var(--radius-control);
      background: var(--surface-2);
      color: var(--muted);
    }
    .search input {
      flex: 1;
      min-width: 0;
      padding: 11px 0;
      border: 0;
      background: none;
      color: var(--fg);
      font: inherit;
      outline: none;
    }
    /* The field's outline stands in for the input's own focus ring. */
    .search:focus-within { outline: 2px solid var(--accent); outline-offset: 2px; }

    .seg {
      display: flex;
      gap: 2px;
      margin-bottom: 12px;
      padding: 3px;
      border-radius: var(--radius-control);
      background: var(--surface-2);
    }
    .seg-tab {
      flex: 1;
      min-width: 0;
      min-height: 40px;
      padding: 8px 4px;
      border: 0;
      border-radius: 9px;
      background: none;
      color: var(--muted);
      font-size: 13px;
      font-weight: 500;
      white-space: nowrap;
    }
    .seg-tab[aria-selected='true'] {
      background: var(--surface);
      color: var(--fg);
      box-shadow: 0 1px 3px color-mix(in srgb, var(--fg) 12%, transparent);
    }
    .ct {
      margin-inline-start: 3px;
      color: var(--muted);
      font-size: 11px;
      font-variant-numeric: tabular-nums;
    }

    /* Holds the row's height while the bar's code loads. */
    .bar-slot { min-height: 52px; }
    .bar-slot:empty { min-height: 0; }
    .bar-failed { display: flex; align-items: center; gap: 6px; min-height: 40px; margin: 0 0 12px; color: var(--muted); font-size: 13px; }
    .retry { min-height: 40px; padding: 0 8px; border: 0; background: none; color: var(--accent); font: 600 13px var(--ui); cursor: pointer; }
    .retry:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .cat-row { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 0 10px; }
    .cat-row .bar-slot { flex: 1 1 260px; min-width: 0; }
    .cat-row .tools { margin-top: 3px; }
    .chips {
      display: flex;
      gap: 6px;
      min-width: 0;
      margin-bottom: 14px;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .chips::-webkit-scrollbar { display: none; }
    .fchip {
      display: inline-flex;
      flex: none;
      align-items: center;
      gap: 2px;
      max-width: 220px;
      padding: 0 0 0 12px;
      border-radius: 999px;
      background: var(--accent-soft);
      color: var(--accent);
      font-size: 13px;
    }
    .fchip > span {
      overflow: hidden;
      min-width: 0;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .x {
      display: grid;
      flex: none;
      place-items: center;
      width: 40px;
      height: 40px;
      border: 0;
      border-radius: 50%;
      background: none;
      color: inherit;
    }
    .x:hover { background: color-mix(in srgb, currentColor 12%, transparent); }
    .tools {
      display: flex;
      flex: none;
      gap: 6px;
      margin-inline-start: auto;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 40px;
      padding: 6px 12px;
      border: 0;
      border-radius: 999px;
      background: none;
      color: var(--fg);
      font-size: 13px;
      font-weight: 500;
      white-space: nowrap;
    }
    .pill:hover { background: var(--surface-2); }
    .pill:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .badge {
      display: inline-grid;
      place-items: center;
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      border-radius: 999px;
      background: var(--accent);
      color: var(--accent-fg);
      font-size: 11px;
      font-weight: 700;
    }

    .section-title {
      margin: 6px 0 8px;
      font-size: 15px;
      font-weight: 600;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 16px 12px;
      margin: 0 0 24px;
      padding: 0;
      list-style: none;
    }
    @media (min-width: 480px) { .grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
    @media (min-width: 640px) { .grid { grid-template-columns: repeat(5, minmax(0, 1fr)); } }
    @media (min-width: 900px) { .grid { grid-template-columns: repeat(7, minmax(0, 1fr)); } }

    .empty {
      padding: 40px 24px;
      color: var(--muted);
      line-height: 1.5;
      text-align: center;
    }
    .empty p { margin: 0 0 14px; }
    .first { display: flex; flex-direction: column; align-items: center; padding-top: 32px; }
    .first h2 { margin: 0 0 8px; color: var(--fg); font-family: var(--book); font-size: 22px; font-weight: 600; }
    .first p { max-width: 36ch; }
    .big { min-height: 48px; padding: 10px 20px; margin: 4px 0 14px; font-size: 15px; }
    .first .hint { margin: 0; font-size: 13px; }
    .link {
      min-height: 40px;
      padding: 8px;
      border: 0;
      background: none;
      color: var(--accent);
      font-weight: 600;
    }

    .drop {
      position: fixed;
      inset: 12px;
      z-index: 20;
      display: grid;
      place-items: center;
      border: 2px dashed var(--accent);
      border-radius: var(--radius-card);
      background: color-mix(in srgb, var(--accent) 8%, var(--bg));
      color: var(--accent);
      font-weight: 600;
      pointer-events: none;
    }
  `,
})
export class LibraryPage {
  private readonly db = inject(DB);
  private readonly repo = inject(Repo);
  private readonly sanitizer = inject(DomSanitizer);
  protected readonly files = inject(FilesService);
  private readonly catalog = inject(CatalogService);
  private readonly importer = inject(ImportService);
  private readonly uploads = inject(UploadQueue);

  protected readonly copy = COPY.library;
  protected readonly barCopy = COPY.categoryBar;
  protected readonly tabs = TABS;
  protected readonly sortHasDirection = sortHasDirection;
  private focusSearch = false;

  protected readonly searchIcon = this.svg('search', 22);
  protected readonly uploadIcon = this.svg('upload', 17);
  protected readonly filterIcon = this.svg('filter', 16);
  protected readonly closeIcon = this.svg('x', 14);

  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('fileInput');
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');
  private readonly barHost = viewChild('barHost', { read: ViewContainerRef });
  private readonly topHost = viewChild('topHost', { read: ViewContainerRef });
  /** The bar's code could not be loaded. */
  protected readonly barFailed = signal(false);
  /** A selected category chip is scrolled out of the bar's visible part. */
  protected readonly barHidden = signal(false);
  private readonly injector = inject(Injector);
  private gone = false;

  private readonly booksRec = this.repo.live(() => this.db.books.filter((b) => !b.deleted).toArray());
  private readonly readMarksRec = this.repo.live(() =>
    this.db.readMarks.filter((r) => !r.deleted && r.read).toArray(),
  );
  protected readonly loaded = computed(() => this.booksRec() !== undefined);
  private readonly books = computed<Book[]>(() => this.booksRec() ?? []);
  protected readonly categories = this.catalog.categories;
  protected readonly allTags = computed(() =>
    [...new Set(this.books().flatMap((b) => b.tags))].sort((a, b) => a.localeCompare(b)),
  );

  private readonly markedCounts = computed(() => {
    const counts = new Map<ID, number>();
    for (const mark of this.readMarksRec() ?? []) counts.set(mark.bookId, (counts.get(mark.bookId) ?? 0) + 1);
    return counts;
  });
  private readonly ctx = computed<LibraryCtx>(() => ({
    liveCategories: new Set(this.categories().map((c) => c.id)),
    downloaded: this.files.downloaded(),
    upNext: this.catalog.upNext(),
    markedCounts: this.markedCounts(),
  }));

  /** Saved state, as the user last left it. */
  protected readonly state = signal<LibraryState>(loadLibraryState());
  /** The state with category ids that no longer exist removed, so no hidden filter can empty the list. */
  protected readonly effective = computed<LibraryState>(() => {
    const s = this.state();
    const known = new Set(this.categories().map((c) => c.id));
    return { ...s, categoryIds: s.categoryIds.filter((id) => id === UNCATEGORIZED || known.has(id)) };
  });

  protected readonly counts = computed(() => tabCounts(this.books()));
  protected readonly catCounts = computed(() =>
    categoryCounts(
      this.books(),
      this.categories().map((c) => c.id),
    ),
  );
  /** The bar is for managing categories too, so it stays once any exist; with nothing at all there is nothing to filter. */
  protected readonly showCategoryBar = computed(() => this.books().length > 0 || this.categories().length > 0);
  private readonly result = computed(() => queryLibrary(this.books(), this.effective(), this.ctx()));
  protected readonly recentViews = computed(() => recentBooks(this.books(), RECENT_LIMIT).map((b) => this.viewOf(b)));
  protected readonly finishedCount = computed(() => this.books().filter((b) => b.status === 'finished').length);
  protected readonly mainViews = computed(() => this.result().main.map((b) => this.viewOf(b)));
  protected readonly pausedViews = computed(() => this.result().paused.map((b) => this.viewOf(b)));

  protected readonly activeCount = computed(() => activeFilterCount(this.effective()));
  protected readonly hasActiveFilters = computed(() => this.activeCount() > 0 || this.effective().query.trim() !== '');
  protected readonly filterValue = computed<FilterValue>(() => {
    const s = this.effective();
    return { tags: s.tags, minRating: s.minRating, downloadedOnly: s.downloadedOnly };
  });
  /** What the Filter sheet edits. Categories live on the bar, so they are not counted on the Filter button. */
  protected readonly sheetFilterCount = computed(() => activeFilterCount({ ...this.effective(), categoryIds: [] }));
  protected readonly sortLabel = computed(() => COPY.sort[this.state().sort]);
  protected readonly noBooks = computed(() => this.loaded() && this.books().length === 0);
  protected readonly noMatches = computed(
    () =>
      this.loaded() &&
      this.books().length > 0 &&
      this.mainViews().length + this.pausedViews().length + this.upNextViews().length === 0,
  );

  protected readonly chips = computed<FilterChip[]>(() => {
    const s = this.effective();
    const chips: FilterChip[] = [];
    // Selected categories show as pressed chips in the bar, so they are not listed one by one here. One summary chip
    // appears only when the bar cannot show them all: several selected, one scrolled out of view, or the bar not loaded.
    const picked = s.categoryIds.length;
    if (picked > 0 && (picked > 1 || this.barHidden() || this.barFailed())) {
      const names = new Map(this.categories().map((c) => [c.id, c.name]));
      chips.push({
        key: 'categories',
        label: picked > 1 ? COPY.categoryBar.selectedCount(picked) : s.categoryIds[0] === UNCATEGORIZED ? COPY.categoryBar.uncategorized : (names.get(s.categoryIds[0]) ?? ''),
        remove: () => this.setState({ categoryIds: [] }),
      });
    }
    for (const tag of s.tags) {
      chips.push({
        key: `tag-${tag}`,
        label: `#${tag}`,
        remove: () => this.setState({ tags: this.state().tags.filter((x) => x !== tag) }),
      });
    }
    if (s.minRating !== null) {
      chips.push({ key: 'rating', label: `★ ≥ ${s.minRating}`, remove: () => this.setState({ minRating: null }) });
    }
    if (s.downloadedOnly) {
      chips.push({
        key: 'downloaded',
        label: COPY.filter.downloadedOnly,
        remove: () => this.setState({ downloadedOnly: false }),
      });
    }
    return chips;
  });

  protected readonly searching = signal(false);
  protected readonly searchOpen = computed(() => this.searching() || this.state().query !== '');
  protected readonly filterOpen = signal(false);
  protected readonly sortOpen = signal(false);
  protected readonly dropActive = signal(false);
  private readonly vcr = inject(ViewContainerRef);
  private readonly destroyRef = inject(DestroyRef);
  private dragDepth = 0;

  protected readonly upNextViews = computed<BookView[]>(() => this.result().upNext.map((b) => this.viewOf(b)));

  /** Opens the intro for someone new. A failed read just leaves it closed; Profile can still open it. */
  private async checkIntro(): Promise<void> {
    try {
      const settings = await this.db.settings.get('settings');
      const books = await this.db.books.filter((b) => !b.deleted).count();
      const suppressed = FAKE_DRIVE && !location.search.includes('intro=1');
      if (!this.gone && introDue(settings?.introSeen, books, suppressed)) void openIntro(this.vcr, this.destroyRef, () => this.pickFiles());
    } catch (err) {
      console.warn('Could not check whether to show the intro', err);
    }
  }

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.gone = true));
    void this.checkIntro();
    effect(() => {
      const host = this.topHost();
      if (host && host.length === 0) void this.mountTop(host);
    });
    effect(() => {
      const host = this.barHost();
      if (host && host.length === 0) void this.mountBar(host);
    });
    // Focuses the search field once it has rendered.
    afterEveryRender(() => {
      if (this.focusSearch) {
        this.focusSearch = false;
        this.searchInput()?.nativeElement.focus();
      }
    });
  }

  /** Loads the category bar's code on first need and keeps its inputs in step with the page. */
  /** The lazy import, on its own so a failed load can be retried (and tested). */
  protected loadBarComponent(): Promise<BarComponentType> {
    return import('../../books/library/category-bar.component').then((m) => m.CategoryBarComponent);
  }

  protected retryBar(): void {
    const host = this.barHost();
    if (host && host.length === 0) void this.mountBar(host);
  }

  /** Loads the greeting and Continue reading row on first need and keeps its inputs in step with the page. */
  private async mountTop(host: ViewContainerRef): Promise<void> {
    let LibraryTopComponent: typeof import('./top.component').LibraryTopComponent;
    try {
      LibraryTopComponent = await import('./top.component').then((m) => m.LibraryTopComponent);
    } catch {
      return; // A stale deploy or no connection: the Library works without its greeting.
    }
    if (this.gone || host.length > 0 || this.topHost() !== host) return;
    const ref = host.createComponent(LibraryTopComponent);
    const inputs = effect(
      () => {
        ref.setInput('recent', this.recentViews());
        ref.setInput('finished', this.finishedCount());
      },
      { injector: this.injector },
    );
    ref.onDestroy(() => inputs.destroy());
  }

  private async mountBar(host: ViewContainerRef): Promise<void> {
    let CategoryBarComponent: BarComponentType;
    try {
      CategoryBarComponent = await this.loadBarComponent();
    } catch {
      // A stale deploy or no connection: say so and offer a retry instead of leaving an empty slot.
      if (!this.gone) this.barFailed.set(true);
      return;
    }
    this.barFailed.set(false);
    // The page or the slot may have gone, or another load may have filled it, while the code was loading.
    if (this.gone || host.length > 0 || this.barHost() !== host) return;
    const ref = host.createComponent(CategoryBarComponent);
    const sub = ref.instance.selectedChange.subscribe((ids) => this.setCategories(ids));
    const hiddenSub = ref.instance.selectionHidden.subscribe((hidden) => this.barHidden.set(hidden));
    const inputs = effect(
      () => {
        ref.setInput('categories', this.categories());
        ref.setInput('counts', this.catCounts());
        ref.setInput('selected', this.effective().categoryIds);
      },
      { injector: this.injector },
    );
    ref.onDestroy(() => {
      sub.unsubscribe();
      hiddenSub.unsubscribe();
      this.barHidden.set(false);
      inputs.destroy();
    });
  }

  @HostListener('dragenter', ['$event'])
  protected onDragEnter(e: DragEvent): void {
    if (!hasFiles(e)) return;
    e.preventDefault();
    this.dragDepth += 1;
    this.dropActive.set(true);
  }

  @HostListener('dragover', ['$event'])
  protected onDragOver(e: DragEvent): void {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }

  @HostListener('dragleave', ['$event'])
  protected onDragLeave(e: DragEvent): void {
    if (!hasFiles(e)) return;
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (this.dragDepth === 0) this.dropActive.set(false);
  }

  @HostListener('drop', ['$event'])
  protected onDrop(e: DragEvent): void {
    if (!hasFiles(e)) return;
    e.preventDefault();
    this.dragDepth = 0;
    this.dropActive.set(false);
    const pdfs = Array.from(e.dataTransfer?.files ?? []).filter(isPdf);
    if (pdfs.length > 0) void this.importer.importFiles(pdfs);
  }

  protected pickFiles(): void {
    this.fileInput().nativeElement.click();
  }

  protected onPicked(e: Event): void {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length > 0) void this.importer.importFiles(files);
  }

  protected toggleSearch(): void {
    if (this.searchOpen()) {
      this.searching.set(false);
      this.setState({ query: '' });
      return;
    }
    this.searching.set(true);
    this.focusSearch = true;
  }

  protected onSearchInput(e: Event): void {
    this.setState({ query: (e.target as HTMLInputElement).value });
  }

  protected selectTab(tab: LibraryTab): void {
    this.setState({ tab });
  }

  protected onTabKey(e: KeyboardEvent, index: number): void {
    const el = e.currentTarget as HTMLElement;
    const rtl = getComputedStyle(el).direction === 'rtl';
    const count = TABS.length;
    let next = -1;
    if (e.key === 'ArrowRight') next = (index + (rtl ? -1 : 1) + count) % count;
    else if (e.key === 'ArrowLeft') next = (index + (rtl ? 1 : -1) + count) % count;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = count - 1;
    if (next < 0) return;
    e.preventDefault();
    this.selectTab(TABS[next]);
    (el.parentElement?.children[next] as HTMLElement | undefined)?.focus();
  }

  protected removeLabel(name: string): string {
    return COPY.library.removeFilter(name);
  }

  protected setCategories(categoryIds: ID[]): void {
    this.setState({ categoryIds });
  }

  protected applyFilters(value: FilterValue): void {
    this.setState({ ...value });
    this.filterOpen.set(false);
  }

  protected clearFilters(): void {
    this.searching.set(false);
    this.setState({ categoryIds: [], tags: [], minRating: null, downloadedOnly: false, query: '' });
  }

  /** Picking the current key flips the direction. Picking another key starts it in its default direction. */
  protected chooseSort(key: SortKey): void {
    const s = this.state();
    if (key === s.sort) {
      if (sortHasDirection(key)) this.setState({ dir: s.dir === 'desc' ? 'asc' : 'desc' });
    } else {
      this.setState({ sort: key, dir: DEFAULT_DIR[key] });
    }
    this.sortOpen.set(false);
  }

  private categoryOf(book: Book): BookView['category'] {
    const cat = this.categories().find((c) => book.categoryIds.includes(c.id));
    return cat ? { name: cat.name, hue: categoryHue(cat.order) } : null;
  }

  private viewOf(book: Book): BookView {
    return {
      book,
      progress: bookProgress(book, this.markedCounts().get(book.id) ?? 0),
      downloaded: this.files.downloaded().has(book.id),
      uploading: this.uploads.progress().get(book.id) ?? null,
      category: this.categoryOf(book),
    };
  }

  /** Saves a reordered visible list. Hidden Up next entries keep their places. */
  protected saveOrder(visible: ID[]): void {
    void this.catalog.setUpNext(mergeOrder(this.catalog.upNext(), visible));
  }

  private setState(patch: Partial<LibraryState>): void {
    const next = { ...this.state(), ...patch };
    this.state.set(next);
    saveLibraryState(next);
  }

  private svg(name: IconName, size: number): SafeHtml {
    // Icon markup comes from the static table in icons.ts, so bypassing the sanitizer is safe.
    return this.sanitizer.bypassSecurityTrustHtml(icon(name, size));
  }
}
