import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { CLOCK } from '../../core/clock';
import type { Book, ID } from '../../core/models';
import { Repo } from '../../core/repo';
import { COPY } from '../../ui/copy';
import { SheetComponent } from '../../ui/sheet.component';
import { ToastService } from '../../ui/toast.service';
import { CatalogService } from '../catalog.service';
import { FilesService } from '../files.service';
import { BookDetailsService } from './book-details.service';

const MIB = 1024 * 1024;
const STATUSES: readonly Book['status'][] = ['to-read', 'reading', 'paused', 'finished'];
const RATINGS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** Edits held until Save. `upNext` stays null until the switch is touched, so it follows the live list. */
interface Draft {
  title: string;
  author: string;
  status: Book['status'];
  categoryIds: ID[];
  tags: string[];
  rating: number | undefined;
  review: string;
  upNext: boolean | null;
  progressMode: Book['progressMode'];
  pageMode: Book['pageMode'];
}

/** Lowercase-kebab with no `#`, or '' when nothing is left. */
export function normalizeTag(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/#/g, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

function draftOf(b: Book): Draft {
  return {
    title: b.title,
    author: b.author,
    status: b.status,
    categoryIds: [...b.categoryIds],
    tags: [...b.tags],
    rating: b.rating,
    review: b.review ?? '',
    upNext: null,
    progressMode: b.progressMode,
    pageMode: b.pageMode,
  };
}

/** Edits a book's details. Changes stay in a draft until Save; Cancel discards them. */
@Component({
  imports: [SheetComponent],
  selector: 'iqra-book-details-sheet',
  template: `
    @let b = book();
    @let d = draft();
    <f-sheet [open]="!!b && !!d" [title]="copy.title" [tall]="true" (closed)="cancel()">
      @if (b && d) {
        <div class="seg" role="group" [attr.aria-label]="copy.title">
          <button type="button" [attr.aria-pressed]="tab() === 'details'" (click)="tab.set('details')">
            {{ copy.tabDetails }}
          </button>
          <button type="button" [attr.aria-pressed]="tab() === 'stats'" (click)="tab.set('stats')">
            {{ copy.tabStats }}
          </button>
        </div>

        @if (tab() === 'details') {
          <label class="lbl" for="bd-title">{{ copy.titleLabel }}</label>
          <input id="bd-title" class="field" dir="auto" [value]="d.title" (input)="setText('title', $event)" />

          <label class="lbl" for="bd-author">{{ copy.author }}</label>
          <input id="bd-author" class="field" dir="auto" [value]="d.author" (input)="setText('author', $event)" />

          <span class="lbl" id="bd-status-lbl">{{ copy.status }}</span>
          <div class="seg" role="group" aria-labelledby="bd-status-lbl">
            @for (s of statuses; track s) {
              <button type="button" [attr.aria-pressed]="d.status === s" (click)="set('status', s)">
                {{ copyStatus[s] }}
              </button>
            }
          </div>

          <span class="lbl" id="bd-cats-lbl">{{ copy.categories }}</span>
          <div class="chips" role="group" aria-labelledby="bd-cats-lbl">
            @for (c of categories(); track c.id) {
              <button type="button" class="chip" [attr.aria-pressed]="d.categoryIds.includes(c.id)" (click)="toggleCategory(c.id)">
                {{ c.name }}
              </button>
            }
            @if (addingCategory()) {
              <input
                #newCategory
                class="chip-input"
                dir="auto"
                [attr.aria-label]="copy.newCategory"
                (keydown.enter)="commitCategory(newCategory)"
                (keydown.escape)="addingCategory.set(false)"
              />
            } @else {
              <button type="button" class="chip add" (click)="startAddCategory()">+ {{ copy.newCategory }}</button>
            }
          </div>

          <span class="lbl" id="bd-tags-lbl">{{ copy.tags }}</span>
          <div class="chips" role="group" aria-labelledby="bd-tags-lbl">
            @for (t of d.tags; track t) {
              <span class="chip tag">
                {{ t }}
                <button type="button" class="tag-x" [attr.aria-label]="copy.removeTag" (click)="removeTag(t)">×</button>
              </span>
            }
          </div>
          <input
            #tagInput
            class="field tag-input"
            dir="auto"
            [placeholder]="copy.tagPlaceholder"
            [attr.aria-label]="copy.tags"
            (keydown.enter)="addTag(tagInput)"
          />

          <span class="lbl" id="bd-rating-lbl">{{ copy.rating }}</span>
          <div class="rating" role="group" aria-labelledby="bd-rating-lbl">
            @for (n of ratings; track n) {
              <button type="button" class="rate" [attr.aria-pressed]="d.rating === n" (click)="toggleRating(n)">
                {{ n }}
              </button>
            }
            <span class="rate-value">{{ d.rating ? copy.ratingOf(d.rating) : copy.ratingNone }}</span>
          </div>

          <label class="lbl" for="bd-review">{{ copy.review }}</label>
          <textarea
            id="bd-review"
            class="field"
            dir="auto"
            rows="4"
            [placeholder]="copy.reviewPlaceholder"
            [value]="d.review"
            (input)="setText('review', $event)"
          ></textarea>

          <div class="switch-row">
            <span id="bd-upnext-lbl">{{ copy.upNext }}</span>
            <button
              type="button"
              class="switch"
              role="switch"
              aria-labelledby="bd-upnext-lbl"
              [attr.aria-checked]="upNextOn()"
              (click)="set('upNext', !upNextOn())"
            ></button>
          </div>

          <span class="lbl" id="bd-progress-lbl">{{ copy.progressMode }}</span>
          <div class="seg" role="group" aria-labelledby="bd-progress-lbl">
            <button type="button" [attr.aria-pressed]="d.progressMode === 'last-page'" (click)="set('progressMode', 'last-page')">
              {{ copy.lastPage }}
            </button>
            <button type="button" [attr.aria-pressed]="d.progressMode === 'marked'" (click)="set('progressMode', 'marked')">
              {{ copy.marked }}
            </button>
          </div>

          <span class="lbl" id="bd-page-lbl">{{ copy.pageMode }}</span>
          <div class="seg" role="group" aria-labelledby="bd-page-lbl">
            <button type="button" [attr.aria-pressed]="d.pageMode === 'swipe'" (click)="set('pageMode', 'swipe')">
              {{ copy.swipe }}
            </button>
            <button type="button" [attr.aria-pressed]="d.pageMode === 'scroll'" (click)="set('pageMode', 'scroll')">
              {{ copy.scroll }}
            </button>
          </div>

          <span class="lbl" id="bd-file-lbl">{{ copy.file }}</span>
          <div class="fileinfo">
            <div class="grow">
              <div>{{ copy.fileInfo(sizeMb(b), b.pageCount) }}</div>
              <div class="sub">{{ files.downloaded().has(b.id) ? copy.onDevice : copy.notDownloaded }}</div>
            </div>
            @if (files.downloaded().has(b.id)) {
              <button type="button" class="btn-ghost" (click)="files.removeLocal(b)">{{ copy.removeDownload }}</button>
            } @else {
              <button
                type="button"
                class="btn-primary"
                [disabled]="files.downloadProgress().has(b.id)"
                (click)="files.download(b)"
              >
                {{ copy.download }}
              </button>
            }
          </div>
        } @else {
          <p class="muted">{{ copy.statsSoon }}</p>
        }
      }

      <div sheet-foot class="foot-row">
        <button type="button" class="btn-ghost danger" [disabled]="!b" (click)="removeBook()">{{ copy.remove }}</button>
        <span class="spacer"></span>
        <button type="button" class="btn-ghost" (click)="cancel()">{{ common.cancel }}</button>
        <button type="button" class="btn-primary" [disabled]="!canSave()" (click)="save()">{{ copy.save }}</button>
      </div>
    </f-sheet>
  `,
  styles: `
    .seg { display: flex; background: var(--surface-2); border-radius: 12px; padding: 3px; gap: 2px; }
    .seg button {
      flex: 1;
      min-height: 40px;
      border: 0;
      background: none;
      padding: 8px 4px;
      border-radius: 9px;
      font-size: 13px;
      font-weight: 500;
      color: var(--muted);
      white-space: nowrap;
    }
    .seg button[aria-pressed="true"] {
      background: var(--surface);
      color: var(--fg);
      box-shadow: 0 1px 3px rgba(0, 0, 0, .12);
    }
    .lbl {
      display: block;
      font-size: 12px;
      font-weight: 600;
      color: var(--muted);
      margin: 14px 0 6px;
      text-transform: uppercase;
      letter-spacing: .06em;
    }
    .field {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 11px 12px;
      font: inherit;
      font-size: 14.5px;
      background: var(--surface-2);
      color: var(--fg);
      line-height: 1.5;
    }
    textarea.field { resize: vertical; }
    .tag-input { margin-top: 8px; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip {
      min-height: 40px;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 6px 12px;
      font-size: 13px;
      background: var(--surface);
      color: var(--fg);
      white-space: nowrap;
    }
    .chip[aria-pressed="true"] {
      background: var(--fg);
      color: var(--surface);
      border-color: var(--fg);
    }
    .chip.add { color: var(--accent); border-style: dashed; }
    .chip.tag { display: inline-flex; align-items: center; gap: 4px; cursor: default; min-height: 0; padding: 4px 6px 4px 12px; }
    .tag-x {
      display: grid;
      place-items: center;
      width: 28px;
      height: 28px;
      border: 0;
      border-radius: 50%;
      background: none;
      color: var(--muted);
      font-size: 16px;
      line-height: 1;
    }
    .chip-input {
      min-height: 40px;
      width: 9em;
      border: 1px solid var(--accent);
      border-radius: 999px;
      padding: 6px 12px;
      font: inherit;
      font-size: 13px;
      background: var(--surface);
      color: var(--fg);
    }
    .rating { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .rate {
      width: 40px;
      height: 40px;
      flex: none;
      border: 1px solid var(--line);
      border-radius: 50%;
      background: var(--surface);
      color: var(--fg);
      font-weight: 600;
      font-size: 13.5px;
    }
    .rate[aria-pressed="true"] { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }
    .rate-value { margin-inline-start: 4px; font-size: 13px; color: var(--muted); font-variant-numeric: tabular-nums; }
    .switch-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-top: 18px;
      font-size: 14.5px;
    }
    .switch {
      width: 44px;
      height: 26px;
      border-radius: 999px;
      background: var(--line);
      border: 0;
      position: relative;
      flex: none;
      padding: 0;
      transition: background .2s;
    }
    .switch::after {
      content: "";
      position: absolute;
      top: 3px;
      left: 3px;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: var(--surface);
      box-shadow: 0 1px 3px rgba(0, 0, 0, .25);
      transition: transform .2s;
    }
    .switch[aria-checked="true"] { background: var(--accent); }
    .switch[aria-checked="true"]::after { transform: translateX(18px); }
    .fileinfo {
      display: flex;
      gap: 10px;
      align-items: center;
      padding: 12px 14px;
      border-radius: 14px;
      background: var(--surface-2);
      font-size: 13px;
      margin-top: 14px;
    }
    .fileinfo .grow { flex: 1; min-width: 0; }
    .fileinfo .sub { color: var(--muted); font-size: 12px; margin-top: 2px; }
    .muted { color: var(--muted); font-size: 14px; }
    .btn-primary, .btn-ghost {
      min-height: 40px;
      border: 0;
      border-radius: 12px;
      padding: 10px 14px;
      font-weight: 600;
      white-space: nowrap;
    }
    .btn-primary { background: var(--accent); color: var(--accent-fg); }
    .btn-primary:disabled { opacity: .55; cursor: default; }
    .btn-ghost { background: none; color: var(--muted); }
    .btn-ghost:hover { background: var(--surface-2); color: var(--fg); }
    .btn-ghost.danger { color: var(--danger); }
    .foot-row { display: flex; align-items: center; gap: 6px; width: 100%; }
    .spacer { flex: 1; }
  `,
})
export class BookDetailsSheetComponent {
  protected readonly details = inject(BookDetailsService);
  protected readonly files = inject(FilesService);
  private readonly catalog = inject(CatalogService);
  private readonly repo = inject(Repo);
  private readonly toast = inject(ToastService);
  private readonly clock = inject(CLOCK);
  private readonly injector = inject(Injector);

  protected readonly copy = COPY.details;
  protected readonly common = COPY.common;
  protected readonly copyStatus = COPY.status;
  protected readonly statuses = STATUSES;
  protected readonly ratings = RATINGS;
  protected readonly categories = this.catalog.categories;

  protected readonly book = this.details.openBook;
  protected readonly draft = signal<Draft | null>(null);
  protected readonly tab = signal<'details' | 'stats'>('details');
  protected readonly addingCategory = signal(false);
  private readonly newCategoryInput = viewChild<ElementRef<HTMLInputElement>>('newCategory');

  protected readonly upNextOn = computed(() => {
    const b = this.book();
    const d = this.draft();
    if (!b || !d) return false;
    return d.upNext ?? this.catalog.upNext().includes(b.id);
  });
  protected readonly canSave = computed(() => (this.draft()?.title.trim() ?? '') !== '');

  private loadedId: ID | null = null;
  private saving = false;

  constructor() {
    // Loads a fresh draft when a different book opens. Live updates to the same book do not overwrite edits.
    effect(() => {
      const b = this.book();
      untracked(() => {
        if (!b) {
          this.loadedId = null;
          this.draft.set(null);
          return;
        }
        if (b.id === this.loadedId) return;
        this.loadedId = b.id;
        this.tab.set('details');
        this.addingCategory.set(false);
        this.draft.set(draftOf(b));
      });
    });
  }

  protected set<K extends keyof Draft>(key: K, value: Draft[K]): void {
    this.draft.update((d) => (d ? { ...d, [key]: value } : d));
  }

  protected setText(key: 'title' | 'author' | 'review', ev: Event): void {
    this.set(key, (ev.target as HTMLInputElement | HTMLTextAreaElement).value);
  }

  protected toggleCategory(id: ID): void {
    this.draft.update((d) => {
      if (!d) return d;
      const categoryIds = d.categoryIds.includes(id)
        ? d.categoryIds.filter((c) => c !== id)
        : [...d.categoryIds, id];
      return { ...d, categoryIds };
    });
  }

  protected startAddCategory(): void {
    this.addingCategory.set(true);
    afterNextRender(() => this.newCategoryInput()?.nativeElement.focus(), { injector: this.injector });
  }

  /** Creates the category (or finds the existing one), then selects it in the draft. */
  protected async commitCategory(input: HTMLInputElement): Promise<void> {
    const name = input.value.trim();
    if (name === '') {
      this.addingCategory.set(false);
      return;
    }
    const category = await this.catalog.addCategory(name);
    this.addingCategory.set(false);
    this.draft.update((d) =>
      d && !d.categoryIds.includes(category.id) ? { ...d, categoryIds: [...d.categoryIds, category.id] } : d,
    );
  }

  protected addTag(input: HTMLInputElement): void {
    const tag = normalizeTag(input.value);
    input.value = '';
    if (tag === '') return;
    this.draft.update((d) => (d && !d.tags.includes(tag) ? { ...d, tags: [...d.tags, tag] } : d));
  }

  protected removeTag(tag: string): void {
    this.draft.update((d) => (d ? { ...d, tags: d.tags.filter((t) => t !== tag) } : d));
  }

  /** Tapping the chosen rating again clears it. */
  protected toggleRating(n: number): void {
    this.set('rating', this.draft()?.rating === n ? undefined : n);
  }

  protected sizeMb(b: Book): string {
    return (b.sizeBytes / MIB).toFixed(1);
  }

  protected cancel(): void {
    this.details.close();
  }

  protected removeBook(): void {
    const b = this.book();
    if (!b) return;
    this.details.close();
    this.files.requestRemove(b);
  }

  protected async save(): Promise<void> {
    const b = this.book();
    const d = this.draft();
    if (!b || !d || this.saving || !this.canSave()) return;
    this.saving = true;
    try {
      const upNext = this.upNextOn();
      const next: Book = {
        ...b,
        title: d.title.trim(),
        author: d.author.trim(),
        status: d.status,
        categoryIds: d.categoryIds,
        tags: d.tags,
        progressMode: d.progressMode,
        pageMode: d.pageMode,
      };
      if (d.rating === undefined) delete next.rating;
      else next.rating = d.rating;
      if (d.review.trim() === '') delete next.review;
      else next.review = d.review;
      if (d.status === 'finished' && b.status !== 'finished') next.finishedAt = this.clock.now();

      await this.repo.put<Book>('books', next);
      await this.catalog.toggleUpNext(b.id, upNext);
      this.details.close();
      this.toast.show(this.copy.saved);
    } finally {
      this.saving = false;
    }
  }
}
