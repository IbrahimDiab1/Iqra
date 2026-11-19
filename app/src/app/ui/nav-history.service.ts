import { Location } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';
import { NavigationCancel, NavigationEnd, NavigationError, NavigationStart, Router } from '@angular/router';

/**
 * Whether there is an earlier app page to go back to, counted from the router's own navigations in this page load.
 * Back arrows use it: with history they step back (so the browser's history stays a straight line instead of
 * growing a Library -> book -> Library -> book loop); without it (a reload or a deep link) they go to the fallback page,
 * replacing the current entry. Created by the app shell so it sees every navigation.
 */
@Injectable({ providedIn: 'root' })
export class NavHistory {
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly depth = signal(0);
  readonly canGoBack = () => this.depth() > 0;

  private seenFirst = false;
  /** The navigation in progress: how it was triggered and whether it replaces the current entry. */
  private current: { trigger: string; replace: boolean; restoredId?: number } | undefined;
  /** The router's id of the history entry now showing. */
  private entryId = 0;

  constructor() {
    this.router.events.subscribe((e) => {
      if (e instanceof NavigationStart) {
        this.current = {
          trigger: e.navigationTrigger ?? 'imperative',
          replace: !!this.router.getCurrentNavigation()?.extras.replaceUrl,
          restoredId: e.restoredState?.navigationId,
        };
      } else if (e instanceof NavigationEnd) {
        this.ended(e.id);
      } else if (e instanceof NavigationCancel || e instanceof NavigationError) {
        this.current = undefined;
      }
    });
  }

  private ended(id: number): void {
    const nav = this.current;
    this.current = undefined;
    if (!nav) return;
    if (nav.trigger === 'popstate' && nav.restoredId !== undefined) {
      // A browser Back or Forward: the restored entry's id says which way it went.
      this.depth.update((d) => (nav.restoredId! < this.entryId ? Math.max(0, d - 1) : d + 1));
      this.entryId = nav.restoredId;
      return;
    }
    if (this.seenFirst && !nav.replace) this.depth.update((d) => d + 1);
    this.seenFirst = true;
    this.entryId = id;
  }

  /** Back to the previous app page when there is one, else to `fallback` (replacing the current entry). */
  back(fallback: string): void {
    if (this.canGoBack()) this.location.back();
    else void this.router.navigateByUrl(fallback, { replaceUrl: true });
  }
}
