import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { BackLinkDirective } from '../ui/back-link.directive';
import { FilesService } from '../books/files.service';
import { DB } from '../core/db';
import type { Book } from '../core/models';
import { Repo } from '../core/repo';
import { icon } from '../ui/icons';
import { SheetComponent } from '../ui/sheet.component';
import { SETTINGS_COPY } from './settings-copy';
import { formatBytes } from './storage-math';

/** Books whose PDF is kept on this device, largest first, with a way to remove each or all. */
@Component({
  selector: 'iqra-downloads-page',
  imports: [BackLinkDirective, SheetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      <header class="hdr">
        <a class="back" iqraBack="/settings" [attr.aria-label]="c.back" [innerHTML]="backIcon"></a>
        <h1>{{ c.title }}</h1>
      </header>

      @if (rows().length === 0) {
        <p class="empty" data-testid="dl-empty">{{ c.empty }}</p>
      } @else {
        <div class="total-row">
          <span class="total" data-testid="dl-total">{{ c.total(fmt(totalBytes())) }}</span>
          <button type="button" class="btn danger" data-testid="remove-all" (click)="confirming.set(true)">{{ c.removeAll }}</button>
        </div>
        <ul class="list">
          @for (b of rows(); track b.id) {
            <li class="row" [attr.data-book]="b.id">
              <div class="info">
                <span class="title" dir="auto" data-testid="dl-title">{{ b.title }}</span>
                <span class="meta"><span data-testid="dl-size">{{ fmt(b.sizeBytes) }}</span> · {{ opened(b) }}</span>
              </div>
              <button type="button" class="btn" data-testid="dl-remove" [attr.aria-label]="c.removeOne(b.title)" (click)="remove(b)">{{ c.remove }}</button>
            </li>
          }
        </ul>
      }

      <f-sheet [open]="confirming()" [title]="c.confirmTitle" (closed)="confirming.set(false)">
        <p class="body">{{ c.confirmBody }}</p>
        <div sheet-foot class="foot-row">
          <button type="button" class="btn" data-testid="cancel-remove-all" (click)="confirming.set(false)">{{ c.cancel }}</button>
          <span class="spacer"></span>
          <button type="button" class="btn danger solid" data-testid="confirm-remove-all" (click)="removeAll()">{{ c.confirm }}</button>
        </div>
      </f-sheet>
    </section>
  `,
  styles: `
    .page { padding: 16px var(--gutter) 24px; max-width: 720px; margin: 0 auto; }
    .hdr { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    h1 { margin: 0; font-family: var(--book); font-size: 28px; font-weight: 600; }
    .back { display: grid; place-items: center; width: 40px; height: 40px; border-radius: var(--radius-control); color: var(--fg); }
    .back:hover { background: var(--surface-2); }
    .back:focus-visible, .btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .empty { margin: 24px 0; font-size: 15px; color: var(--muted); }
    .total-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 0; }
    .total { font-size: 14px; color: var(--muted); }
    .list { list-style: none; margin: 0; padding: 0; }
    .row { display: flex; align-items: center; gap: 12px; min-height: 56px; padding: 8px 0; border-top: 1px solid var(--line); }
    .info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .title { font-size: 15px; font-weight: 600; overflow-wrap: anywhere; }
    .meta { font-size: 13px; color: var(--muted); }
    .btn { min-height: 40px; padding: 0 14px; border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--surface); color: var(--fg); font: 600 14px var(--ui); cursor: pointer; }
    .btn.danger { color: var(--danger); }
    .btn.solid { background: var(--danger); border-color: var(--danger); color: var(--accent-fg); }
    .body { margin: 0; font-size: 15px; }
    .foot-row { display: flex; align-items: center; gap: 8px; width: 100%; }
    .spacer { flex: 1; }
  `,
})
export class DownloadsPage {
  private readonly db = inject(DB);
  private readonly repo = inject(Repo);
  private readonly files = inject(FilesService);

  protected readonly c = SETTINGS_COPY.downloads;
  protected readonly fmt = formatBytes;
  protected readonly confirming = signal(false);
  protected readonly backIcon = inject(DomSanitizer).bypassSecurityTrustHtml(icon('back', 22));

  private readonly books = this.repo.live(() => this.db.books.filter((b) => !b.deleted).toArray());

  protected readonly rows = computed<Book[]>(() => {
    const ids = this.files.downloaded();
    return (this.books() ?? []).filter((b) => ids.has(b.id)).sort((a, b) => b.sizeBytes - a.sizeBytes || a.title.localeCompare(b.title));
  });
  protected readonly totalBytes = computed(() => this.rows().reduce((n, b) => n + (Number.isFinite(b.sizeBytes) ? b.sizeBytes : 0), 0));

  protected opened(b: Book): string {
    return b.lastOpenedAt ? this.c.lastOpened(new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(b.lastOpenedAt)) : this.c.neverOpened;
  }

  /** FilesService keeps books that are still uploading and shows its own toast. */
  protected remove(b: Book): void {
    void this.files.removeLocal(b);
  }

  /** Removes every download that is safely on Drive; PDFs still uploading stay. */
  protected async removeAll(): Promise<void> {
    this.confirming.set(false);
    for (const b of this.rows().filter((x) => x.driveFileId !== '')) await this.files.removeLocal(b);
  }
}
