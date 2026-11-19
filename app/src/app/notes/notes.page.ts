import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { AnnotationService } from '../annotations/annotation.service';
import { searchNotes } from '../annotations/notes-search';
import { scopeLabel } from '../annotations/summary-scope';
import { tagSuggestionsFrom } from '../annotations/tag-input.component';
import { TextEditorSheet } from '../annotations/text-editor.sheet';
import { FilesService } from '../books/files.service';
import { DB } from '../core/db';
import type { Annotation, Book } from '../core/models';
import { Repo } from '../core/repo';
import { COPY } from '../ui/copy';
import { icon, type IconName } from '../ui/icons';

type Filter = Exclude<keyof typeof COPY.annotations.filters, 'all'>;
const FILTERS: Filter[] = ['highlights', 'notes', 'summaries', 'areas'];
const FILTER_TYPES: Record<Filter, readonly Annotation['type'][]> = {
  highlights: ['highlight'],
  notes: ['note', 'side-note'],
  summaries: ['summary'],
  areas: ['area'],
};
const ROW_ICONS: Record<Annotation['type'], IconName> = {
  highlight: 'highlighter', note: 'note', area: 'areaSelect', 'side-note': 'words', summary: 'notes', bookmark: 'bookmark',
};

interface Row {
  a: Annotation;
  icon: SafeHtml;
  preview: string;
  where: string;
}

/** Every highlight, note and summary from all books, searchable and filterable. */
@Component({
  selector: 'iqra-notes-page',
  imports: [TextEditorSheet],
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
        <div class="chips" role="group">
          @for (f of filters; track f) {
            <button type="button" class="chip" [class.on]="types().includes(f)" [attr.aria-pressed]="types().includes(f)" (click)="toggleType(f)">{{ copy.filters[f] }}</button>
          }
        </div>
        @if (allTags().length > 0) {
          <div class="chips" role="group" [attr.aria-label]="copy.tags">
            @for (t of allTags(); track t) {
              <button type="button" class="chip" dir="auto" [class.on]="tags().includes(t)" [attr.aria-pressed]="tags().includes(t)" (click)="toggleTag(t)">{{ t }}</button>
            }
          </div>
        }
        @if (groups().length === 0) {
          <p class="empty">{{ copy.hubNoResults }}</p>
        }
        @for (g of groups(); track g.book.id) {
          <div class="group">
            <h2 dir="auto">{{ g.book.title }}</h2>
            <span class="count">{{ g.rows.length }}</span>
          </div>
          <ul class="list">
            @for (r of g.rows; track r.a.id) {
              <li>
                <button type="button" class="nrow" (click)="open(g.book, r.a)">
                  <span class="ico" aria-hidden="true" [innerHTML]="r.icon"></span>
                  <span class="body">
                    <span class="prev" dir="auto">{{ r.preview }}</span>
                    @if (r.a.tags.length > 0) {
                      <span class="tags">
                        @for (t of r.a.tags; track t) {
                          <span class="tag" dir="auto">{{ t }}</span>
                        }
                      </span>
                    }
                  </span>
                  <span class="num" dir="auto">{{ r.where }}</span>
                </button>
              </li>
            }
          </ul>
        }
      }
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
    .search input:focus-visible, .chip:focus-visible, .nrow:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
    .chip { min-height: 40px; padding: 0 12px; border: 1px solid var(--line); border-radius: 999px; background: none; color: var(--fg); font: 13px var(--ui); cursor: pointer; }
    .chip.on { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
    .group { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin: 18px 2px 4px; }
    .group h2 { margin: 0; font: 600 16px var(--ui); }
    .count { color: var(--muted); font-size: 12px; }
    .list { list-style: none; margin: 0; padding: 0; }
    .list li { border-bottom: 1px solid var(--line); }
    .nrow { display: flex; align-items: flex-start; gap: 10px; width: 100%; min-height: 44px; padding: 8px 4px; border: 0; background: none; color: var(--fg); font: 15px var(--ui); text-align: start; cursor: pointer; }
    .ico { flex: none; display: inline-grid; place-items: center; width: 22px; height: 22px; color: var(--muted); }
    .body { flex: 1; min-width: 0; display: grid; gap: 4px; }
    .prev { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.4; }
    .tags { display: flex; flex-wrap: wrap; gap: 4px; }
    .tag { padding: 1px 8px; border-radius: 999px; background: var(--surface-2); color: var(--muted); font-size: 12px; }
    .num { flex: none; color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; }
    @media (prefers-reduced-motion: no-preference) { .chip { transition: background-color 0.12s; } }
  `,
})
export class NotesPage {
  protected readonly copy = COPY.annotations;
  protected readonly title = COPY.placeholder.notesTitle;
  protected readonly filters = FILTERS;

  private readonly service = inject(AnnotationService);
  private readonly files = inject(FilesService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly db = inject(DB);
  private readonly bookRecs = inject(Repo).live(() => this.db.books.filter((b) => !b.deleted).toArray());
  private readonly anns = this.service.all();

  protected readonly query = signal('');
  protected readonly types = signal<Filter[]>([]);
  protected readonly tags = signal<string[]>([]);
  protected readonly textTarget = signal<Annotation | null>(null);
  protected readonly textBook = computed(() => (this.bookRecs() ?? []).find((b) => b.id === this.textTarget()?.bookId));

  protected readonly allTags = computed(() => tagSuggestionsFrom(this.anns()));
  /** Annotations of live books that can be listed: the page shows the empty state when there are none. */
  protected readonly total = computed(() => searchNotes(this.anns() ?? [], this.bookRecs() ?? [], { query: '', types: [], tags: [] }).length);

  protected readonly groups = computed(() =>
    searchNotes(this.anns() ?? [], this.bookRecs() ?? [], {
      query: this.query(),
      types: this.types().flatMap((t) => FILTER_TYPES[t]),
      tags: this.tags(),
    }).map((g) => ({ book: g.book, rows: g.items.map((a) => this.toRow(a)) })),
  );

  protected onInput(e: Event): void {
    this.query.set((e.target as HTMLInputElement).value);
  }

  protected toggleType(f: Filter): void {
    this.types.update((t) => (t.includes(f) ? t.filter((x) => x !== f) : [...t, f]));
  }

  protected toggleTag(tag: string): void {
    this.tags.update((t) => (t.includes(tag) ? t.filter((x) => x !== tag) : [...t, tag]));
  }

  /** A highlight, note or area opens its book at the page and flashes; a side note or summary opens its editor here. */
  protected open(book: Book, a: Annotation): void {
    if (a.type === 'side-note' || a.type === 'summary') {
      this.textTarget.set(a);
      return;
    }
    this.files.openBook(book, { page: a.page ?? 1, a: a.id });
  }

  private toRow(a: Annotation): Row {
    const quote = a.text?.quote ?? '';
    const body = (a.body ?? '').trim();
    const preview =
      a.type === 'highlight' ? quote || body
      : a.type === 'note' ? body || quote
      : a.type === 'area' ? body || this.copy.area
      : body || (a.scope ? scopeLabel(a.scope) : this.copy.summary);
    return {
      a,
      icon: this.sanitizer.bypassSecurityTrustHtml(icon(ROW_ICONS[a.type], 18)),
      preview,
      where: a.type === 'summary' ? (a.scope ? scopeLabel(a.scope) : '') : this.copy.pageShort(a.page ?? 0),
    };
  }
}
