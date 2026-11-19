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
import { AnnotationService, HIGHLIGHT_COLORS, type HighlightColor } from './annotation.service';
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
        <button type="button" class="del" (click)="remove()">{{ copy.delete }}</button>
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
    .del { min-height: 40px; margin-top: 16px; padding: 0 14px; border: 1px solid var(--line); border-radius: var(--radius-control); background: none; color: var(--danger, var(--fg)); font: 14px var(--ui); cursor: pointer; }
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
  protected readonly title = computed(() => {
    const t = this.annotation()?.type;
    return t === 'area' ? this.copy.area : t === 'highlight' ? this.copy.highlight : this.copy.note;
  });

  private readonly service = inject(AnnotationService);
  private readonly toast = inject(ToastService);
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
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
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
    this.savedBody = this.body();
    void this.service.update(a.id, { body: this.body() }).catch((err) => this.failed(err));
  }

  protected onTags(next: string[]): void {
    this.tags.set(next);
    const a = this.annotation();
    if (a) void this.service.update(a.id, { tags: next }).catch((err) => this.failed(err));
  }

  protected onColor(c: HighlightColor): void {
    this.color.set(c);
    const a = this.annotation();
    if (a) void this.service.update(a.id, { color: c }).catch((err) => this.failed(err));
  }

  protected close(): void {
    const a = this.annotation();
    if (!a || this.done) return;
    this.flush();
    this.done = true;
    if (this.startedEmpty && this.body().trim() === '' && this.tags().length === 0) {
      void this.service.remove(a.id).catch((err) => this.failed(err));
    }
    this.closed.emit();
  }

  protected async remove(): Promise<void> {
    const a = this.annotation();
    if (!a || this.done) return;
    clearTimeout(this.timer);
    this.done = true;
    try {
      const rec = await this.service.remove(a.id);
      if (rec) this.toast.show(this.copy.deleted, { undo: () => void this.service.restore(rec) });
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
