import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { UNCATEGORIZED, foldText } from '../books/library/library-query';
import type { Book, Category, ID } from '../core/models';
import { SheetComponent } from '../ui/sheet.component';
import { categoryHue } from './heatmap';
import { STATS_COPY } from './stats-copy';

const F = STATS_COPY.filters;

/**
 * The Stats filters: a category legend whose swatches are the heat map's colours (click one to show only that
 * category), and a book picker with search. Both are optional filters over the whole screen.
 */
@Component({
  selector: 'iqra-stats-filters',
  imports: [SheetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (categories().length > 0) {
      <div class="legend" role="group" [attr.aria-label]="f.category">
        <button type="button" class="chip" [attr.aria-pressed]="categoryId() === null" (click)="categoryChange.emit(null)">{{ f.allCategories }}</button>
        @for (cat of categories(); track cat.id) {
          <button type="button" class="chip" [attr.aria-pressed]="categoryId() === cat.id" (click)="toggle(cat.id)">
            <span class="dot" [style.--dot]="'var(--cat-' + hue(cat) + ')'"></span><span dir="auto" class="nm">{{ cat.name }}</span>
          </button>
        }
        <button type="button" class="chip" [attr.aria-pressed]="categoryId() === uncategorized" (click)="toggle(uncategorized)">
          <span class="dot" style="--dot: var(--accent)"></span><span class="nm">{{ f.uncategorized }}</span>
        </button>
      </div>
    }

    <div class="book-row">
      <button type="button" class="pick" data-testid="book-picker" aria-haspopup="dialog" [attr.aria-label]="f.book + ': ' + (selectedTitle() ?? f.allBooks)" (click)="openPicker()">
        <span dir="auto" class="nm">{{ selectedTitle() ?? f.allBooks }}</span>
      </button>
      @if (selectedTitle() !== null) {
        <button type="button" class="clear" data-testid="book-clear" [attr.aria-label]="f.clearBook" (click)="bookChange.emit(null)">×</button>
      }
    </div>

    <f-sheet [open]="pickerOpen()" [title]="f.chooseBook" [tall]="true" (closed)="pickerOpen.set(false)">
      <!-- Rendered only while open, so a long library is not drawn for nothing. -->
      @if (pickerOpen()) {
        <input
          class="search"
          type="search"
          autocomplete="off"
          dir="auto"
          data-testid="book-search"
          [attr.aria-label]="f.searchBooks"
          [placeholder]="f.searchBooks"
          [value]="query()"
          (input)="query.set($any($event.target).value)"
        />
        <ul class="options">
          <li><button type="button" class="opt" data-testid="book-option" [attr.aria-pressed]="bookId() === null" (click)="choose(null)">{{ f.allBooks }}</button></li>
          @for (b of matches(); track b.id) {
            <li><button type="button" class="opt" data-testid="book-option" [attr.aria-pressed]="bookId() === b.id" (click)="choose(b.id)"><span dir="auto">{{ b.title }}</span></button></li>
          }
        </ul>
        @if (matches().length === 0) {
          <p class="none">{{ f.noBookMatches }}</p>
        }
      }
    </f-sheet>
  `,
  styles: `
    :host { display: block; margin-bottom: 12px; }
    .legend { display: flex; flex-wrap: nowrap; gap: 6px; margin-bottom: 8px; padding: 3px; overflow-x: auto; scrollbar-width: none; }
    .legend::-webkit-scrollbar { display: none; }
    .chip { display: inline-flex; flex: none; align-items: center; gap: 6px; max-width: 240px; min-height: 40px; padding: 6px 12px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); color: var(--fg); font: 500 13px var(--ui); cursor: pointer; }
    .chip[aria-pressed='true'] { background: var(--fg); border-color: var(--fg); color: var(--surface); }
    .dot { flex: none; width: 10px; height: 10px; border-radius: 3px; background: var(--dot, var(--accent)); }
    .nm { overflow: hidden; min-width: 0; text-overflow: ellipsis; white-space: nowrap; }
    .book-row { display: flex; align-items: center; gap: 4px; }
    .pick { display: flex; flex: 0 1 auto; align-items: center; min-width: 0; max-width: 100%; min-height: 40px; padding: 6px 14px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); color: var(--fg); font: 500 13px var(--ui); cursor: pointer; }
    .pick::after { content: '▾'; margin-inline-start: 8px; color: var(--muted); }
    .clear { width: 40px; height: 40px; border: 0; border-radius: 50%; background: none; color: var(--muted); font-size: 20px; cursor: pointer; }
    .clear:hover { background: var(--surface-2); color: var(--fg); }
    .search { box-sizing: border-box; width: 100%; min-height: 44px; margin: 4px 0 8px; padding: 0 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface-2); color: var(--fg); font: 16px var(--ui); }
    .options { list-style: none; margin: 0; padding: 0; }
    .opt { display: block; width: 100%; min-height: 44px; padding: 8px 6px; border: 0; border-bottom: 1px solid var(--line); background: none; color: var(--fg); font: 15px var(--ui); text-align: start; cursor: pointer; overflow-wrap: anywhere; }
    .opt[aria-pressed='true'] { color: var(--accent); font-weight: 600; }
    .none { margin: 12px 4px; color: var(--muted); font-size: 14px; }
    button:focus-visible, .search:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  `,
})
export class StatsFiltersComponent {
  readonly categories = input<readonly Category[]>([]);
  /** Live books the picker can offer. */
  readonly books = input<readonly Book[]>([]);
  /** A category id, `UNCATEGORIZED` or null for all. */
  readonly categoryId = input<ID | null>(null);
  readonly bookId = input<ID | null>(null);
  readonly categoryChange = output<ID | null>();
  readonly bookChange = output<ID | null>();

  protected readonly f = F;
  protected readonly uncategorized = UNCATEGORIZED;
  protected readonly pickerOpen = signal(false);
  protected readonly query = signal('');

  protected readonly selectedTitle = computed(() => {
    const id = this.bookId();
    return id === null ? null : (this.books().find((b) => b.id === id)?.title ?? null);
  });

  /** Books whose title or author contains the query, ignoring case and Arabic diacritics; by title. */
  protected readonly matches = computed(() => {
    const q = foldText(this.query().trim());
    return [...this.books()]
      .filter((b) => q === '' || foldText(b.title).includes(q) || foldText(b.author).includes(q))
      .sort((a, b) => a.title.localeCompare(b.title));
  });

  protected hue(cat: Category): number {
    return categoryHue(cat.order);
  }

  /** Picking the filter that is already on switches it off. */
  protected toggle(id: ID): void {
    this.categoryChange.emit(this.categoryId() === id ? null : id);
  }

  protected openPicker(): void {
    this.query.set('');
    this.pickerOpen.set(true);
  }

  protected choose(id: ID | null): void {
    this.bookChange.emit(id);
    this.pickerOpen.set(false);
  }
}
