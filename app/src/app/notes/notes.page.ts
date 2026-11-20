import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { AnnotationService } from '../annotations/annotation.service';
import { booksInScope, searchNotes } from '../annotations/notes-search';
import { scopeLabel } from '../annotations/summary-scope';
import { tagSuggestionsFrom } from '../annotations/tag-input.component';
import { TextEditorSheet } from '../annotations/text-editor.sheet';
import { UNCATEGORIZED } from '../books/library/library-query';
import { FilesService } from '../books/files.service';
import { CLOCK } from '../core/clock';
import { DB } from '../core/db';
import type { Annotation, Book } from '../core/models';
import { Repo } from '../core/repo';
import { categoryHue } from '../stats/heatmap';
import { COPY } from '../ui/copy';
import { icon, type IconName } from '../ui/icons';
import { SheetComponent } from '../ui/sheet.component';
import { NOTES_COPY } from './notes-copy';
import { relativeTime } from './relative-time';

type Filter = Exclude<keyof typeof NOTES_COPY.filters, 'all'>;
const FILTERS: Filter[] = ['highlights', 'notes', 'summaries', 'bookmarks'];
/** Area highlights are listed as highlights; their card keeps the area icon. */
const FILTER_TYPES: Record<Filter, readonly Annotation['type'][]> = {
  highlights: ['highlight', 'area'],
  notes: ['note', 'side-note'],
  summaries: ['summary'],
  bookmarks: ['bookmark'],
};
/** `?type=` values the book's Stats tab links with, mapped to the chip they turn on. */
const TYPE_PRESETS: Partial<Record<Annotation['type'], Filter>> = {
  highlight: 'highlights', area: 'highlights', note: 'notes', 'side-note': 'notes', summary: 'summaries', bookmark: 'bookmarks',
};
const ROW_ICONS: Record<Annotation['type'], IconName> = {
  highlight: 'highlighter', note: 'note', area: 'areaSelect', 'side-note': 'words', summary: 'notes', bookmark: 'bookmark',
};
/** A card shows "Show more" when its text is likely to run past four lines. */
const LONG_CHARS = 200;
const CLAMP_LINES = 4;

interface Row {
  a: Annotation;
  book: Book;
  icon: SafeHtml;
  text: string;
  where: string;
  long: boolean;
  added: string;
  addedFull: string;
  addedIso: string;
}

