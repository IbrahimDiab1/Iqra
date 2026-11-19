import { Component, effect, input, output, signal, untracked } from '@angular/core';
import { COPY } from '../../ui/copy';
import { SheetComponent } from '../../ui/sheet.component';
import type { FilterValue } from './library-state';

const RATING_STEPS: readonly (number | null)[] = [null, 5, 6, 7, 8, 9];

function copyOf(value: FilterValue): FilterValue {
  return { tags: [...value.tags], minRating: value.minRating, downloadedOnly: value.downloadedOnly };
}

function toggled<T>(list: readonly T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

/**
 * The Filter sheet. Edits a draft that starts from `value` each time the sheet opens.
 * Show books commits the draft; closing without it discards it.
 */
@Component({
  selector: 'iqra-filter-sheet',
  imports: [SheetComponent],
  template: `
    <f-sheet [open]="open()" [title]="filterCopy.title" (closed)="closed.emit()">
      @if (tags().length > 0) {
        <h4 class="label">{{ filterCopy.tags }}</h4>
        <div class="chips">
          @for (tag of tags(); track tag) {
            <button
              type="button"
              class="chip"
              [attr.aria-pressed]="draft().tags.includes(tag)"
              (click)="toggleTag(tag)"
            >#{{ tag }}</button>
          }
        </div>
      }

      <h4 class="label">{{ filterCopy.minRating }}</h4>
      <div class="chips">
        @for (step of ratingSteps; track step) {
          <button
            type="button"
            class="chip"
            [attr.aria-pressed]="draft().minRating === step"
            (click)="setRating(step)"
          >{{ step === null ? filterCopy.any : step + '+' }}</button>
        }
      </div>

      <div class="switch-row">
        <span id="filter-downloaded-label">{{ filterCopy.downloadedOnly }}</span>
        <button
          type="button"
          role="switch"
          class="switch"
          aria-labelledby="filter-downloaded-label"
          [attr.aria-checked]="draft().downloadedOnly"
          (click)="toggleDownloaded()"
        ></button>
      </div>

      <div sheet-foot class="foot">
        <button type="button" class="btn-ghost" (click)="reset()">{{ filterCopy.reset }}</button>
        <span class="spacer"></span>
        <button type="button" class="btn-primary" (click)="commit()">{{ filterCopy.apply }}</button>
      </div>
    </f-sheet>
  `,
  styles: `
    .label {
      margin: 14px 0 8px;
      color: var(--muted);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.07em;
      text-transform: uppercase;
    }
    .chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .chip {
      max-width: 100%;
      min-height: 40px;
      padding: 6px 12px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: var(--surface);
      font-size: 13px;
      overflow-wrap: anywhere;
    }
    .chip[aria-pressed='true'] { background: var(--fg); border-color: var(--fg); color: var(--surface); }
    .switch-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-top: 18px;
      font-size: 14px;
    }
    /* The button is 40px tall for touch; the 26px track is drawn inside it. */
    .switch {
      position: relative;
      flex: none;
      width: 44px;
      height: 40px;
      padding: 0;
      border: 0;
      background: none;
    }
    .switch::before {
      content: '';
      position: absolute;
      inset-inline: 0;
      top: 7px;
      height: 26px;
      border-radius: 999px;
      background: var(--line);
      transition: background 0.2s;
    }
    .switch::after {
      content: '';
      position: absolute;
      top: 10px;
      inset-inline-start: 3px;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: var(--surface);
      box-shadow: 0 1px 3px color-mix(in srgb, var(--fg) 25%, transparent);
      transition: transform 0.2s;
    }
    .switch[aria-checked='true']::before { background: var(--accent); }
    .switch[aria-checked='true']::after { transform: translateX(18px); }
    .switch[aria-checked='true']:dir(rtl)::after { transform: translateX(-18px); }
    .foot { display: flex; align-items: center; gap: 6px; width: 100%; }
    .spacer { flex: 1; }
    .btn-primary, .btn-ghost {
      border: 0;
      border-radius: var(--radius-control);
      padding: 10px 16px;
      font-weight: 600;
      white-space: nowrap;
    }
    .btn-primary { background: var(--accent); color: var(--accent-fg); }
    .btn-ghost { background: none; color: var(--muted); }
    .btn-ghost:hover { background: var(--surface-2); color: var(--fg); }
  `,
})
export class FilterSheetComponent {
  readonly open = input(false);
  readonly value = input.required<FilterValue>();
  readonly tags = input<string[]>([]);
  readonly apply = output<FilterValue>();
  readonly closed = output<void>();

  protected readonly copy = COPY.library;
  protected readonly filterCopy = COPY.filter;
  protected readonly ratingSteps = RATING_STEPS;
  protected readonly draft = signal<FilterValue>({ tags: [], minRating: null, downloadedOnly: false });

  constructor() {
    // Each opening starts from the applied filters, so an abandoned draft leaves no trace.
    // Tracks only the open state. A change to `value` while open must not discard the draft.
    effect(() => {
      if (!this.open()) return;
      untracked(() => this.draft.set(copyOf(this.value())));
    });
  }

  protected toggleTag(tag: string): void {
    this.draft.update((d) => ({ ...d, tags: toggled(d.tags, tag) }));
  }

  protected setRating(step: number | null): void {
    this.draft.update((d) => ({ ...d, minRating: step }));
  }

  protected toggleDownloaded(): void {
    this.draft.update((d) => ({ ...d, downloadedOnly: !d.downloadedOnly }));
  }

  protected reset(): void {
    this.draft.set({ tags: [], minRating: null, downloadedOnly: false });
  }

  protected commit(): void {
    this.apply.emit(copyOf(this.draft()));
  }
}
