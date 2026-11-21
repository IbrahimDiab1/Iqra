import { Injectable, OnDestroy, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import type { Subscription } from 'rxjs';
import { PAGE_RELOAD, reloadOnce } from './chunk-reload';
import { CLOCK } from './clock';

/** An update check on becoming visible is skipped when one ran this recently. */
const CHECK_EVERY_MS = 30_000;

const READER_URL = /^\/read(?:[/?#]|$)/;

/**
 * Keeps an installed app from getting stuck on old code (the usual cause of a phone that never syncs or shows nothing
 * until it is reinstalled; the failed-chunk reload lives in chunk-reload.ts so it needs no lazy chunk): checks for a new version on open and
 * whenever the app comes back to the front, activates it as soon as it is ready and restarts into it at the next quiet
 * moment (a page change, or coming back to the app, never while a book is open), and reloads once when the service worker
 * reports an unrecoverable state.
 */
@Injectable({ providedIn: 'root' })
export class AppUpdateService implements OnDestroy {
  private readonly sw = inject(SwUpdate, { optional: true });
  private readonly router = inject(Router);
  private readonly clock = inject(CLOCK);
  private readonly reload = inject(PAGE_RELOAD);

  private started = false;
  private ready = false;
  private lastCheck = 0;
  private subs: Subscription[] = [];
  private readonly onVisible = (): void => {
    if (document.visibilityState !== 'visible') return;
    this.check();
    this.applyIfQuiet();
  };

  start(): void {
    if (this.started) return;
    this.started = true;
    document.addEventListener('visibilitychange', this.onVisible);
    this.subs.push(
      this.router.events.subscribe((e) => {
        if (e instanceof NavigationEnd) this.applyIfQuiet();
      }),
    );
    const sw = this.sw;
    if (sw?.isEnabled) {
      this.subs.push(
        sw.versionUpdates.subscribe((event) => {
          if (event.type === 'VERSION_READY') void this.activate();
        }),
        sw.unrecoverable.subscribe(() => reloadOnce(this.clock.now(), this.reload)),
      );
      this.check();
    }
  }

  ngOnDestroy(): void {
    document.removeEventListener('visibilitychange', this.onVisible);
    for (const s of this.subs.splice(0)) s.unsubscribe();
    this.started = false;
  }

  private check(): void {
    const sw = this.sw;
    if (!sw?.isEnabled || !navigator.onLine) return;
    const now = this.clock.now();
    if (now - this.lastCheck < CHECK_EVERY_MS) return;
    this.lastCheck = now;
    sw.checkForUpdate().catch(() => false);
  }

  private async activate(): Promise<void> {
    try {
      await this.sw?.activateUpdate();
    } catch {
      return;
    }
    this.ready = true;
    this.applyIfQuiet();
  }

  /** Restarts into the new version unless a book is open. */
  private applyIfQuiet(): void {
    if (!this.ready || READER_URL.test(this.router.url)) return;
    this.ready = false;
    this.reload();
  }
}