/** Every highlight, note, summary and bookmark from all books, newest first, searchable and filterable. */
@Component({
  selector: 'iqra-notes-page',
  imports: [TextEditorSheet, SheetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <h1>{{ title }}</h1>
      @if (total() === 0) {
        <p class="empty">{{ copy.hubEmpty }}</p>
      } @else {
        <label class="search">
          <input type="search" dir="auto" autocomplete="off" [placeholder]="copy.hubSearch" [attr.aria-label]="copy.hubSearch" [value]="query()" (input)="onInput($event)" />
        </label>
        <div class="chips" role="group" [attr.aria-label]="nc.typeGroup" data-testid="type-chips">
          <button type="button" class="chip" [class.on]="types().length === 0" [attr.aria-pressed]="types().length === 0" (click)="types.set([])">{{ nc.filters.all }}</button>
          @for (f of filters; track f) {
            <button type="button" class="chip" [class.on]="types().includes(f)" [attr.aria-pressed]="types().includes(f)" (click)="toggleType(f)">{{ nc.filters[f] }}</button>
          }
        </div>
        <div class="chips" role="group" [attr.aria-label]="nc.categoryGroup" data-testid="category-chips">
          @if (categories().length > 0) {
            @for (c of categories(); track c.id) {
              <button type="button" class="chip" [class.on]="categoryIds().includes(c.id)" [attr.aria-pressed]="categoryIds().includes(c.id)" (click)="toggleCategory(c.id)">
                <span class="dot" [style.--dot]="'var(--cat-' + hue(c.order) + ')'"></span><span dir="auto">{{ c.name }}</span>
              </button>
            }
            <button type="button" class="chip" [class.on]="categoryIds().includes(uncategorized)" [attr.aria-pressed]="categoryIds().includes(uncategorized)" (click)="toggleCategory(uncategorized)">{{ nc.uncategorized }}</button>
          }
          <button type="button" class="chip books" data-testid="book-picker" aria-haspopup="dialog" [class.on]="bookIds().length > 0" (click)="pickerOpen.set(true)">{{ bookIds().length > 0 ? nc.booksCount(bookIds().length) : nc.books }}</button>
        </div>
        @if (selectedBooks().length > 0) {
          <div class="chips" data-testid="book-chips">
            @for (b of selectedBooks(); track b.id) {
              <button type="button" class="chip on" dir="auto" [attr.aria-label]="nc.removeBook(b.title)" (click)="toggleBook(b.id)">{{ b.title }} ×</button>
            }
          </div>
        }
        @if (allTags().length > 0) {
          <div class="chips" role="group" [attr.aria-label]="copy.tags">
            @for (t of allTags(); track t) {
              <button type="button" class="chip" dir="auto" [class.on]="tags().includes(t)" [attr.aria-pressed]="tags().includes(t)" (click)="toggleTag(t)">{{ t }}</button>
            }
          </div>
        }
        @if (rows().length === 0) {
          <p class="empty">{{ copy.hubNoResults }}</p>
        }
        <ul class="list">
          @for (r of rows(); track r.a.id) {
            <li class="card" [attr.data-type]="r.a.type">
              <div class="meta">
                <span class="ico" aria-hidden="true" [innerHTML]="r.icon"></span>
                <span class="book" dir="auto">{{ r.book.title }}</span>
                <time class="when" [attr.datetime]="r.addedIso" [title]="r.addedFull">{{ r.added }}</time>
              </div>
              @if (r.text) {
                <p class="text" dir="auto" [class.clamped]="r.long && !isOpen(r.a.id)">{{ r.text }}</p>
              }
              @if (r.a.tags.length > 0) {
                <span class="tags">
                  @for (t of r.a.tags; track t) {
                    <span class="tag" dir="auto">{{ t }}</span>
                  }
                </span>
              }
              <div class="actions">
                @if (r.long) {
                  <button type="button" class="act more" [attr.aria-expanded]="isOpen(r.a.id)" (click)="toggleOpen(r.a.id)">{{ isOpen(r.a.id) ? nc.showLess : nc.showMore }}</button>
                }
                @if (r.a.type === 'side-note' || r.a.type === 'summary') {
                  <button type="button" class="act edit" (click)="textTarget.set(r.a)">{{ nc.edit }}</button>
                }
                @if (r.a.type !== 'summary') {
                  <button type="button" class="act open" (click)="open(r.book, r.a)">{{ nc.openInBook }}</button>
                }
                @if (r.where) {
                  <span class="num" dir="auto">{{ r.where }}</span>
                }
              </div>
            </li>
          }
        </ul>
      }
      <f-sheet [open]="pickerOpen()" [title]="nc.chooseBooks" [tall]="true" (closed)="pickerOpen.set(false)">
        @if (pickerOpen()) {
          <ul class="options">
            @for (b of allBooks(); track b.id) {
              <li><button type="button" class="opt" data-testid="book-option" [attr.aria-pressed]="bookIds().includes(b.id)" (click)="toggleBook(b.id)"><span dir="auto">{{ b.title }}</span></button></li>
            }
          </ul>
          <div class="pick-actions">
            @if (bookIds().length > 0) {
              <button type="button" class="act" (click)="bookIds.set([])">{{ nc.clearBooks }}</button>
            }
            <button type="button" class="act" (click)="pickerOpen.set(false)">{{ nc.done }}</button>
          </div>
        }
      </f-sheet>
      <iqra-text-editor-sheet
        [annotation]="textTarget()"
        [pageCount]="textBook()?.pageCount ?? 1"
        [tagSuggestions]="allTags()"
        (closed)="textTarget.set(null)"
      />
    </section>
  `,
  styles: `
    .page { padding: 16px var(--gutter) 24px; max-width: 720px; margin: 0 auto; }
    h1 { margin: 0 0 12px; font-family: var(--book); font-size: 28px; font-weight: 600; }
    .empty { margin: 32px 0; text-align: center; color: var(--muted); font-size: 15px; line-height: 1.5; }
    .search { display: block; margin-bottom: 10px; }
    .search input { box-sizing: border-box; width: 100%; min-height: 44px; padding: 0 12px; border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--surface); color: var(--fg); font: 16px var(--ui); }
    .search input:focus-visible, .chip:focus-visible, .act:focus-visible, .opt:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
    .chip { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; max-width: 100%; padding: 0 12px; border: 1px solid var(--line); border-radius: 999px; background: none; color: var(--fg); font: 13px var(--ui); cursor: pointer; overflow-wrap: anywhere; }
    .chip.on { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
    .dot { flex: none; width: 10px; height: 10px; border-radius: 50%; background: var(--dot, var(--accent)); }
    .list { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 10px; }
    .card { display: grid; gap: 8px; padding: 12px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); }
    .meta { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 13px; color: var(--muted); }
    .ico { flex: none; display: inline-grid; place-items: center; width: 20px; height: 20px; }
    .book { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--fg); font-weight: 600; }
    .when { flex: none; }
    .text { margin: 0; font: 15px/1.5 var(--ui); overflow-wrap: anywhere; white-space: pre-wrap; }
    .text.clamped { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
    .tags { display: flex; flex-wrap: wrap; gap: 4px; }
    .tag { padding: 1px 8px; border-radius: 999px; background: var(--surface-2); color: var(--muted); font-size: 12px; }
    .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; }
    .act { min-height: 40px; padding: 0 4px; border: 0; background: none; color: var(--accent); font: 600 13px var(--ui); cursor: pointer; }
    .num { margin-inline-start: auto; color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; }
    .options { list-style: none; margin: 0; padding: 0; }
    .opt { display: block; width: 100%; min-height: 44px; padding: 0 8px; border: 0; border-bottom: 1px solid var(--line); background: none; color: var(--fg); font: 15px var(--ui); text-align: start; cursor: pointer; }
    .opt[aria-pressed="true"] { background: var(--surface-2); font-weight: 600; }
    .opt[aria-pressed="true"]::before { content: '✓ '; }
    .pick-actions { display: flex; justify-content: flex-end; gap: 12px; padding-top: 8px; }
    @media (prefers-reduced-motion: no-preference) { .chip { transition: background-color 0.12s; } }
  `,
})
export class NotesPage {
  protected readonly copy = COPY.annotations;
  protected readonly nc = NOTES_COPY;
  protected readonly title = COPY.placeholder.notesTitle;
  protected readonly filters = FILTERS;
  protected readonly uncategorized = UNCATEGORIZED;
  protected readonly hue = categoryHue;

  private readonly service = inject(AnnotationService);
  private readonly files = inject(FilesService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly clock = inject(CLOCK);
  private readonly db = inject(DB);
  private readonly repo = inject(Repo);
  private readonly bookRecs = this.repo.live(() => this.db.books.filter((b) => !b.deleted).toArray());
  private readonly categoryRecs = this.repo.live(() => this.db.categories.filter((c) => !c.deleted).sortBy('order'));
  private readonly anns = this.service.all();

  private readonly params = toSignal(inject(ActivatedRoute).queryParamMap);
  /** Set by `?book=` (a book's own Notes link): starts the book filter with that book. */
  private readonly bookParam = computed(() => this.params()?.get('book') ?? null);
  /** The chip a `?type=` value turns on. */
  private readonly typePreset = computed(() => TYPE_PRESETS[this.params()?.get('type') as Annotation['type']] ?? null);

  protected readonly query = signal('');
  protected readonly types = linkedSignal<Filter | null, Filter[]>({
    source: this.typePreset,
    computation: (preset) => (preset ? [preset] : []),
  });
  protected readonly bookIds = linkedSignal<string | null, string[]>({
    source: this.bookParam,
    computation: (id) => (id ? [id] : []),
  });
  protected readonly categoryIds = signal<string[]>([]);
  protected readonly tags = signal<string[]>([]);
  protected readonly pickerOpen = signal(false);
  private readonly expanded = signal<ReadonlySet<string>>(new Set());
  protected readonly textTarget = signal<Annotation | null>(null);
  protected readonly textBook = computed(() => (this.bookRecs() ?? []).find((b) => b.id === this.textTarget()?.bookId));

  protected readonly categories = computed(() => this.categoryRecs() ?? []);
  protected readonly allBooks = computed(() => [...(this.bookRecs() ?? [])].sort((a, b) => a.title.localeCompare(b.title)));
  protected readonly selectedBooks = computed(() => this.allBooks().filter((b) => this.bookIds().includes(b.id)));
  protected readonly allTags = computed(() => tagSuggestionsFrom(this.anns()));
  /** Annotations of live books that can be listed: the page shows the empty state when there are none. */
  protected readonly total = computed(() => searchNotes(this.anns() ?? [], this.bookRecs() ?? [], { query: '', types: [], tags: [], includeBookmarks: true }).length);

  /** Cards for every match, newest first. */
  protected readonly rows = computed<Row[]>(() => {
    const books = booksInScope(this.bookRecs() ?? [], this.bookIds(), this.categoryIds(), this.categories().map((c) => c.id), UNCATEGORIZED);
    const now = this.clock.now();
    const out: Row[] = [];
    for (const g of searchNotes(this.anns() ?? [], books, {
      query: this.query(),
      types: this.types().flatMap((t) => FILTER_TYPES[t]),
      tags: this.tags(),
      includeBookmarks: true,
    })) {
      for (const a of g.items) out.push(this.toRow(a, g.book, now));
    }
    return out.sort((x, y) => y.a.createdAt - x.a.createdAt);
  });

  protected onInput(e: Event): void {
    this.query.set((e.target as HTMLInputElement).value);
  }

  protected toggleType(f: Filter): void {
    this.types.update((t) => (t.includes(f) ? t.filter((x) => x !== f) : [...t, f]));
  }

  protected toggleCategory(id: string): void {
    this.categoryIds.update((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  }

  protected toggleBook(id: string): void {
    this.bookIds.update((b) => (b.includes(id) ? b.filter((x) => x !== id) : [...b, id]));
  }

  protected toggleTag(tag: string): void {
    this.tags.update((t) => (t.includes(tag) ? t.filter((x) => x !== tag) : [...t, tag]));
  }

  protected isOpen(id: string): boolean {
    return this.expanded().has(id);
  }

  /** Expands or collapses a card in place; never navigates. */
  protected toggleOpen(id: string): void {
    this.expanded.update((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  /** Opens the book at the annotation's page; it flashes there. */
  protected open(book: Book, a: Annotation): void {
    this.files.openBook(book, { page: a.page ?? 1, a: a.id });
  }

  private toRow(a: Annotation, book: Book, now: number): Row {
    const quote = a.text?.quote ?? '';
    const body = (a.body ?? '').trim();
    const text =
      a.type === 'highlight' ? quote || body
      : a.type === 'note' ? body || quote
      : a.type === 'area' ? body || this.copy.area
      : a.type === 'bookmark' ? this.copy.bookmark
      : body || (a.scope ? scopeLabel(a.scope) : this.copy.summary);
    return {
      a,
      book,
      icon: this.sanitizer.bypassSecurityTrustHtml(icon(ROW_ICONS[a.type], 18)),
      text,
      where: a.type === 'summary' ? (a.scope ? scopeLabel(a.scope) : '') : this.copy.pageShort(a.page ?? 0),
      long: text.length > LONG_CHARS || text.split('\n').length > CLAMP_LINES,
      added: relativeTime(a.createdAt, now, NOTES_COPY.justNow),
      addedFull: new Date(a.createdAt).toLocaleString(),
      addedIso: new Date(a.createdAt).toISOString(),
    };
  }
}
