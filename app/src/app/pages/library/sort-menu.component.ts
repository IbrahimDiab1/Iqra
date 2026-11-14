import { Component, input, output } from '@angular/core';
import { SheetComponent } from '../../ui/sheet.component';
import { COPY } from '../../ui/copy';
import type { SortKey, LibraryState } from '../../books/library/library-query';
import { SORTS, sortHasDirection } from './library-state';

/** The Sort sheet: one row per sort key. The current key shows its direction. */
@Component({
  selector: 'iqra-sort-menu',
  imports: [SheetComponent],
  template: `
    <f-sheet [open]="open()" [title]="copy.sortBy" (closed)="closed.emit()">
      <ul class="menu">
        @for (key of keys; track key) {
          <li>
            <button
              type="button"
              class="opt"
              [attr.aria-current]="key === sort() ? 'true' : null"
              (click)="choose.emit(key)"
            >
              <span>{{ labels[key] }}</span>
              @if (key === sort() && hasDirection(key)) {
                <span class="arrow" aria-hidden="true">{{ dir() === 'desc' ? '↓' : '↑' }}</span>
              }
            </button>
          </li>
        }
      </ul>
    </f-sheet>
  `,
  styles: `
    .menu { margin: 0; padding: 0; list-style: none; }
    .opt {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      width: 100%;
      min-height: 48px;
      padding: 10px 12px;
      border: 0;
      border-radius: var(--radius-control);
      background: none;
      font-size: 15px;
      text-align: start;
    }
    .opt:hover { background: var(--surface-2); }
    .opt[aria-current='true'] { color: var(--accent); font-weight: 600; }
    .arrow { font-size: 16px; font-variant-numeric: tabular-nums; }
  `,
})
export class SortMenuComponent {
  readonly open = input(false);
  readonly sort = input.required<SortKey>();
  readonly dir = input.required<LibraryState['dir']>();
  readonly choose = output<SortKey>();
  readonly closed = output<void>();

  protected readonly copy = COPY.library;
  protected readonly labels = COPY.sort;
  protected readonly keys = SORTS;
  protected readonly hasDirection = sortHasDirection;
}
