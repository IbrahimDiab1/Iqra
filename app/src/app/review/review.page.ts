import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { FilesService } from '../books/files.service';
import { CLOCK } from '../core/clock';
import { DB } from '../core/db';
import type { Book, ReviewItem } from '../core/models';
import { Repo } from '../core/repo';
import { SettingsService } from '../core/settings.service';
import { icon } from '../ui/icons';
import { SheetComponent } from '../ui/sheet.component';
import { ToastService } from '../ui/toast.service';
import { PracticeComponent } from './practice.component';
import { REVIEW_COPY } from './review-copy';
import { daysUntilDue, filterItems, type CardDirection } from './review-logic';
import { ReviewService } from './review.service';
import { canSpeak, speak } from './translation';

const KINDS = ['all', 'word', 'phrase', 'sentence'] as const;
const DIRECTIONS: readonly CardDirection[] = ['en-ar', 'ar-en', 'mixed'];

/** The language notebook: saved words, phrases and sentences, and flashcard practice. */
@Component({
  selector: 'iqra-review-page',
  imports: [PracticeComponent, SheetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <h1>{{ c.title }}</h1>
      @if (items() === undefined) {
        <p class="empty" role="status"></p>
      } @else if (practice(); as cards) {
        <iqra-practice [cards]="cards" [direction]="direction()" (exit)="practice.set(null)" />
      } @else if (all().length === 0) {
        <div class="empty" data-testid="review-empty">
          <h2>{{ e.title }}</h2>
          <p>{{ e.body }}</p>
        </div>
      } @else {
        <div class="practice-row">
          <button type="button" class="go" data-testid="start-practice" (click)="startPractice()">
            {{ due().length > 0 ? p.start + ' · ' + p.dueBadge(due().length) : p.practiceAll }}
          </button>
          @if (due().length === 0) {
            <p class="none">{{ e.practiceNone }}</p>
          }
          <div class="dirs" role="radiogroup" [attr.aria-label]="p.direction">
            @for (d of directions; track d) {
              <button type="button" role="radio" class="chip" [attr.aria-checked]="direction() === d" [class.on]="direction() === d" (click)="setDirection(d)">{{ p.directions[d] }}</button>
            }
          </div>
        </div>
        <label class="search">
          <input type="search" dir="auto" autocomplete="off" [placeholder]="l.search" [attr.aria-label]="l.search" [value]="query()" (input)="onInput($event)" />
        </label>
        <div class="chips" role="group" aria-label="Type">
          @for (k of kinds; track k) {
            <button type="button" class="chip" [class.on]="kind() === k" [attr.aria-pressed]="kind() === k" (click)="kind.set(k)">{{ l.kinds[k] }}</button>
          }
        </div>
        @if (books().length > 1) {
          <label class="book-filter">
            <span class="sr">{{ l.book }}</span>
            <select [attr.aria-label]="l.book" (change)="onBook($event)">
              <option value="" [selected]="bookId() === null">{{ l.allBooks }}</option>
              @for (b of books(); track b.id) {
                <option [value]="b.id" [selected]="bookId() === b.id" dir="auto">{{ b.title }}</option>
              }
            </select>
          </label>
        }
        @if (rows().length === 0) {
          <p class="empty small">{{ l.noMatches }}</p>
        }
        <ul class="list">
          @for (r of rows(); track r.id) {
            <li class="card" data-testid="review-item">
              <div class="main">
                <p class="text" dir="auto" [attr.lang]="r.sourceLang">{{ r.text }}</p>
                <p class="tr" dir="auto" [attr.lang]="r.sourceLang === 'en' ? 'ar' : 'en'">{{ r.translation }}</p>
              </div>
              @if (r.context) {
                <p class="ctx" dir="auto">{{ r.context }}</p>
              }
              @if (r.note) {
                <p class="ctx" dir="auto">{{ r.note }}</p>
              }
              <div class="meta">
                <span class="book" dir="auto">{{ titleOf(r.bookId) }}</span>
                <span class="num">{{ l.page(r.page) }}</span>
                <span class="due" [class.now]="dueIn(r) === 0">{{ l.dueIn(dueIn(r)) }}</span>
              </div>
              <div class="actions">
                @if (speech) {
                  <button type="button" class="act" [attr.aria-label]="'Listen: ' + r.text" (click)="say(r)" [innerHTML]="speakerIcon"></button>
                }
                <button type="button" class="act" (click)="edit(r)">{{ l.edit }}</button>
                @if (bookOf(r.bookId); as b) {
                  <button type="button" class="act" (click)="open(b, r)">{{ l.openInBook }}</button>
                }
                <button type="button" class="act del" (click)="remove(r)">{{ l.delete }}</button>
              </div>
            </li>
          }
        </ul>
      }
      <f-sheet [open]="editing() !== null" [title]="l.edit" (closed)="editing.set(null)">
        @if (editing(); as r) {
          <label class="field">{{ l.textLabel }}<textarea #t dir="auto" rows="2" [value]="r.text" (input)="draft.text = t.value"></textarea></label>
          <label class="field">{{ l.translationLabel }}<textarea #tr dir="auto" rows="2" [value]="r.translation" (input)="draft.translation = tr.value"></textarea></label>
          <label class="field">{{ l.noteLabel }}<textarea #n dir="auto" rows="2" [value]="r.note ?? ''" (input)="draft.note = n.value"></textarea></label>
          <div class="sheet-actions">
            <button type="button" class="act" (click)="editing.set(null)">{{ l.cancel }}</button>
            <button type="button" class="go" data-testid="save-edit" (click)="saveEdit()">{{ l.save }}</button>
          </div>
        }
      </f-sheet>
    </section>
  `,
  styles: `
    .page { padding: 16px var(--gutter) 24px; max-width: 720px; margin: 0 auto; }
    h1 { margin: 0 0 12px; font-family: var(--book); font-size: 28px; font-weight: 600; }
    .empty { margin: 32px 0; text-align: center; color: var(--muted); font-size: 15px; line-height: 1.5; }
    .empty h2 { margin: 0 0 6px; color: var(--fg); font: 600 20px var(--book); }
    .empty p { margin: 0; }
    .empty.small { margin: 16px 0; }
    .practice-row { display: grid; gap: 8px; margin-bottom: 12px; }
    .none { margin: 0; color: var(--muted); font-size: 13px; }
    .go { min-height: 48px; border: 0; border-radius: var(--radius-control); background: var(--accent); color: var(--accent-fg); font: 600 15px var(--ui); cursor: pointer; padding: 0 16px; }
    .dirs, .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chips { margin-bottom: 8px; }
    .chip { min-height: 40px; max-width: 100%; padding: 0 12px; border: 1px solid var(--line); border-radius: 999px; background: none; color: var(--fg); font: 13px var(--ui); cursor: pointer; }
    .chip.on { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
    .search { display: block; margin-bottom: 10px; }
    .search input, .book-filter select, .field textarea { box-sizing: border-box; width: 100%; min-height: 44px; padding: 0 12px; border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--surface); color: var(--fg); font: 16px var(--ui); }
    .book-filter { display: block; margin-bottom: 8px; }
    .field { display: grid; gap: 4px; margin-bottom: 10px; color: var(--muted); font: 13px var(--ui); }
    .field textarea { padding: 8px 12px; resize: vertical; }
    .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
    .list { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 10px; }
    .card { display: grid; gap: 6px; padding: 12px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); }
    .main { display: grid; gap: 2px; }
    .text { margin: 0; font: 600 17px/1.45 var(--book); overflow-wrap: anywhere; }
    .tr { margin: 0; font: 16px/1.5 var(--book); color: var(--accent); overflow-wrap: anywhere; }
    .ctx { margin: 0; color: var(--muted); font: 13px/1.5 var(--ui); overflow-wrap: anywhere; }
    .meta { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 12px; color: var(--muted); }
    .book { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .num { font-variant-numeric: tabular-nums; }
    .due.now { color: var(--accent); font-weight: 600; }
    .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 8px; }
    .act { min-height: 40px; min-width: 40px; padding: 0 4px; border: 0; background: none; color: var(--accent); font: 600 13px var(--ui); cursor: pointer; display: inline-grid; place-items: center; }
    .act.del { color: var(--muted); }
    .sheet-actions { display: flex; justify-content: flex-end; align-items: center; gap: 12px; }
    .sheet-actions .go { min-height: 44px; }
    button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  `,
})
export class ReviewPage {
  protected readonly c = REVIEW_COPY;
  protected readonly l = REVIEW_COPY.list;
  protected readonly e = REVIEW_COPY.empty;
  protected readonly p = REVIEW_COPY.practice;
  protected readonly kinds = KINDS;
  protected readonly directions = DIRECTIONS;
  protected readonly speech = canSpeak();
  protected readonly speakerIcon = inject(DomSanitizer).bypassSecurityTrustHtml(icon('speaker', 20));

  private readonly reviews = inject(ReviewService);
  private readonly settings = inject(SettingsService);
  private readonly toast = inject(ToastService);
  private readonly files = inject(FilesService);
  private readonly clock = inject(CLOCK);
  private readonly db = inject(DB);
  private readonly repo = inject(Repo);
  private readonly bookRecs = this.repo.live(() => this.db.books.filter((b) => !b.deleted).toArray());

  protected readonly items = this.reviews.items();
  protected readonly all = computed(() => this.items() ?? []);
  protected readonly query = signal('');
  protected readonly kind = signal<(typeof KINDS)[number]>('all');
  protected readonly bookId = signal<string | null>(null);
  protected readonly practice = signal<ReviewItem[] | null>(null);
  protected readonly editing = signal<ReviewItem | null>(null);
  protected draft: { text?: string; translation?: string; note?: string } = {};

  protected readonly direction = computed<CardDirection>(() => this.settings.settings().cardDirection);
  protected readonly due = computed(() => this.all().filter((r) => r.srs.due <= this.clock.now()));
  /** Books that have saved items, for the filter. */
  protected readonly books = computed(() => {
    const ids = new Set(this.all().map((r) => r.bookId));
    return (this.bookRecs() ?? []).filter((b) => ids.has(b.id)).sort((a, b) => a.title.localeCompare(b.title));
  });
  protected readonly rows = computed(() => filterItems(this.all(), { query: this.query(), kind: this.kind(), bookId: this.bookId() }));

  protected titleOf(id: string): string {
    return this.bookOf(id)?.title ?? '';
  }

  protected bookOf(id: string): Book | undefined {
    return (this.bookRecs() ?? []).find((b) => b.id === id);
  }

  protected dueIn(r: ReviewItem): number {
    return daysUntilDue(r, this.clock.now());
  }

  protected onInput(e: Event): void {
    this.query.set((e.target as HTMLInputElement).value);
  }

  protected onBook(e: Event): void {
    this.bookId.set((e.target as HTMLSelectElement).value || null);
  }

  protected setDirection(d: CardDirection): void {
    void this.settings.update({ cardDirection: d });
  }

  /** Starts a session with what is due, or with every item when nothing is due. */
  protected startPractice(): void {
    const due = this.due();
    const pool = due.length > 0 ? due : this.all();
    this.practice.set([...pool].sort((a, b) => a.srs.due - b.srs.due));
  }

  protected say(r: ReviewItem): void {
    speak(r.text, r.sourceLang);
  }

  protected open(book: Book, r: ReviewItem): void {
    this.files.openBook(book, { page: r.page });
  }

  protected edit(r: ReviewItem): void {
    this.draft = {};
    this.editing.set(r);
  }

  protected async saveEdit(): Promise<void> {
    const r = this.editing();
    if (!r) return;
    const d = this.draft;
    const text = d.text?.trim();
    const translation = d.translation?.trim();
    // An emptied text or translation keeps the old value; the item always has both.
    await this.reviews.update(r.id, {
      ...(text ? { text } : {}),
      ...(translation ? { translation } : {}),
      ...(d.note !== undefined ? { note: d.note.trim() } : {}),
    });
    this.editing.set(null);
  }

  protected async remove(r: ReviewItem): Promise<void> {
    const removed = await this.reviews.remove(r.id);
    if (!removed) return;
    this.toast.show(this.l.deleted, { undo: () => void this.reviews.restore(removed) });
  }
}
