import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { AnnotationService } from '../annotations/annotation.service';
import { scopeLabel } from '../annotations/summary-scope';
import type { Annotation, Book, SummaryScope } from '../core/models';
import { COPY } from '../ui/copy';
import { icon, type IconName } from '../ui/icons';
import { ToastService } from '../ui/toast.service';
import type { Place } from './jump-history';

export type NotesFilter = keyof typeof COPY.annotations.filters;
const FILTERS: NotesFilter[] = ['all', 'highlights', 'notes', 'summaries', 'areas'];
const FILTER_TYPES: Record<NotesFilter, readonly Annotation['type'][]> = {
  all: ['highlight', 'note', 'area', 'side-note', 'summary'],
  highlights: ['highlight'],
  notes: ['note', 'side-note'],
  summaries: ['summary'],
  areas: ['area'],
};
const ROW_ICONS: Record<Annotation['type'], IconName> = {
  highlight: 'highlighter', note: 'note', area: 'areaSelect', 'side-note': 'words', summary: 'notes', bookmark: 'bookmark',
};
/** A jump to a note lands a little above it. */
const JUMP_MARGIN = 0.05;

interface NoteRow {
  a: Annotation;
  icon: SafeHtml;
  preview: string;
  tags: string[];
  where: string;
  editable: boolean;
}

/** Where an annotation sits in the book: the book summary first, then by page (a summary by its first page). */
function sortPage(a: Annotation): number {
  if (a.type !== 'summary') return a.page ?? 0;
  return a.scope?.kind === 'book' ? 0 : (a.scope?.kind === 'outline' || a.scope?.kind === 'pages' ? a.scope.fromPage : 0);
}

