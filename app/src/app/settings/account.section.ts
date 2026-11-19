import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthApi } from '../auth/auth.service';
import { DB } from '../core/db';
import { getDevicePref, setDevicePref } from '../core/device-prefs';
import { SyncEngine } from '../sync/sync-engine';
import { COPY } from '../ui/copy';
import { SheetComponent } from '../ui/sheet.component';
import { ToastService } from '../ui/toast.service';
import { CLEAR_DEVICE, FULL_RELOAD } from './clear-device';
import { SETTINGS_COPY } from './settings-copy';

/** Who is signed in, sync controls and sign-out. */
@Component({
  selector: 'iqra-account-section',
  imports: [SheetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let p = auth.profile();
    <div class="row who">
      <span class="name" dir="auto">{{ p?.name }}</span>
      <span class="email" dir="auto">{{ p?.email }}</span>
    </div>

    <div class="row">
      <div class="grow">
        <p class="status" role="status" data-testid="sync-status">{{ statusText() }}</p>
        <p class="sub" data-testid="last-synced">{{ lastSyncedText() }}</p>
        @if (sync.lastError(); as err) {
          <p class="sub err" dir="auto">{{ err }}</p>
        }
      </div>
      <button type="button" class="btn" data-testid="sync-now" [disabled]="syncing()" (click)="syncNow()">
        {{ syncing() ? c.syncing : c.syncNow }}
      </button>
    </div>

    <label class="row toggle">
      <span class="grow">
        <span class="lbl">{{ c.syncMobile }}</span>
        <span class="sub">{{ c.syncMobileHint }}</span>
      </span>
      <input type="checkbox" role="switch" [checked]="mobile()" (change)="setMobile($event)" />
    </label>

    <div class="row">
      <button type="button" class="btn danger" data-testid="sign-out" (click)="confirming.set(true)">{{ c.signOut }}</button>
    </div>

    <f-sheet [open]="confirming()" [title]="c.confirmTitle" (closed)="cancel()">
      <p class="body">{{ c.confirmBody }}</p>
      <label class="check">
        <input type="checkbox" data-testid="clear-device" [checked]="clear()" (change)="clear.set($any($event.target).checked)" />
        <span class="grow">
          <span class="lbl">{{ c.clearLabel }}</span>
          <span class="sub">{{ c.clearHint }}</span>
        </span>
      </label>
      <div sheet-foot class="foot-row">
        <button type="button" class="btn" data-testid="cancel-sign-out" (click)="cancel()">{{ c.cancel }}</button>
        <span class="spacer"></span>
        <button type="button" class="btn danger solid" data-testid="confirm-sign-out" [disabled]="working()" (click)="confirm()">{{ c.confirm }}</button>
      </div>
    </f-sheet>
  `,
  styles: `
    :host { display: block; }
    .row { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-top: 1px solid var(--line); }
    .row:first-child { border-top: 0; }
    .who { flex-direction: column; align-items: flex-start; gap: 2px; }
    .name { font-weight: 600; font-size: 16px; }
    .email, .sub { display: block; font-size: 13px; color: var(--muted); margin: 0; }
    .err { color: var(--danger); }
    .status { margin: 0; font-size: 14px; }
    .grow { flex: 1; min-width: 0; }
    .lbl { display: block; font-size: 15px; }
    .toggle { cursor: pointer; }
    .toggle input { width: 40px; height: 24px; flex: none; accent-color: var(--accent); }
    .btn { min-height: 40px; padding: 0 14px; border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--surface); color: var(--fg); font: 600 14px var(--ui); cursor: pointer; }
    .btn:disabled { opacity: .55; cursor: default; }
    .btn.danger { color: var(--danger); }
    .btn.solid { background: var(--danger); border-color: var(--danger); color: var(--accent-fg); }
    .btn:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .body { margin: 0 0 14px; font-size: 15px; }
    .check { display: flex; gap: 12px; align-items: flex-start; min-height: 40px; cursor: pointer; }
    .check input { width: 22px; height: 22px; margin-top: 2px; flex: none; accent-color: var(--accent); }
    .foot-row { display: flex; align-items: center; gap: 8px; width: 100%; }
    .spacer { flex: 1; }
  `,
})
export class AccountSection {
  protected readonly auth = inject(AuthApi);
  protected readonly sync = inject(SyncEngine);
  private readonly db = inject(DB);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly clearDevice = inject(CLEAR_DEVICE);
  private readonly fullReload = inject(FULL_RELOAD);

  protected readonly c = SETTINGS_COPY.account;
  protected readonly mobile = signal(getDevicePref('syncOnMobile', true));
  protected readonly syncing = signal(false);
  protected readonly confirming = signal(false);
  protected readonly clear = signal(false);
  protected readonly working = signal(false);

  protected readonly statusText = computed(() => COPY.sync[this.sync.status()]);
  protected readonly lastSyncedText = computed(() => {
    const at = this.sync.lastSyncedAt();
    if (at === null) return this.c.neverSynced;
    return this.c.lastSynced(new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(at));
  });

  protected async syncNow(): Promise<void> {
    this.syncing.set(true);
    try {
      await this.sync.syncNow();
    } finally {
      this.syncing.set(false);
    }
  }

  protected setMobile(event: Event): void {
    const on = (event.target as HTMLInputElement).checked;
    this.mobile.set(on);
    setDevicePref('syncOnMobile', on);
  }

  protected cancel(): void {
    if (this.working()) return;
    this.confirming.set(false);
    this.clear.set(false);
  }

  /** Signs out, and when asked removes this device's data. Drive is never touched. */
  protected async confirm(): Promise<void> {
    if (this.working()) return;
    this.working.set(true);
    const wipe = this.clear();
    try {
      this.auth.signOut();
      if (!wipe) {
        this.confirming.set(false);
        await this.router.navigate(['/welcome']);
        return;
      }
      this.sync.ngOnDestroy();
      await this.clearDevice(this.db);
      this.fullReload('/welcome');
    } catch {
      this.toast.show(this.c.clearFailed);
      this.confirming.set(false);
      await this.router.navigate(['/welcome']);
    } finally {
      this.working.set(false);
    }
  }
}
