import { Component, computed, inject, signal } from '@angular/core';
import { AuthApi } from '../auth/auth.service';
import { COPY } from '../ui/copy';
import { SyncEngine } from './sync-engine';

/** The sync status line. Paused and error states are buttons: reconnect, or retry. */
@Component({
  selector: 'iqra-sync-status',
  template: `
    @if (actionable()) {
      <button type="button" class="status" [attr.data-status]="sync.status()" [disabled]="busy()" (click)="act()">
        <span class="dot" aria-hidden="true"></span>
        <span>{{ text() }}</span>
      </button>
    } @else {
      <p class="status" role="status" [attr.data-status]="sync.status()">
        <span class="dot" aria-hidden="true"></span>
        <span>{{ text() }}</span>
      </p>
    }
  `,
  styles: `
    :host { display: block; }
    .status {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0;
      padding: 8px 0;
      border: 0;
      background: none;
      color: var(--muted);
      font: inherit;
      font-size: 13px;
      text-align: start;
    }
    button.status { cursor: pointer; }
    button.status:disabled { cursor: default; opacity: 0.6; }
    .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: var(--muted); }
    [data-status='saving'] .dot { background: var(--accent); }
    [data-status='synced'] .dot { background: var(--ok); }
    [data-status='paused'] .dot { background: var(--warn); }
    [data-status='error'] .dot { background: var(--danger); }
    [data-status='paused'], [data-status='error'] { color: var(--fg); }
  `,
})
export class SyncStatusComponent {
  protected readonly sync = inject(SyncEngine);
  private readonly auth = inject(AuthApi);

  protected readonly busy = signal(false);
  protected readonly text = computed(() => COPY.sync[this.sync.status()]);
  protected readonly actionable = computed(() => {
    const status = this.sync.status();
    return status === 'paused' || status === 'error';
  });

  /** Paused: reconnect, then sync. Error: sync again. */
  protected async act(): Promise<void> {
    this.busy.set(true);
    try {
      if (this.sync.status() === 'paused') await this.auth.reconnect();
      await this.sync.syncNow();
    } catch {
      // The reconnect popup was closed or failed: stay paused.
    } finally {
      this.busy.set(false);
    }
  }
}
