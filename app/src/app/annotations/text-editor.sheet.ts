import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import type { Annotation, SummaryScope } from '../core/models';
import { COPY } from '../ui/copy';
import { SheetComponent } from '../ui/sheet.component';
import { ToastService } from '../ui/toast.service';
import { AnnotationService } from './annotation.service';
import { CHROME_COPY } from '../reader/chrome-copy';
import { UndoStack, recordCommand } from '../reader/undo-stack';
import { FieldEdits, removalCommand } from './edit-undo';
import { TagInputComponent } from './tag-input.component';

const SAVE_DEBOUNCE_MS = 400;

/** Editor for side notes and summaries: body, tags, and (for page-range summaries) the pages. */
@Component({
  selector: 'iqra-text-editor-sheet',
  imports: [SheetComponent, TagInputComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <f-sheet [open]="!!annotation()" [title]="title()" [tall]="true" (closed)="close()">
      @if (annotation(); as a) {
        @if (pages(); as p) {
          <div class="range">
            <label>
              <span>{{ copy.fromPage }}</span>
              <input #from type="number" inputmode="numeric" min="1" [max]="pageCount()" [attr.aria-label]="copy.fromPage" [value]="p.fromPage" (change)="onRange(from.value, to.value, from, to)" />
            </label>
            <label>
              <span>{{ copy.toPage }}</span>
              <input #to type="number" inputmode="numeric" min="1" [max]="pageCount()" [attr.aria-label]="copy.toPage" [value]="p.toPage" (change)="onRange(from.value, to.value, from, to)" />
            </label>
          </div>
        }
        <textarea
          #ta
          class="body"
          dir="auto"
          rows="8"
          [placeholder]="copy.notePlaceholder"
          [attr.aria-label]="a.type === 'summary' ? copy.summary : copy.sideNote"
          [value]="body()"
          (input)="onInput(ta.value)"
          (blur)="flush()"
        ></textarea>
        <iqra-tag-input [tags]="tags()" (tagsChange)="onTags($event)" [suggestions]="tagSuggestions()" />
        <button type="button" class="del" (click)="remove()">{{ copy.delete }}</button>
      }
    </f-sheet>
  `,
  styles: `
    :host { display: contents; }
    .range { display: flex; gap: 12px; margin-bottom: 12px; }
    .range label { display: grid; gap: 4px; font-size: 13px; color: var(--muted); }
    .range input { width: 96px; min-height: 40px; padding: 0 8px; border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--surface); color: var(--fg); font: 15px var(--ui); }
    .body { display: block; box-sizing: border-box; width: 100%; margin-bottom: 12px; padding: 10px; border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--surface); color: var(--fg); font: 15px/1.5 var(--ui); resize: vertical; }
    .del { min-height: 40px; margin-top: 16px; padding: 0 14px; border: 1px solid var(--line); border-radius: var(--radius-control); background: none; color: var(--danger, var(--fg)); font: 14px var(--ui); cursor: pointer; }
    .body:focus-visible, .range input:focus-visible, .del:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  `,
})
export class TextEditorSheet {
  readonly annotation = input<Annotation | null>(null);
  /** True when `annotation` is not stored yet: it is created on the first save of non-empty text. */
  readonly draft = input(false);
  /** A side note made just now: closing it still empty removes it. */
  readonly isNew = input(false);
  readonly tagSuggestions = input<string[]>([]);
  /** Upper bound for the page-range inputs. */
  readonly pageCount = input(1);
  /** `empty` is the sheet's own latest state: no text and no tags (not yet visible in any live query). */
  readonly closed = output<{ empty: boolean }>();

  protected readonly copy = COPY.annotations;
  protected readonly body = signal('');
  protected readonly tags = signal<string[]>([]);
  private readonly scope = signal<SummaryScope | undefined>(undefined);
  protected readonly pages = computed(() => {
    const s = this.scope();
    return s?.kind === 'pages' ? s : null;
  });
  protected readonly title = computed(() => {
    const a = this.annotation();
    if (!a) return '';
    const base = a.type === 'summary' ? this.copy.summary : this.copy.sideNote;
    const s = this.scope();
    let label = '';
    if (s?.kind === 'book') label = this.copy.scopeBook;
    else if (s?.kind === 'outline') label = s.title;
    else if (s?.kind === 'pages') label = this.copy.pageRange(s.fromPage, s.toPage);
    else if (a.page !== undefined) label = this.copy.pageShort(a.page);
    return label ? `${base} · ${label}` : base;
  });

  private readonly service = inject(AnnotationService);
  private readonly toast = inject(ToastService);
  /** The reader's undo history; absent where the sheet is used outside a reader. */
  private readonly undoStack = inject(UndoStack, { optional: true });
  private readonly edits = new FieldEdits();
  private readonly openId = computed(() => this.annotation()?.id ?? null);
  private savedBody = '';
  private timer: ReturnType<typeof setTimeout> | undefined;
  private done = false;
  private startedEmpty = false;
  /** Set once a draft has been stored; later saves update this record. */
  private storedId: string | null = null;
  private creating: Promise<void> = Promise.resolve();

  constructor() {
    effect(() => {
      const id = this.openId();
      untracked(() => this.begin(id));
    });
    // Navigation (Android Back, the back link) tears the sheet down without close(); save and tidy up as close() would.
    const hide = () => this.onHide();
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', hide);
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', hide);
      this.settle();
    });
  }

  /** The page is going away or into the background: save now (a draft with text is created), close a new empty note. */
  private onHide(): void {
    if (document.visibilityState !== 'hidden') return;
    if (this.startedEmpty && this.isEmpty()) this.close();
    else this.flush();
  }

  private isEmpty(): boolean {
    return this.body().trim() === '' && this.tags().length === 0;
  }

  /** Flushes the body and removes a side note that started empty and still is. Does not emit. */
  private settle(): void {
    const a = this.annotation();
    if (!a || this.done) {
      clearTimeout(this.timer);
      return;
    }
    this.flush();
    this.done = true;
    if (this.startedEmpty && this.isEmpty() && !this.draft()) {
      this.undoStack?.discardSubject(a.id);
      void this.service.remove(a.id).catch((err) => this.failed(err));
    }
  }

  private begin(id: string | null): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.done = false;
    this.storedId = null;
    const a = this.annotation();
    if (!id || !a) return;
    this.body.set(a.body ?? '');
    this.savedBody = a.body ?? '';
    this.tags.set([...a.tags]);
    this.scope.set(a.scope);
    this.startedEmpty = a.type === 'side-note' && this.isNew() && this.savedBody.trim() === '' && a.tags.length === 0;
  }

  protected onInput(value: string): void {
    this.body.set(value);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), SAVE_DEBOUNCE_MS);
  }

  protected flush(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    const a = this.annotation();
    if (!a || this.done || this.body() === this.savedBody) return;
    const before = this.savedBody;
    this.savedBody = this.body();
    this.save(a, { body: this.body() }, { body: before }, CHROME_COPY.actions.editText);
  }

  protected onTags(next: string[]): void {
    const before = this.tags();
    this.tags.set(next);
    const a = this.annotation();
    if (a) this.save(a, { tags: next }, { tags: before }, CHROME_COPY.actions.editTags);
  }

  /** Clamps both pages to 1..pageCount with toPage >= fromPage, writes the corrected values back to the fields, and saves. */
  protected onRange(fromRaw: string, toRaw: string, fromEl: HTMLInputElement, toEl: HTMLInputElement): void {
    const a = this.annotation();
    if (!a || this.scope()?.kind !== 'pages') return;
    const max = Math.max(1, this.pageCount());
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));
    const cur = this.pages()!;
    const rawFrom = Number(fromRaw);
    const rawTo = Number(toRaw);
    const fromPage = clamp(Number.isFinite(rawFrom) && fromRaw !== '' ? rawFrom : cur.fromPage, 1, max);
    const toPage = clamp(Number.isFinite(rawTo) && toRaw !== '' ? rawTo : cur.toPage, fromPage, max);
    fromEl.value = String(fromPage);
    toEl.value = String(toPage);
    const scope: SummaryScope = { kind: 'pages', fromPage, toPage };
    const before = this.scope();
    this.scope.set(scope);
    this.save(a, { scope }, before ? { scope: before } : undefined, CHROME_COPY.actions.editText);
  }

  /** Writes a change. A draft is created on the first change once its text is non-empty; before that nothing is stored. */
  private save(a: Annotation, patch: Partial<Pick<Annotation, 'body' | 'tags' | 'scope'>>, before?: Partial<Pick<Annotation, 'body' | 'tags' | 'scope'>>, label = ''): void {
    if (!this.draft() && this.storedId === null) {
      if (before) this.edits.record(this.undoStack, this.service, a.id, label, before, patch);
      void this.service.update(a.id, patch).catch((err) => this.failed(err));
      return;
    }
    // A draft: serialize so a change typed while the create is in flight updates the created record.
    this.creating = this.creating.then(async () => {
      try {
        if (this.storedId !== null) {
          if (before) this.edits.record(this.undoStack, this.service, this.storedId, label, before, patch);
          await this.service.update(this.storedId, patch);
        } else if (this.body().trim() !== '') {
          const rec = await this.service.create({
            bookId: a.bookId,
            type: a.type,
            ...(a.page !== undefined ? { page: a.page } : {}),
            ...(this.scope() ? { scope: this.scope() } : {}),
            body: this.body(),
            tags: this.tags(),
          });
          this.storedId = rec.id;
          this.undoStack?.push({
            label: CHROME_COPY.actions.summary,
            subject: rec.id,
            undo: async () => void (await this.service.remove(rec.id)),
            redo: () => this.service.restore(rec),
          });
        }
      } catch (err) {
        this.failed(err);
      }
    });
  }

  protected close(): void {
    if (!this.annotation() || this.done) return;
    this.flush();
    this.done = true;
    this.closed.emit({ empty: this.isEmpty() });
  }

  protected async remove(): Promise<void> {
    const a = this.annotation();
    if (!a || this.done) return;
    clearTimeout(this.timer);
    this.done = true;
    try {
      await this.creating;
      const id = this.storedId ?? (this.draft() ? null : a.id);
      if (id === null) {
        this.closed.emit({ empty: false });
        return;
      }
      const rec = await this.service.remove(id);
      if (rec) this.toast.show(this.copy.deleted, { undo: recordCommand(this.undoStack, removalCommand(this.service, rec)) });
      this.closed.emit({ empty: false });
    } catch (err) {
      this.done = false;
      this.failed(err);
    }
  }

  private failed(err: unknown): void {
    console.warn('Could not save', err);
    this.toast.show(this.copy.saveFailed);
  }
}
