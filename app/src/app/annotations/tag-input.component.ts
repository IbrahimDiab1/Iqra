import { ChangeDetectionStrategy, Component, ElementRef, computed, input, model, signal, viewChild } from '@angular/core';
import { normalizeTag } from '../books/details/book-details.sheet';
import type { Annotation } from '../core/models';
import { COPY } from '../ui/copy';

const MAX_SUGGESTIONS = 6;

/** Every tag used by live annotations, most used first, then alphabetical. */
export function tagSuggestionsFrom(annotations: readonly Annotation[] | undefined): string[] {
  const counts = new Map<string, number>();
  for (const a of annotations ?? []) {
    if (a.deleted) continue;
    for (const t of a.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([t]) => t);
}

/** Tag chips with a text field. Enter, comma or leaving the field adds the typed tag. */
@Component({
  selector: 'iqra-tag-input',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="box">
      @for (t of tags(); track t) {
        <span class="chip">
          <span dir="auto">{{ t }}</span>
          <button type="button" class="rm" [attr.aria-label]="copy.removeTag(t)" (click)="remove(t)">×</button>
        </span>
      }
      <input
        #field
        type="text"
        dir="auto"
        autocomplete="off"
        [placeholder]="copy.addTag"
        [attr.aria-label]="copy.addTag"
        [value]="text()"
        (input)="text.set(field.value)"
        (keydown)="onKey($event)"
        (blur)="commit()"
      />
    </div>
    @if (shown().length > 0) {
      <div class="sugs" role="group" [attr.aria-label]="copy.suggestedTags">
        @for (s of shown(); track s) {
          <button type="button" class="sug" (mousedown)="$event.preventDefault()" (click)="add(s)">{{ s }}</button>
        }
      </div>
    }
  `,
  styles: `
    :host { display: block; }
    .box { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 4px 8px; border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--surface); }
    .box:focus-within { outline: 2px solid var(--accent); outline-offset: 1px; }
    .chip { display: inline-flex; align-items: center; padding-inline-start: 10px; border-radius: 999px; background: var(--accent-soft); color: var(--fg); font-size: 13px; }
    .rm { min-width: 40px; min-height: 40px; border: 0; background: none; color: inherit; font-size: 18px; cursor: pointer; border-radius: 999px; }
    .rm:focus-visible, .sug:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    input { flex: 1; min-width: 96px; min-height: 40px; border: 0; background: none; color: var(--fg); font: 15px var(--ui); outline: none; }
    .sugs { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
    .sug { min-height: 40px; padding: 0 12px; border: 1px solid var(--line); border-radius: 999px; background: none; color: var(--fg); font: 13px var(--ui); cursor: pointer; }
    .sug:hover { background: var(--accent-soft); }
  `,
})
export class TagInputComponent {
  readonly tags = model<string[]>([]);
  readonly suggestions = input<string[]>([]);

  protected readonly copy = COPY.annotations;
  protected readonly text = signal('');
  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');
  protected readonly shown = computed(() => {
    const prefix = normalizeTag(this.text());
    const have = new Set(this.tags());
    return this.suggestions()
      .filter((s) => !have.has(s) && s.startsWith(prefix))
      .slice(0, MAX_SUGGESTIONS);
  });

  protected onKey(e: KeyboardEvent): void {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      this.commit();
    }
  }

  protected commit(): void {
    this.add(this.text());
  }

  protected add(raw: string): void {
    const tag = normalizeTag(raw);
    this.text.set('');
    const field = this.field();
    if (field) field.nativeElement.value = '';
    if (tag === '' || this.tags().includes(tag)) return;
    this.tags.set([...this.tags(), tag]);
  }

  protected remove(tag: string): void {
    this.tags.set(this.tags().filter((t) => t !== tag));
  }
}
