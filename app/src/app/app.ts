import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DomSanitizer } from '@angular/platform-browser';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { BookDetailsSheetComponent } from './books/details/book-details.sheet';
import { OpenBookSheetComponent } from './books/open-book.sheet';
import { RemoveBookSheetComponent } from './books/remove-book.sheet';
import { ReviewService } from './review/review.service';
import { COPY } from './ui/copy';
import { icon, IconName } from './ui/icons';
import { ReconnectBannerComponent } from './sync/reconnect-banner.component';
import { ToastComponent } from './ui/toast.component';
import { NavHistory } from './ui/nav-history.service';
import { TooltipService } from './ui/tooltip.service';

interface Tab {
  path: string;
  label: string;
  icon: IconName;
}

// Welcome and the reader are full-screen: no tab bar there.
const TABLESS_ROUTE = /^\/(welcome|read)(?:[/?#]|$)/;

@Component({
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    ToastComponent,
    ReconnectBannerComponent,
    OpenBookSheetComponent,
    RemoveBookSheetComponent,
    BookDetailsSheetComponent,
  ],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  private readonly router = inject(Router);
  private readonly sanitizer = inject(DomSanitizer);
  /** Items due now, shown as a badge on the Review tab. */
  protected readonly due = inject(ReviewService).dueCount();

  constructor() {
    // Hover and focus labels for every icon-only button, from one place.
    inject(TooltipService).install();
    // Counts the app's navigations from the first one, so back arrows know whether there is a page to go back to.
    inject(NavHistory);
  }

  protected readonly tabs: readonly Tab[] = [
    { path: '/profile', label: COPY.nav.profile, icon: 'user' },
    { path: '/library', label: COPY.nav.library, icon: 'library' },
    { path: '/notes', label: COPY.nav.notes, icon: 'notes' },
    { path: '/review', label: COPY.nav.review, icon: 'cards' },
    { path: '/stats', label: COPY.nav.stats, icon: 'stats' },
  ];

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  protected readonly showTabs = computed(() => !TABLESS_ROUTE.test(this.url()));

  protected dueLabel(n: number): string {
    return `${n} due today`;
  }

  /** Icon markup comes from the static ICON table in icons.ts, so it is safe to trust. */
  protected iconMarkup(name: IconName) {
    return this.sanitizer.bypassSecurityTrustHtml(icon(name, 22));
  }
}
