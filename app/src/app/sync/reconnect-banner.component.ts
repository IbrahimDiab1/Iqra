import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs';
import { AuthApi } from '../auth/auth.service';
import { COPY } from '../ui/copy';

/** The reader and the welcome screen stay free of it: reading works offline, and welcome has its own sign-in. */
const QUIET_ROUTE = /^\/(welcome|read)(?:[/?#]|$)/;

/**
 * The one bar that asks the owner to sign in again, shown only when the session has really lapsed (silent renewal
 * failed and the token ran out). Non-modal and persistent; one click opens Google's popup (a user gesture) and the
 * waiting sync runs by itself afterwards (the SyncScheduler retries on the new token). No toasts.
 */
@Component({
  selector: 'iqra-reconnect-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <div class="banner" role="status">
        <span class="msg">{{ copy.reconnectBanner }}</span>
        <button type="button" class="btn" [disabled]="busy()" (click)="reconnect()">{{ copy.reconnect }}</button>
      </div>
    }
  `,
  styles: `
    :host { display: block; }
    .banner {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 8px var(--gutter, 16px); border-bottom: 1px solid var(--line);
      background: var(--surface-2); color: var(--fg); font-size: 14px;
    }
    .msg { min-width: 0; }
    .btn {
      flex: none; min-width: 40px; min-height: 40px; padding: 0 16px; border: 1px solid var(--accent); border-radius: var(--radius-control);
      background: var(--accent); color: var(--accent-fg); font: 600 14px var(--ui); cursor: pointer;
    }
    .btn:disabled { opacity: 0.6; cursor: default; }
    .btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  `,
})
export class ReconnectBannerComponent {
  private readonly auth = inject(AuthApi);
  private readonly router = inject(Router);
  protected readonly copy = COPY.sync;
  protected readonly busy = signal(false);

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );
  private readonly online = signal(navigator.onLine);
  /** Only when the session really lapsed (a silent renewal failed online), never offline, never on quiet routes. */
  protected readonly visible = computed(() => this.auth.lapsed() && this.online() && !QUIET_ROUTE.test(this.url()));

  constructor() {
    const sync = (): void => this.online.set(navigator.onLine);
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    });
  }

  protected async reconnect(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await this.auth.reconnect();
    } catch {
      // The popup was closed or failed: the bar stays, and no toast piles on.
    } finally {
      this.busy.set(false);
    }
  }
}
