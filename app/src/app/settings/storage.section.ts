import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FilesService } from '../books/files.service';
import { DB } from '../core/db';
import { Repo } from '../core/repo';
import { DRIVE_ADAPTER } from '../sync/drive-adapter';
import { SETTINGS_COPY } from './settings-copy';
import { deviceSegments, driveSegments, formatBytes, type Segment } from './storage-math';

type Quota = { limit: number; usage: number };
type Estimate = { usage?: number; quota?: number } | null;

/** Drive usage and this device's usage as stacked bars, with a link to manage downloads. */
@Component({
  selector: 'iqra-storage-section',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h3 class="sub-h">{{ c.drive }}</h3>
    @if (state() === 'loading') {
      <p class="muted" data-testid="drive-loading" role="status">{{ c.loading }}</p>
    } @else if (state() === 'error') {
      <p class="err" data-testid="drive-error" role="alert">{{ c.loadFailed }}</p>
      <button type="button" class="btn" data-testid="retry" (click)="load()">{{ c.retry }}</button>
    } @else {
      <p class="summary" data-testid="drive-summary">{{ driveText() }}</p>
      <div class="bar" role="img" [attr.aria-label]="c.barLabel(c.drive)">
        @for (s of drive(); track s.label) {
          <span class="seg" [class]="s.label" [style.width.%]="s.fraction * 100"></span>
        }
      </div>
      <ul class="legend" data-testid="drive-legend">
        @for (s of drive(); track s.label) {
          <li><span class="dot" [class]="s.label"></span>{{ c.legend[s.label] }} <span class="val">{{ fmt(s.bytes) }}</span></li>
        }
      </ul>
    }

    <h3 class="sub-h">{{ c.device }}</h3>
    <div class="bar" role="img" [attr.aria-label]="c.barLabel(c.device)">
      @for (s of device(); track s.label) {
        <span class="seg" [class]="s.label" [style.width.%]="s.fraction * 100"></span>
      }
    </div>
    <ul class="legend" data-testid="device-legend">
      @for (s of device(); track s.label) {
        <li><span class="dot" [class]="s.label"></span>{{ c.legend[s.label] }} <span class="val">{{ fmt(s.bytes) }}</span></li>
      }
      @if (device().length === 0) {
        <li><span class="dot downloads"></span>{{ c.legend.downloads }} <span class="val">{{ fmt(0) }}</span></li>
      }
    </ul>
    <a class="btn link" data-testid="manage-downloads" routerLink="/profile/downloads">{{ c.manage }}</a>
  `,
  styles: `
    :host { display: block; }
    .sub-h { margin: 14px 0 6px; font-size: 14px; font-weight: 600; }
    .sub-h:first-child { margin-top: 0; }
    .muted, .summary { margin: 0 0 8px; font-size: 13px; color: var(--muted); }
    .err { margin: 0 0 8px; font-size: 14px; color: var(--danger); }
    .bar { display: flex; height: 12px; border-radius: 6px; overflow: hidden; background: var(--surface-2); border: 1px solid var(--line); }
    .seg { display: block; height: 100%; min-width: 0; }
    .seg.books, .seg.downloads { background: var(--accent); }
    .seg.other, .seg.data, .seg.app { background: var(--warn); }
    .seg.free { background: transparent; }
    .legend { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 13px; }
    .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-inline-end: 6px; background: var(--line); border: 1px solid var(--line); }
    .dot.books, .dot.downloads { background: var(--accent); border-color: var(--accent); }
    .dot.other, .dot.data, .dot.app { background: var(--warn); border-color: var(--warn); }
    .val { color: var(--muted); margin-inline-start: 2px; }
    .btn { display: inline-flex; align-items: center; min-height: 40px; margin-top: 12px; padding: 0 14px; border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--surface); color: var(--fg); font: 600 14px var(--ui); cursor: pointer; text-decoration: none; }
    .btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    @media (prefers-reduced-motion: no-preference) { .seg { transition: width 200ms; } }
  `,
})
export class StorageSection implements OnInit {
  private readonly db = inject(DB);
  private readonly repo = inject(Repo);
  private readonly driveApi = inject(DRIVE_ADAPTER);
  private readonly files = inject(FilesService);

  protected readonly c = SETTINGS_COPY.storage;
  protected readonly fmt = formatBytes;

  private readonly books = this.repo.live(() => this.db.books.filter((b) => !b.deleted).toArray());
  private readonly quota = signal<Quota | null>(null);
  private readonly estimate = signal<Estimate>(null);
  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');

  private readonly booksBytes = computed(() => (this.books() ?? []).reduce((n, b) => n + (Number.isFinite(b.sizeBytes) ? b.sizeBytes : 0), 0));
  private readonly downloadedBytes = computed(() => {
    const ids = this.files.downloaded();
    return (this.books() ?? []).filter((b) => ids.has(b.id)).reduce((n, b) => n + (Number.isFinite(b.sizeBytes) ? b.sizeBytes : 0), 0);
  });

  protected readonly drive = computed<Segment[]>(() => {
    const q = this.quota();
    return q ? driveSegments(q, this.booksBytes()) : [];
  });
  protected readonly device = computed<Segment[]>(() => deviceSegments(this.estimate(), this.downloadedBytes()));
  protected readonly driveText = computed(() => {
    const q = this.quota();
    if (!q) return '';
    const used = formatBytes(q.usage);
    return this.c.driveSummary(used, Number.isFinite(q.limit) && q.limit > 0 ? formatBytes(q.limit) : null);
  });

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.state.set('loading');
    void this.loadEstimate();
    try {
      this.quota.set(await this.driveApi.storageQuota());
      this.state.set('ready');
    } catch {
      this.state.set('error');
    }
  }

  private async loadEstimate(): Promise<void> {
    try {
      const est = await navigator.storage?.estimate?.();
      this.estimate.set(est ?? null);
    } catch {
      this.estimate.set(null);
    }
  }
}
