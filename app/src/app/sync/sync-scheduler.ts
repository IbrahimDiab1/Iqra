import { Injectable, OnDestroy, effect, inject, untracked } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import type { Subscription } from 'rxjs';
import { AuthApi } from '../auth/auth.service';
import { CLOCK } from '../core/clock';
import { Repo } from '../core/repo';
import { SyncEngine } from './sync-engine';

/** A last sync older than this counts as stale: coming back to the tab or opening the Library syncs again. */
export const STALE_MS = 60_000;
/** The background poll while the tab is visible. */
export const POLL_MS = 120_000;
/** The poll after IDLE_PASSES passes in a row that found nothing new. */
export const SLOW_POLL_MS = 300_000;
const IDLE_PASSES = 3;

/**
 * When to sync (spec section 8, Plan 6 item 13). The engine does the work and also syncs 5 s after a local change; this
 * decides the other moments: app start, coming back to the tab (if stale), the connection returning, opening the Library
 * (if stale), leaving the reader, a new token after a lapse, and a slow poll while the tab is visible. The engine shares
 * one pass among callers, and nothing here starts a pass offline, hidden (poll) or without sign-in.
 */
@Injectable({ providedIn: 'root' })
export class SyncScheduler implements OnDestroy {
  private readonly engine = inject(SyncEngine);
  private readonly auth = inject(AuthApi);
  private readonly clock = inject(CLOCK);
  private readonly router = inject(Router);
  private readonly repo = inject(Repo);

  private started = false;
  private pollTimer: ReturnType<typeof setTimeout> | undefined;
  private idle = 0;
  private routerSub: Subscription | null = null;
  private changesSub: Subscription | null = null;
  private seenToken = this.auth.tokenVersion();

  private readonly onVisible = (): void => {
    if (document.visibilityState === 'visible') {
      this.resetBackoff();
      this.armPoll(POLL_MS);
      this.syncIfStale();
    } else {
      clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }
  };
  private readonly onOnline = (): void => {
    this.resetBackoff();
    if (this.canSync()) void this.engine.syncNow().catch(() => undefined);
    else if (this.canTry()) void this.engine.resume().catch(() => undefined);
  };

  constructor() {
    // A new token (silent renewal after a 401, or the Reconnect click) retries a sync that was waiting for it.
    effect(() => {
      const version = this.auth.tokenVersion();
      untracked(() => this.onToken(version));
    });
  }

  /** Starts the engine and the triggers, and syncs once. Calling it again does nothing. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.engine.start();
    document.addEventListener('visibilitychange', this.onVisible);
    window.addEventListener('online', this.onOnline);
    this.routerSub = this.router.events.subscribe((e) => {
      if (!(e instanceof NavigationEnd)) return;
      this.resetBackoff();
      if (e.urlAfterRedirects.split(/[?#]/)[0] === '/library') this.syncIfStale();
    });
    this.changesSub = this.repo.changes$.subscribe(() => this.resetBackoff());
    this.armPoll(POLL_MS);
    void this.engine.resume().catch(() => undefined);
  }

  /** The reader closed: once its position and session are written (or failed), sync at once, stale or not. */
  afterReader(done: Promise<unknown>): void {
    void done
      .catch(() => undefined)
      .then(() => (this.started && this.canSync() ? this.engine.syncNow() : undefined))
      .catch(() => undefined);
  }

  ngOnDestroy(): void {
    clearTimeout(this.pollTimer);
    this.pollTimer = undefined;
    document.removeEventListener('visibilitychange', this.onVisible);
    window.removeEventListener('online', this.onOnline);
    this.routerSub?.unsubscribe();
    this.routerSub = null;
    this.changesSub?.unsubscribe();
    this.changesSub = null;
    this.started = false;
  }

  /** Online and signed in with a live session: a pass would be useful and allowed. */
  private canSync(): boolean {
    return navigator.onLine && this.auth.state() === 'signed-in';
  }

  /** Online and linked to an account (possibly lapsed): a pass may renew the token silently first. */
  private canTry(): boolean {
    return navigator.onLine && this.auth.state() !== 'signed-out';
  }

  private syncIfStale(): void {
    if (!this.started || !this.canTry()) return;
    const last = this.engine.lastSyncedAt();
    if (last === null || this.clock.now() - last >= STALE_MS) void this.engine.resume().catch(() => undefined);
  }

  private onToken(version: number): void {
    if (version === this.seenToken) return;
    this.seenToken = version;
    if (this.started && this.canSync() && this.engine.status() !== 'synced') void this.engine.syncNow().catch(() => undefined);
  }

  /**
   * The owner is active (tab shown, connection back, a page opened, something changed): the poll is quick again. Only a
   * slowed poll is re-armed, so a stream of changes cannot keep pushing a normal poll back.
   */
  private resetBackoff(): void {
    const wasSlow = this.idle >= IDLE_PASSES;
    this.idle = 0;
    if (wasSlow && this.pollTimer !== undefined) this.armPoll(POLL_MS);
  }

  private armPoll(delayMs: number): void {
    clearTimeout(this.pollTimer);
    this.pollTimer = undefined;
    if (!this.started || document.visibilityState !== 'visible') return;
    this.pollTimer = setTimeout(() => void this.poll(), delayMs);
  }

  /** One poll tick. The next one is armed only after this pass ends, so passes never overlap. */
  private async poll(): Promise<void> {
    this.pollTimer = undefined;
    if (document.visibilityState === 'visible' && this.canSync()) {
      try {
        await this.engine.resume();
      } catch {
        // The engine reports its own failures through its status.
      }
      this.idle = this.engine.lastPassChanged ? 0 : this.idle + 1;
    }
    this.armPoll(this.idle >= IDLE_PASSES ? SLOW_POLL_MS : POLL_MS);
  }
}
