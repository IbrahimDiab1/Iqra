import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import type { Annotation, SummaryScope } from '../core/models';
import { COPY } from '../ui/copy';
import { SheetComponent } from '../ui/sheet.component';
import { ToastService } from '../ui/toast.service';
import { AnnotationService } from './annotation.service';
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
  readonly tagSuggestions = input<string[]>([]);
  /** Upper bound for the page-range inputs. */
  readonly pageCount = input(1);
  readonly closed = output<void>();

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
  private readonly openId = computed(() => this.annotation()?.id ?? null);
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
    const a = this.annotation();
    if (!id || !a) return;
    this.body.set(a.body ?? '');
    this.savedBody = a.body ?? '';
    this.tags.set([...a.tags]);
    this.scope.set(a.scope);
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
    this.savedBody = this.body();
    void this.service.update(a.id, { body: this.body() }).catch((err) => this.failed(err));
  }

  protected onTags(next: string[]): void {
    this.tags.set(next);
    const a = this.annotation();
    if (a) void this.service.update(a.id, { tags: next }).catch((err) => this.failed(err));
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
    this.scope.set(scope);
    void this.service.update(a.id, { scope }).catch((err) => this.failed(err));
  }

  protected close(): void {
    if (!this.annotation() || this.done) return;
    this.flush();
    this.done = true;
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
    console.warn('Could not save', err);
    this.toast.show(this.copy.saveFailed);
  }
}
