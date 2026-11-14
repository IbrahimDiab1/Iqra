import { Component, HostListener, inject, signal } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { FilesService } from './files.service';
import { COPY } from '../ui/copy';
import { SheetComponent } from '../ui/sheet.component';
import { icon, IconName } from '../ui/icons';

const MIB = 1024 * 1024;

/** Asks how to open a book that is not on this device: stream it or download it. */
@Component({
  imports: [SheetComponent],
  selector: 'iqra-open-book-sheet',
  template: `
    @let b = book();
    <f-sheet [open]="!!b" [title]="copy.title" (closed)="files.closeOpenSheet()">
      @if (b) {
        <div class="options">
          <button type="button" class="option" [disabled]="offline()" (click)="files.stream(b)">
            <span class="icon" [innerHTML]="iconMarkup('pageview')"></span>
            <span class="text">
              <span class="label">{{ copy.stream }}</span>
              <span class="hint">{{ copy.streamHint }}</span>
            </span>
          </button>

          @let p = progressOf(b.id);
          <button type="button" class="option" [disabled]="offline() || p !== null" (click)="files.download(b)">
            <span class="icon" [innerHTML]="iconMarkup('download')"></span>
            <span class="text">
              <span class="label">{{ copy.download }}</span>
              @if (p !== null) {
                <span class="hint">{{ copy.downloading(percent(p)) }}</span>
                <span
                  class="bar"
                  role="progressbar"
                  aria-valuemin="0"
                  aria-valuemax="100"
                  [attr.aria-valuenow]="percent(p)"
                >
                  <span [style.width.%]="percent(p)"></span>
                </span>
              } @else {
                <span class="hint" dir="auto">{{ copy.downloadHint(sizeMb(b)) }}</span>
              }
            </span>
          </button>
        </div>

        @if (offline()) {
          <p class="offline">{{ copy.offline }}</p>
        }
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
    .option:disabled { opacity: 0.5; }
    .icon { flex: none; color: var(--accent); padding-top: 2px; }
    .text { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1; }
    .label { font-size: 15px; font-weight: 600; }
    .hint { font-size: 13px; color: var(--muted); }
    .bar {
      display: block;
      height: 4px;
      margin-top: 6px;
      border-radius: 4px;
      background: var(--line);
      overflow: hidden;
    }
    .bar span { display: block; height: 100%; background: var(--accent); transition: width 0.2s; }
    .offline { margin: 12px 0 0; font-size: 13px; color: var(--muted); }
    @media (prefers-reduced-motion: reduce) {
      .bar span { transition: none; }
    }
  `,
})
export class OpenBookSheetComponent {
  protected readonly files = inject(FilesService);
  protected readonly copy = COPY.open;
  protected readonly book = this.files.openSheetBook;
  private readonly sanitizer = inject(DomSanitizer);
  protected readonly offline = signal(!navigator.onLine);

  @HostListener('window:online')
  @HostListener('window:offline')
  protected onConnectionChange(): void {
    this.offline.set(!navigator.onLine);
  }

  protected progressOf(id: string): number | null {
    return this.files.downloadProgress().get(id) ?? null;
  }

  protected percent(fraction: number): number {
    return Math.round(fraction * 100);
  }

  protected sizeMb(b: { sizeBytes: number }): string {
    return (b.sizeBytes / MIB).toFixed(1);
  }

  /** Icon markup comes from the static ICON table in icons.ts, so it is safe to trust. */
  protected iconMarkup(name: IconName) {
    return this.sanitizer.bypassSecurityTrustHtml(icon(name, 24));
  }
}
