import {
  Component,
  ElementRef,
  HostListener,
  afterEveryRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { CatalogService } from '../../books/catalog.service';
import { FilesService } from '../../books/files.service';
import { ImportService } from '../../books/import/import.service';
import {
  activeFilterCount,
  bookProgress,
  continueBook,
  queryLibrary,
  tabCounts,
  type LibraryCtx,
  type LibraryState,
  type LibraryTab,
  type SortKey,
} from '../../books/library/library-query';
import { UploadQueue } from '../../books/upload-queue';
import { DB } from '../../core/db';
import type { Book, ID } from '../../core/models';
import { Repo } from '../../core/repo';
import { SyncStatusComponent } from '../../sync/sync-status.component';
import { COPY } from '../../ui/copy';
import { icon, type IconName } from '../../ui/icons';
import { BookCardComponent, type BookView } from './book-card.component';
import { ContinueCardComponent } from './continue-card.component';
import { FilterSheetComponent } from './filter-sheet.component';
import { DEFAULT_DIR, loadLibraryState, saveLibraryState, sortHasDirection, type FilterValue } from './library-state';
import { SortMenuComponent } from './sort-menu.component';
import { UpNextComponent } from './up-next.component';

const TABS: readonly LibraryTab[] = ['reading', 'to-read', 'finished', 'all'];

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
    RouterLink,
    SyncStatusComponent,
    BookCardComponent,
    ContinueCardComponent,
    FilterSheetComponent,
    SortMenuComponent,
    UpNextComponent,
  ],
  template: `
    <section class="page">
      <header class="hdr">
        <div class="title">
          <iqra-sync-status />
          <h1>{{ copy.title }}</h1>
        </div>
        <div class="actions">
          <button
            type="button"
            class="icon-btn"
            [attr.aria-label]="copy.search"
            [attr.aria-pressed]="searchOpen()"
            (click)="toggleSearch()"
            [innerHTML]="searchIcon"
          ></button>
          <a class="icon-btn" routerLink="/settings" [attr.aria-label]="copy.settings" [innerHTML]="settingsIcon"></a>
          <button type="button" class="add" (click)="pickFiles()">
            <span [innerHTML]="uploadIcon"></span>{{ copy.add }}
          </button>
          <input #fileInput type="file" accept="application/pdf" multiple hidden (change)="onPicked($event)" />
        </div>
      </header>

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

      <div class="toolbar">
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
        <div class="tools">
          <button type="button" class="pill" aria-haspopup="dialog" (click)="filterOpen.set(true)">
            <span [innerHTML]="filterIcon"></span>{{ copy.filter }}
            @if (activeCount() > 0) {
              <span class="badge">{{ activeCount() }}</span>
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

      @if (continueView(); as cv) {
        <iqra-continue-card [view]="cv" />
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
          <svg class="art" width="120" height="96" viewBox="0 0 120 96" aria-hidden="true">
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

    @if (dropActive()) {
      <div class="drop" aria-hidden="true">{{ copy.dropHint }}</div>
    }

    <iqra-filter-sheet
      [open]="filterOpen()"
      [value]="filterValue()"
      [categories]="categories()"
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
    h1 { margin: 2px 0 0; font-size: 28px; font-weight: 600; line-height: 1.1; letter-spacing: -0.02em; }
    .hdr {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }
    .title { min-width: 0; }
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
    .icon-btn:hover:not(:disabled), .icon-btn[aria-pressed='true'] { background: var(--surface-2); }
    .icon-btn:disabled { opacity: 0.4; cursor: default; }
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

    .toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-bottom: 14px;
    }
    .chips {
      display: flex;
      flex: 1 1 160px;
      gap: 6px;
      min-width: 0;
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
      border: 1px solid color-mix(in srgb, var(--fg) 18%, transparent);
      border-radius: 999px;
      background: none;
      color: var(--fg);
      font-size: 13px;
      font-weight: 500;
      white-space: nowrap;
    }
    .pill:hover { background: var(--surface-2); }
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
      gap: 18px 12px;
      margin: 0 0 24px;
      padding: 0;
      list-style: none;
    }
    @media (min-width: 600px) { .grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
    @media (min-width: 900px) { .grid { grid-template-columns: repeat(6, minmax(0, 1fr)); } }

    .empty {
      padding: 40px 24px;
      color: var(--muted);
      line-height: 1.5;
      text-align: center;
    }
    .empty p { margin: 0 0 14px; }
    .first { display: flex; flex-direction: column; align-items: center; padding-top: 56px; }
    .first .art { margin-bottom: 20px; }
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
  protected readonly tabs = TABS;
  protected readonly sortHasDirection = sortHasDirection;
  private focusSearch = false;

  protected readonly searchIcon = this.svg('search', 22);
  protected readonly settingsIcon = this.svg('gear', 22);
  protected readonly uploadIcon = this.svg('upload', 17);
  protected readonly filterIcon = this.svg('filter', 16);
  protected readonly closeIcon = this.svg('x', 14);

  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('fileInput');
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');

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
    downloaded: this.files.downloaded(),
    upNext: this.catalog.upNext(),
    markedCounts: this.markedCounts(),
  }));

  /** Saved state, as the user last left it. */
  protected readonly state = signal<LibraryState>(loadLibraryState());
  /** The state with category ids that no longer exist removed, so no hidden filter can empty the list. */
  private readonly effective = computed<LibraryState>(() => {
    const s = this.state();
    const known = new Set(this.categories().map((c) => c.id));
    return { ...s, categoryIds: s.categoryIds.filter((id) => known.has(id)) };
  });

  protected readonly counts = computed(() => tabCounts(this.books()));
  private readonly result = computed(() => queryLibrary(this.books(), this.effective(), this.ctx()));
  protected readonly continueView = computed<BookView | null>(() => {
    const book = continueBook(this.books(), this.effective(), this.ctx());
    return book ? this.viewOf(book) : null;
  });
  protected readonly mainViews = computed(() => this.result().main.map((b) => this.viewOf(b)));
  protected readonly pausedViews = computed(() => this.result().paused.map((b) => this.viewOf(b)));

  protected readonly activeCount = computed(() => activeFilterCount(this.effective()));
  protected readonly hasActiveFilters = computed(() => this.activeCount() > 0 || this.effective().query.trim() !== '');
  protected readonly filterValue = computed<FilterValue>(() => {
    const s = this.effective();
    return { categoryIds: s.categoryIds, tags: s.tags, minRating: s.minRating, downloadedOnly: s.downloadedOnly };
  });
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
    const names = new Map(this.categories().map((c) => [c.id, c.name]));
    const chips: FilterChip[] = [];
    for (const id of s.categoryIds) {
      chips.push({
        key: `category-${id}`,
        label: names.get(id) ?? '',
        remove: () => this.setState({ categoryIds: this.state().categoryIds.filter((x) => x !== id) }),
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
  private dragDepth = 0;

  protected readonly upNextViews = computed<BookView[]>(() => this.result().upNext.map((b) => this.viewOf(b)));

  constructor() {
    // Focuses the search field once it has rendered.
    afterEveryRender(() => {
      if (this.focusSearch) {
        this.focusSearch = false;
        this.searchInput()?.nativeElement.focus();
      }
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

  private viewOf(book: Book): BookView {
    return {
      book,
      progress: bookProgress(book, this.markedCounts().get(book.id) ?? 0),
      downloaded: this.files.downloaded().has(book.id),
      uploading: this.uploads.progress().get(book.id) ?? null,
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
