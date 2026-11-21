import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { BACKUP_TABLES, buildBackup, mergeInto, parseBackup, type BackupTables } from '../data/backup';
import { exportNotes, exportReview } from '../data/export-markdown';
import { zipFiles } from '../data/zip';
import { CLOCK } from '../core/clock';
import { DB } from '../core/db';
import type { Annotation, Book, SyncRecord, TableName } from '../core/models';
import { Repo } from '../core/repo';
import { shardFor } from '../sync/shards';
import { SyncEngine } from '../sync/sync-engine';
import { SheetComponent } from '../ui/sheet.component';
import { ToastService } from '../ui/toast.service';
import { SETTINGS_COPY } from './settings-copy';

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const COUNTED = ['books', 'annotations', 'categories', 'goals', 'sessions', 'review'] as const;

/** Local calendar date as YYYY-MM-DD. */
function dateStamp(ms: number): string {
  const d = new Date(ms);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

/** Hands a file to the browser's download. */
function saveFile(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Export notes as Markdown, back up everything, and restore from a backup file. */
@Component({
  selector: 'iqra-data-section',
  imports: [SheetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="row">
      <div class="grow">
        <span class="lbl">{{ c.exportNotes }}</span>
        <span class="sub">{{ c.exportHint }}</span>
      </div>
      <button type="button" class="btn" data-testid="export-notes" [disabled]="busy()" (click)="exportNotes()">{{ c.exportNotes }}</button>
    </div>
    <div class="row">
      <div class="grow">
        <span class="lbl">{{ c.backup }}</span>
        <span class="sub">{{ c.backupHint }}</span>
      </div>
      <button type="button" class="btn" data-testid="backup" [disabled]="busy()" (click)="backup()">{{ c.backup }}</button>
    </div>
    <div class="row">
      <div class="grow">
        <span class="lbl">{{ c.restore }}</span>
        <span class="sub">{{ c.restoreHint }}</span>
        @if (error(); as e) {
          <span class="sub err" role="alert" data-testid="restore-error">{{ e }}</span>
        }
      </div>
      <button type="button" class="btn" data-testid="restore" [disabled]="busy()" (click)="fileInput.click()">{{ c.restore }}</button>
      <input #fileInput type="file" accept=".json,application/json" hidden data-testid="restore-input" (change)="picked($event)" />
    </div>

    <f-sheet [open]="pending() !== null" [title]="c.restoreTitle" (closed)="cancel()">
      <p class="body" data-testid="restore-counts">{{ c.restoreBody(countsText()) }}</p>
      <div sheet-foot class="foot-row">
        <button type="button" class="btn" data-testid="cancel-restore" (click)="cancel()">{{ c.restoreCancel }}</button>
        <span class="spacer"></span>
        <button type="button" class="btn solid" data-testid="confirm-restore" [disabled]="busy()" (click)="confirm()">{{ c.restoreConfirm }}</button>
      </div>
    </f-sheet>
  `,
  styles: `
    :host { display: block; }
    .row { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-top: 1px solid var(--line); }
    .row:first-child { border-top: 0; }
    .grow { flex: 1; min-width: 0; }
    .lbl { display: block; font-size: 15px; }
    .sub { display: block; font-size: 13px; color: var(--muted); }
    .err { color: var(--danger); margin-top: 4px; }
    .btn { min-height: 40px; padding: 0 14px; border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--surface); color: var(--fg); font: 600 14px var(--ui); cursor: pointer; flex: none; }
    .btn:disabled { opacity: .55; cursor: default; }
    .btn.solid { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
    .btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .body { margin: 0; font-size: 15px; }
    .foot-row { display: flex; align-items: center; gap: 8px; width: 100%; }
    .spacer { flex: 1; }
    @media (max-width: 520px) { .row { flex-wrap: wrap; } .row .btn { width: 100%; } .row .lbl { font-weight: 600; } }
  `,
})
export class DataSection {
  private readonly db = inject(DB);
  private readonly repo = inject(Repo);
  private readonly clock = inject(CLOCK);
  private readonly sync = inject(SyncEngine);
  private readonly toast = inject(ToastService);

  protected readonly c = SETTINGS_COPY.data;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly pending = signal<BackupTables | null>(null);

  protected readonly countsText = computed(() => {
    const tables = this.pending();
    if (!tables) return '';
    const parts = COUNTED.flatMap((t) => {
      const n = tables[t]?.length ?? 0;
      const [one, many] = this.c.counts[t];
      return n > 0 ? [`${n} ${n === 1 ? one : many}`] : [];
    });
    return parts.length > 0 ? parts.join(', ') : this.c.nothingToRestore;
  });

  protected async exportNotes(): Promise<void> {
    await this.guarded(async () => {
      const [books, anns, review] = await Promise.all([this.db.books.toArray(), this.db.annotations.toArray(), this.db.review.toArray()]);
      const files = exportNotes(books as Book[], anns as Annotation[]);
      const saved = exportReview(books as Book[], review);
      if (saved) files.push(saved);
      if (files.length === 0) {
        this.toast.show(this.c.noNotes);
        return;
      }
      const zip = zipFiles(files, new Date(this.clock.now()));
      saveFile(`iqra-notes-${dateStamp(this.clock.now())}.zip`, new Blob([zip as BlobPart], { type: 'application/zip' }));
      this.toast.show(this.c.exported);
    }, this.c.exportFailed);
  }

  protected async backup(): Promise<void> {
    await this.guarded(async () => {
      const tables: BackupTables = {};
      for (const name of BACKUP_TABLES) tables[name] = (await this.db.table(name).toArray()) as SyncRecord[];
      const json = JSON.stringify(buildBackup(tables, this.clock.now()));
      saveFile(`iqra-backup-${dateStamp(this.clock.now())}.json`, new Blob([json], { type: 'application/json' }));
      this.toast.show(this.c.backedUp);
    }, this.c.exportFailed);
  }

  private async guarded(work: () => Promise<void>, failure: string): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await work();
    } catch {
      this.toast.show(failure);
    } finally {
      this.busy.set(false);
    }
  }

  /** Reads the chosen file and, if it is a valid backup, asks for confirmation. Nothing is written yet. */
  protected async picked(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    this.error.set(null);
    this.pending.set(null);
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      this.error.set(this.c.errors['too-large']);
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      this.error.set(this.c.errors['bad-shape']);
      return;
    }
    const result = parseBackup(text);
    if (!result.ok) {
      this.error.set(result.error === 'bad-record' ? this.c.badRecord(result.table, result.index + 1) : this.c.errors[result.error]);
      return;
    }
    this.pending.set(result.tables);
  }

  protected cancel(): void {
    if (!this.busy()) this.pending.set(null);
  }

  /**
   * Merges the backup into every table in one transaction, so a failure leaves nothing half
   * restored. Only records that beat the local ones are written, and their Drive files are
   * marked for upload (applyRemote does not do that itself).
   */
  protected async confirm(): Promise<void> {
    const tables = this.pending();
    if (!tables || this.busy()) return;
    this.busy.set(true);
    try {
      const stores = [...BACKUP_TABLES.map((n) => this.db.table(n)), this.db.syncState];
      await this.db.transaction('rw', stores, async () => {
        const dirty = new Set<string>();
        for (const name of BACKUP_TABLES) {
          const incoming = tables[name];
          if (!incoming || incoming.length === 0) continue;
          const local = (await this.db.table(name).toArray()) as SyncRecord[];
          const fromBackup = new Set(incoming);
          const toWrite = mergeInto(local, incoming).filter((r) => fromBackup.has(r));
          if (toWrite.length === 0) continue;
          await this.repo.applyRemote(name as TableName, toWrite);
          for (const r of toWrite) dirty.add(shardFor(name, r));
        }
        for (const shard of dirty) {
          const existing = await this.db.syncState.get(shard);
          await this.db.syncState.put({ ...existing, shard, dirty: true });
        }
      });
      this.pending.set(null);
      this.toast.show(this.c.restored);
      await this.sync.syncNow();
    } catch {
      this.pending.set(null);
      this.error.set(this.c.restoreFailed);
    } finally {
      this.busy.set(false);
    }
  }
}
