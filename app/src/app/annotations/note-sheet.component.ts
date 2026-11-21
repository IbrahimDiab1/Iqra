import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { Annotation } from '../core/models';
import { COPY } from '../ui/copy';
import { SheetComponent } from '../ui/sheet.component';
import { ToastService } from '../ui/toast.service';
import { ReviewService } from '../review/review.service';
import { AnnotationService, HIGHLIGHT_COLORS, type HighlightColor } from './annotation.service';
import { CHROME_COPY } from '../reader/chrome-copy';
import { UndoStack, recordCommand } from '../reader/undo-stack';
import { FieldEdits, removalCommand } from './edit-undo';
import { TagInputComponent } from './tag-input.component';

const SAVE_DEBOUNCE_MS = 400;

/**
 * Popup for a highlight, note or area: its quote, the note text, tags and color.
 * The body saves 400 ms after typing stops, on blur and on close. A note that was opened empty
 * and is closed still empty is removed, so there are no empty notes.
 */
@Component({
  selector: 'iqra-note-sheet',
  imports: [SheetComponent, TagInputComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <f-sheet [open]="!!annotation()" [title]="title()" [tall]="true" (closed)="close()">
      @if (annotation(); as a) {
        @if (a.text?.quote; as quote) {
          <div class="qwrap">
            <p class="quote" dir="auto" [class.clamp]="!expanded()">{{ quote }}</p>
            @if (quote.length > 120) {
              <button type="button" class="more" (click)="expanded.set(!expanded())">
                {{ expanded() ? copy.showLess : copy.showMore }}
              </button>
            }
          </div>
        }
        <textarea
          #ta
          class="body"
          dir="auto"
          rows="5"
          [placeholder]="copy.notePlaceholder"
          [attr.aria-label]="copy.note"
          [value]="body()"
          (input)="onInput(ta.value)"
          (blur)="flush()"
        ></textarea>
        <iqra-tag-input [tags]="tags()" (tagsChange)="onTags($event)" [suggestions]="tagSuggestions()" />
        @if (hasColor()) {
          <div class="colors" role="group" [attr.aria-label]="copy.colorLabel">
            @for (c of colors; track c) {
              <button
                type="button"
                class="cdot"
                [attr.aria-label]="copy.colors[c]"
                [attr.aria-pressed]="color() === c"
                [style.--c]="'var(--hl-' + c + ')'"
                (click)="onColor(c)"
              ></button>
            }
          </div>
        }
        <div class="foot">
          @if (canReview()) {
            <button type="button" class="rev" data-testid="add-review" [disabled]="inReview()" (click)="addToReview()">
              {{ inReview() ? copy.inReview : copy.addToReview }}
            </button>
          }
          <button type="button" class="del" (click)="remove()">{{ copy.delete }}</button>
        </div>
      }
    </f-sheet>
  `,
  styles: `
    :host { display: contents; }
    .qwrap { margin-bottom: 12px; }
    .quote { margin: 0; padding-inline-start: 10px; border-inline-start: 3px solid var(--line); color: var(--muted); font-size: 14px; white-space: pre-wrap; }
    .quote.clamp { display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    .more { min-height: 40px; padding: 0 4px; border: 0; background: none; color: var(--accent); font: 13px var(--ui); cursor: pointer; }
    .body { display: block; box-sizing: border-box; width: 100%; margin-bottom: 12px; padding: 10px; border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--surface); color: var(--fg); font: 15px/1.5 var(--ui); resize: vertical; }
    .colors { display: flex; gap: 4px; margin-top: 12px; }
    .cdot { position: relative; width: 44px; height: 44px; border: 0; border-radius: 50%; background: none; cursor: pointer; }
    .cdot::after { content: ''; position: absolute; inset: 8px; border-radius: 50%; background: var(--c); box-shadow: inset 0 0 0 1px var(--line); }
    .cdot[aria-pressed='true']::after { box-shadow: 0 0 0 2px var(--accent); }
    .foot { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
    .rev { min-height: 40px; padding: 0 14px; border: 1px solid var(--line); border-radius: var(--radius-control); background: none; color: var(--accent); font: 14px var(--ui); cursor: pointer; }
    .rev:disabled { color: var(--muted); cursor: default; }
    .rev:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .del { min-height: 40px; padding: 0 14px; border: 1px solid var(--line); border-radius: var(--radius-control); background: none; color: var(--danger, var(--fg)); font: 14px var(--ui); cursor: pointer; }
    .body:focus-visible, .cdot:focus-visible, .del:focus-visible, .more:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  `,
})
export class NoteSheetComponent {
  /** The record being edited; null keeps the sheet closed. */
  readonly annotation = input<Annotation | null>(null);
  readonly tagSuggestions = input<string[]>([]);
  /** The note was created just now (by the Note action), so closing it untouched removes it. */
  readonly isNew = input(false);
  readonly closed = output<void>();
  /** Reserved for the Notes hub, which jumps to the annotation's page. */
  readonly jump = output<Annotation>();

  protected readonly copy = COPY.annotations;
  protected readonly colors = HIGHLIGHT_COLORS;
  protected readonly body = signal('');
  protected readonly tags = signal<string[]>([]);
  protected readonly color = signal<HighlightColor | undefined>(undefined);
  protected readonly expanded = signal(false);
  protected readonly hasColor = computed(() => {
    const t = this.annotation()?.type;
    return t === 'highlight' || t === 'area';
  });
  /** Highlights and notes (with their text) can be added to Review. */
  protected readonly canReview = computed(() => {
    const a = this.annotation();
    return !!a && (a.type === 'highlight' || a.type === 'note') && !!a.text;
  });
  protected readonly inReview = computed(() => {
    const a = this.annotation();
    return !!a && this.reviewIds().has(a.id);
  });
  protected readonly title = computed(() => {
    const t = this.annotation()?.type;
    return t === 'area' ? this.copy.area : t === 'highlight' ? this.copy.highlight : this.copy.note;
  });

  private readonly service = inject(AnnotationService);
  private readonly toast = inject(ToastService);
  private readonly reviews = inject(ReviewService);
  private readonly reviewIds = this.reviews.annotationIds();
  /** The reader's undo history; absent where the sheet is used outside a reader. */
  private readonly undoStack = inject(UndoStack, { optional: true });
  private readonly edits = new FieldEdits();
  private readonly textarea = viewChild<ElementRef<HTMLTextAreaElement>>('ta');
  private readonly openId = computed(() => this.annotation()?.id ?? null);
  private startedEmpty = false;
  private savedBody = '';
  private timer: ReturnType<typeof setTimeout> | undefined;
  private done = false;

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

  /** The page is going away or into the background: save now, and drop a new note that is still empty. */
  private onHide(): void {
    if (document.visibilityState !== 'hidden') return;
    if (this.startedEmpty && this.body().trim() === '' && this.tags().length === 0) this.close();
    else this.flush();
  }

  /** Flushes the body and removes a note that started empty and still is. Does not emit. */
  private settle(): void {
    const a = this.annotation();
    if (!a || this.done) {
      clearTimeout(this.timer);
      return;
    }
    this.flush();
    this.done = true;
    if (this.startedEmpty && this.body().trim() === '' && this.tags().length === 0) {
      this.undoStack?.discardSubject(a.id);
      void this.service.remove(a.id).catch((err) => this.failed(err));
    }
  }

  private begin(id: string | null): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.done = false;
    this.expanded.set(false);
    const a = this.annotation();
    if (!id || !a) return;
    this.body.set(a.body ?? '');
    this.savedBody = a.body ?? '';
    this.tags.set([...a.tags]);
    this.color.set(a.color);
    this.startedEmpty = a.type === 'note' && this.isNew() && this.savedBody.trim() === '' && a.tags.length === 0;
    if (this.startedEmpty) setTimeout(() => this.textarea()?.nativeElement.focus());
  }

  protected onInput(value: string): void {
    this.body.set(value);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), SAVE_DEBOUNCE_MS);
  }

  /** Saves the body now if it changed. */
  protected flush(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    const a = this.annotation();
    if (!a || this.done || this.body() === this.savedBody) return;
    const before = this.savedBody;
    this.savedBody = this.body();
    this.edits.record(this.undoStack, this.service, a.id, CHROME_COPY.actions.editText, { body: before }, { body: this.savedBody });
    void this.service.update(a.id, { body: this.body() }).catch((err) => this.failed(err));
  }

  protected onTags(next: string[]): void {
    const before = this.tags();
    this.tags.set(next);
    const a = this.annotation();
    if (!a) return;
    this.edits.record(this.undoStack, this.service, a.id, CHROME_COPY.actions.editTags, { tags: before }, { tags: next });
    void this.service.update(a.id, { tags: next }).catch((err) => this.failed(err));
  }

  protected onColor(c: HighlightColor): void {
    const before = this.color();
    this.color.set(c);
    const a = this.annotation();
    if (!a) return;
    if (before !== c) this.edits.record(this.undoStack, this.service, a.id, CHROME_COPY.actions.color, { color: before }, { color: c });
    void this.service.update(a.id, { color: c }).catch((err) => this.failed(err));
  }

  protected close(): void {
    if (!this.annotation() || this.done) return;
    this.settle();
    this.closed.emit();
  }

  protected async addToReview(): Promise<void> {
    const a = this.annotation();
    if (!a || this.inReview()) return;
    // Save what was typed first, so the Review card carries the note as it is now.
    this.flush();
    try {
      await this.reviews.addAnnotation(a.type === 'note' ? { ...a, body: this.body() } : a);
      this.toast.show(this.copy.addedToReview);
    } catch (err) {
      console.warn('Could not add to Review', err);
      this.toast.show(this.copy.reviewFailed);
    }
  }

  protected async remove(): Promise<void> {
    const a = this.annotation();
    if (!a || this.done) return;
    clearTimeout(this.timer);
    this.done = true;
    try {
      const rec = await this.service.remove(a.id);
      if (rec) this.toast.show(this.copy.deleted, { undo: recordCommand(this.undoStack, removalCommand(this.service, rec)) });
      this.closed.emit();
    } catch (err) {
      this.done = false;
      this.failed(err);
    }
  }

  private failed(err: unknown): void {
    console.warn('Could not save the note', err);
    this.toast.show(this.copy.saveFailed);
  }
}
