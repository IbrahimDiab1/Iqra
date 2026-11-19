import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { SheetComponent } from '../ui/sheet.component';
import { CHROME_COPY } from './chrome-copy';
import { SHORTCUT_LIST } from './shortcuts';

/** The `?` cheat-sheet: a small modal listing the reader's keys. */
@Component({
  selector: 'iqra-shortcut-help',
  imports: [SheetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <f-sheet [open]="open()" [title]="chrome.shortcutsTitle" (closed)="closed.emit()">
      @if (open()) {
        <dl class="keys">
          @for (row of rows; track row.label) {
            <div class="key-row">
              <dt>{{ row.label }}</dt>
              <dd><kbd>{{ row.keys }}</kbd></dd>
            </div>
          }
        </dl>
      }
    </f-sheet>
  `,
  styles: `
    .keys { margin: 0; }
    .key-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 40px; border-bottom: 1px solid var(--line); }
    dt { font-size: 14px; }
    dd { margin: 0; }
    kbd { padding: 2px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface-2); font: 12.5px var(--ui); white-space: nowrap; }
  `,
})
export class ShortcutHelpComponent {
  readonly open = input(false);
  readonly closed = output<void>();
  protected readonly chrome = CHROME_COPY;
  protected readonly rows = SHORTCUT_LIST;
}
