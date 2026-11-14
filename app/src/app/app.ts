import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DomSanitizer } from '@angular/platform-browser';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { OpenBookSheetComponent } from './books/open-book.sheet';
import { RemoveBookSheetComponent } from './books/remove-book.sheet';
import { COPY } from './ui/copy';
import { icon, IconName } from './ui/icons';
import { ToastComponent } from './ui/toast.component';

interface Tab {
  path: string;
  label: string;
  icon: IconName;
}

// Welcome and the reader are full-screen: no tab bar there.
const TABLESS_ROUTE = /^\/(welcome|read)(\/|$)/;

@Component({
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    ToastComponent,
    OpenBookSheetComponent,
    RemoveBookSheetComponent,
  ],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  private readonly router = inject(Router);
  private readonly sanitizer = inject(DomSanitizer);

  protected readonly tabs: readonly Tab[] = [
    { path: '/library', label: COPY.nav.library, icon: 'library' },
    { path: '/notes', label: COPY.nav.notes, icon: 'notes' },
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

  /** Icon markup comes from the static ICON table in icons.ts, so it is safe to trust. */
  protected iconMarkup(name: IconName) {
    return this.sanitizer.bypassSecurityTrustHtml(icon(name, 22));
  }
}