/** The Notes tab of the book panel: filters, "on this page" and "rest of the book" groups. */
@Component({
  selector: 'iqra-notes-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  <div class="actions">
    <button type="button" class="act" (click)="addSideNote()">{{ ann.sideNoteOn(page()) }}</button>
    <button type="button" class="act" (click)="addRangeSummary()">{{ ann.pageRangeSummary }}</button>
  </div>
  <div class="chips" role="group">
    @for (f of filters; track f) {
      <button type="button" class="chip" [class.on]="filter() === f" [attr.aria-pressed]="filter() === f" (click)="filterChange.emit(f)">{{ ann.filters[f] }}</button>
    }
  </div>
  @if (rows().length === 0) {
    <p class="note">{{ ann.noNotes }}</p>
  } @else {
    @for (g of groups(); track g.id) {
      <h4 class="group">{{ g.title }}</h4>
      <ul class="list" [attr.data-group]="g.id">
        @for (r of g.rows; track r.a.id) {
          <li class="item note-item">
            <button type="button" class="nrow" (click)="openNote(r.a)">
              <span class="ico" aria-hidden="true" [innerHTML]="r.icon"></span>
              <span class="body">
                <span class="prev" dir="auto">{{ r.preview }}</span>
                @if (r.tags.length > 0) {
                  <span class="tags">
                    @for (t of r.tags; track t) {
                      <span class="tag" dir="auto">{{ t }}</span>
                    }
                  </span>
                }
              </span>
              <span class="num" dir="auto">{{ r.where }}</span>
            </button>
            @if (r.editable) {
              <button type="button" class="tool" [attr.aria-label]="ann.edit" (click)="editNote(r.a)" [innerHTML]="icons.edit"></button>
            }
          </li>
        }
      </ul>
    }
  }
  `,
  styles: `
    button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .note { margin: 12px 2px; color: var(--muted); font-size: 14px; }
    .list { list-style: none; margin: 0; padding: 0; }
    .item { display: flex; align-items: center; border-bottom: 1px solid var(--line); }
    .num { flex: none; color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
    .act { min-height: 40px; padding: 0 12px; border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--surface); color: var(--accent); font: 600 13px var(--ui); cursor: pointer; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
    .chip { min-height: 40px; padding: 0 12px; border: 1px solid var(--line); border-radius: 999px; background: none; color: var(--fg); font: 13px var(--ui); cursor: pointer; }
    .chip.on { background: var(--accent); border-color: var(--accent); color: var(--on-accent, #fff); }
    .group { margin: 14px 2px 4px; font: 600 12px var(--ui); letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); }
    .nrow { display: flex; align-items: flex-start; gap: 10px; flex: 1; min-width: 0; min-height: 44px; padding: 8px 4px; border: 0; background: none; color: var(--fg); font: 15px var(--ui); text-align: start; cursor: pointer; }
    .ico { flex: none; display: inline-grid; place-items: center; width: 22px; height: 22px; color: var(--muted); }
    .body { flex: 1; min-width: 0; display: grid; gap: 4px; }
    .prev { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.4; }
    .tags { display: flex; flex-wrap: wrap; gap: 4px; }
    .tag { padding: 1px 8px; border-radius: 999px; background: var(--surface-2); color: var(--muted); font-size: 12px; }
    .tool { flex: none; display: inline-grid; place-items: center; width: 40px; height: 40px; border: 0; border-radius: var(--radius-control); background: none; color: var(--muted); cursor: pointer; }
  `,
})
export class NotesTabComponent {
  readonly book = input.required<Book>();
  readonly page = input<number>(1);
  /** This book's live annotations. */
  readonly annotations = input<Annotation[]>([]);
  /** The active filter; the panel owns it so it survives a tab switch. */
  readonly filter = input<NotesFilter>('all');
  readonly filterChange = output<NotesFilter>();
  readonly jump = output<Place>();
  /** The panel asks for the summary editor on this scope (existing or new). */
  readonly summary = output<SummaryScope>();
  /** Open the editor for an existing side note or summary. */
  readonly edit = output<Annotation>();
  /** Open the note sheet for a highlight, note or area. */
  readonly note = output<Annotation>();
  /** A side note just created; the editor opens on it. */
  readonly sideNote = output<Annotation>();
  /** Flash this annotation once its page is showing. */
  readonly flash = output<string>();
  /** An action was taken: the panel closes. */
  readonly done = output<void>();

  protected readonly ann = COPY.annotations;
  protected readonly filters = FILTERS;

  private readonly sanitizer = inject(DomSanitizer);
  protected readonly icons = { edit: this.sanitizer.bypassSecurityTrustHtml(icon('edit', 18)) };
  private readonly service = inject(AnnotationService);
  private readonly toast = inject(ToastService);

  /** Every note row for the active filter, in book order. */
  protected readonly rows = computed<NoteRow[]>(() => {
    const types = FILTER_TYPES[this.filter()];
    return this.annotations()
      .filter((a) => !a.deleted && types.includes(a.type))
      .sort((a, b) => sortPage(a) - sortPage(b) || a.createdAt - b.createdAt)
      .map((a) => this.toRow(a));
  });
  /** "On this page" (not summaries) and "Rest of the book"; an empty group is left out. */
  protected readonly groups = computed(() => {
    const rows = this.rows();
    const here = rows.filter((r) => r.a.type !== 'summary' && r.a.page === this.page());
    const rest = rows.filter((r) => !here.includes(r));
    return [
      { id: 'here', title: this.ann.onThisPage, rows: here },
      { id: 'rest', title: this.ann.restOfBook, rows: rest },
    ].filter((g) => g.rows.length > 0);
  });

  private toRow(a: Annotation): NoteRow {
    const quote = a.text?.quote ?? '';
    const body = (a.body ?? '').trim();
    const preview =
      a.type === 'highlight' ? quote || body
      : a.type === 'note' ? body || quote
      : a.type === 'area' ? body || this.ann.area
      : body || (a.scope ? scopeLabel(a.scope) : this.ann.summary);
    return {
      a,
      icon: this.sanitizer.bypassSecurityTrustHtml(icon(ROW_ICONS[a.type], 18)),
      preview,
      tags: a.tags,
      where: a.type === 'summary' ? (a.scope ? scopeLabel(a.scope) : '') : this.ann.pageShort(a.page ?? 0),
      editable: a.type === 'highlight' || a.type === 'note' || a.type === 'area',
    };
  }

  /** A highlight, note or area row jumps to it and flashes; a side note or summary opens its editor. */
  protected openNote(a: Annotation): void {
    if (a.type === 'highlight' || a.type === 'note' || a.type === 'area') {
      const y = (a.type === 'area' ? a.rect?.y : a.text?.rects[0]?.y) ?? 0;
      this.jump.emit({ page: a.page ?? 1, offset: Math.max(0, y - JUMP_MARGIN) });
      this.flash.emit(a.id);
    } else {
      this.edit.emit(a);
    }
    this.done.emit();
  }

  protected editNote(a: Annotation): void {
    this.note.emit(a);
    this.done.emit();
  }

  protected async addSideNote(): Promise<void> {
    try {
      const rec = await this.service.create({ bookId: this.book().id, type: 'side-note', page: this.page() });
      this.sideNote.emit(rec);
      this.done.emit();
    } catch (err) {
      console.warn('Could not add the side note', err);
      this.toast.show(this.ann.saveFailed);
    }
  }

  protected addRangeSummary(): void {
    this.summary.emit({ kind: 'pages', fromPage: this.page(), toPage: this.page() });
    this.done.emit();
  }
}
