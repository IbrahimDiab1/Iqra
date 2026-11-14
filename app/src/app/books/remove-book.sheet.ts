import { Component, inject } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { FilesService } from './files.service';
import { COPY } from '../ui/copy';
import { SheetComponent } from '../ui/sheet.component';
import { icon, IconName } from '../ui/icons';

/** Asks whether to remove a book's PDF from this device, or delete the book everywhere. */
@Component({
  imports: [SheetComponent],
  selector: 'iqra-remove-book-sheet',
  template: `
    @let b = book();
    <f-sheet [open]="!!b" [title]="copy.title" (closed)="files.closeRemoveSheet()">
      @if (b) {
        <div class="options">
          @if (files.downloaded().has(b.id)) {
            <button type="button" class="option" (click)="files.removeLocal(b)">
              <span class="icon" [innerHTML]="iconMarkup('trash')"></span>
              <span class="text">
                <span class="label">{{ copy.device }}</span>
                <span class="hint">{{ copy.deviceHint }}</span>
              </span>
            </button>
          }
          <button type="button" class="option danger" (click)="files.deleteEverywhere(b)">
            <span class="icon" [innerHTML]="iconMarkup('trash')"></span>
            <span class="text">
              <span class="label">{{ copy.everywhere }}</span>
              <span class="hint">{{ copy.everywhereHint }}</span>
            </span>
          </button>
        </div>
      }
    </f-sheet>
  `,
  styles: `
    .options { display: grid; gap: 10px; }
    .option {
      display: flex;
      align-items: flex-start;
      gap: 14px;
      width: 100%;
      min-height: 64px;
      padding: 14px 16px;
      border: 1px solid var(--line);
      border-radius: var(--radius-card);
      background: var(--surface-2);
      color: var(--fg);
      text-align: start;
    }
    .icon { flex: none; color: var(--muted); padding-top: 2px; }
    .text { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1; }
    .label { font-size: 15px; font-weight: 600; }
    .hint { font-size: 13px; color: var(--muted); }
    .danger, .danger .icon { color: var(--danger); }
  `,
})
export class RemoveBookSheetComponent {
  protected readonly files = inject(FilesService);
  protected readonly copy = COPY.remove;
  protected readonly book = this.files.removeSheetBook;
  private readonly sanitizer = inject(DomSanitizer);

  /** Icon markup comes from the static ICON table in icons.ts, so it is safe to trust. */
  protected iconMarkup(name: IconName) {
    return this.sanitizer.bypassSecurityTrustHtml(icon(name, 24));
  }
}
