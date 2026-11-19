import { Location } from '@angular/common';
import { Directive, computed, inject, input } from '@angular/core';
import { NavHistory } from './nav-history.service';

/**
 * A back arrow: a link to `iqraBack` (the page to fall back to) whose plain click goes back through the history when
 * there is an app page behind, so the browser history is not filled with pages it just left. `iqraBackBefore` runs
 * first (the reader saves its position there). Ctrl/Cmd/Shift/middle clicks are left to the browser.
 */
@Directive({
  selector: 'a[iqraBack]',
  host: { '[attr.href]': 'href()', '(click)': 'onClick($event)' },
})
export class BackLinkDirective {
  readonly fallback = input.required<string>({ alias: 'iqraBack' });
  readonly before = input<(() => Promise<unknown>) | null>(null, { alias: 'iqraBackBefore' });

  private readonly nav = inject(NavHistory);
  private readonly location = inject(Location);
  protected readonly href = computed(() => this.location.prepareExternalUrl(this.fallback()));

  protected onClick(e: MouseEvent): void {
    if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    void this.go();
  }

  private async go(): Promise<void> {
    try {
      await this.before()?.();
    } catch (err) {
      console.warn('Could not finish before leaving', err);
    }
    this.nav.back(this.fallback());
  }
}
