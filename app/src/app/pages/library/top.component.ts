import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, computed, inject, input, signal } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { icon } from '../../ui/icons';
import { AuthApi } from '../../auth/auth.service';
import { CLOCK } from '../../core/clock';
import { DB } from '../../core/db';
import { Repo } from '../../core/repo';
import { GoalService } from '../../stats/goal.service';
import { SettingsService } from '../../core/settings.service';
import { SyncStatusComponent } from '../../sync/sync-status.component';
import type { BookView } from './book-card.component';
import { firstName, statLines } from './greeting';
import { fullQuoteOfTheDay } from './quotes';
import { RecentCardComponent } from './recent-card.component';
import { TOP_COPY } from './top-copy';

const ROTATE_MS = 3000;

/**
 * The top of the Library: the greeting with a stat line that rotates every few seconds, and the Continue reading row.
 * The page loads it with `@defer`, so the statistics code stays out of the initial bundle.
 */
@Component({
  selector: 'iqra-library-top',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RecentCardComponent, SyncStatusComponent],
  template: `
    <div class="brand" data-testid="brand">
      <img class="logo" src="icons/icon-192.png" width="28" height="28" alt="" />
      <span class="wordmark">Iqra</span>
    </div>
    <header class="hello card">
      <h1 data-testid="welcome">{{ welcomeText() }}</h1>
      <div class="greeting-row">
        <div class="quote-wrap">
          <button
            type="button"
            class="quote-btn"
            data-testid="quote-btn"
            aria-haspopup="dialog"
            [attr.aria-expanded]="quoteOpen()"
            (click)="quoteOpen.set(!quoteOpen())"
          >
            <span class="qi" aria-hidden="true" [innerHTML]="quoteIcon"></span>{{ copy.todaysQuote }}
          </button>
          @if (quoteOpen()) {
            <div class="quote-pop" role="dialog" [attr.aria-label]="copy.todaysQuote" data-testid="quote-pop">
              <p class="q-text" dir="auto" data-testid="quote">{{ quote().text }}</p>
              @if (quote().author) {
                <p class="q-author" data-testid="quote-author">{{ quote().author }}</p>
              }
              <button type="button" class="q-close" data-testid="quote-close" (click)="closeQuote(true)">{{ copy.closeQuote }}</button>
            </div>
          }
        </div>
        <p
          class="stats"
          data-testid="welcome-stats"
          (mouseenter)="paused.set(true)"
          (mouseleave)="paused.set(false)"
          (focusin)="paused.set(true)"
          (focusout)="paused.set(false)"
        >
          @for (l of [line()]; track l) {
            <span class="line" [title]="l">{{ l }}</span>
          }
        </p>
      </div>
      <iqra-sync-status />
    </header>

    @if (recent().length > 0) {
      <section class="recent card" data-testid="recent" aria-labelledby="recent-h">
        <h2 id="recent-h" class="sec-h">{{ copy.continue }}</h2>
        <ul class="recent-row">
          @for (v of recent(); track v.book.id) {
            <li><iqra-recent-card [view]="v" /></li>
          }
        </ul>
      </section>
    }
  `,
  styles: `
    :host { display: block; }
    h1 { margin: 2px 0 0; font-size: 26px; font-weight: 600; line-height: 1.15; letter-spacing: -0.02em; overflow-wrap: anywhere; }
    .brand { display: flex; align-items: center; gap: 8px; margin: 0 0 12px; }
    .logo { border-radius: 8px; }
    .wordmark { color: var(--accent); font-size: 20px; font-weight: 700; letter-spacing: -0.02em; }
    .card { padding: 14px 16px 16px; border: 1px solid var(--line); border-radius: var(--radius-card); background: var(--surface); }
    .hello { margin-bottom: 14px; }
    .greeting-row { display: flex; align-items: center; gap: 8px; margin: 6px 0 4px; }
    .stats { min-width: 0; margin: 0; color: var(--muted); font-size: 13.5px; font-variant-numeric: tabular-nums; }
    .quote-wrap { position: relative; flex: none; }
    .quote-btn { display: inline-flex; white-space: nowrap; align-items: center; gap: 5px; min-height: 28px; padding: 2px 8px 2px 6px; border: 1px solid var(--line); border-radius: 999px; background: none; color: var(--muted); font: inherit; font-size: 12.5px; cursor: pointer; }
    .quote-btn:hover { color: var(--fg); background: color-mix(in srgb, currentColor 8%, transparent); }
    .quote-btn:focus-visible, .q-close:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .qi { display: inline-grid; place-items: center; }
    .quote-pop { position: absolute; z-index: 5; top: calc(100% + 6px); inset-inline-start: 0; box-sizing: border-box; width: min(320px, calc(100vw - 2 * var(--gutter, 16px))); max-height: 60vh; overflow-y: auto; padding: 14px 16px 10px; border: 1px solid var(--line); border-radius: var(--radius-card); background: var(--surface); color: var(--fg); box-shadow: var(--shadow); }
    .q-text { margin: 0; font-size: 16px; font-style: italic; line-height: 1.5; overflow-wrap: anywhere; }
    .q-author { margin: 6px 0 0; color: var(--muted); font-size: 13px; }
    .q-close { display: block; margin: 10px 0 0 auto; padding: 4px 10px; border: 0; border-radius: var(--radius-control); background: none; color: var(--accent); font: inherit; font-size: 13px; cursor: pointer; }
    .line { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; animation: line-in .4s ease; }
    @keyframes line-in { from { opacity: 0; } to { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .line { animation: none; } }
    .sec-h { margin: 0 0 10px; font-size: 17px; font-weight: 600; letter-spacing: -0.01em; }
    .recent { margin-bottom: 14px; }
    .recent-row {
      display: flex;
      gap: 12px;
      margin: 0 -16px;
      padding: 2px 16px 6px;
      overflow-x: auto;
      list-style: none;
      scroll-snap-type: x proximity;
      scroll-padding-inline: 16px;
      scrollbar-width: thin;
    }
    .recent-row li { flex: none; width: 92px; scroll-snap-align: start; }
  `,
})
export class LibraryTopComponent {
  /** The recently read books, newest first (up to five). */
  readonly recent = input.required<BookView[]>();
  /** How many books are finished. */
  readonly finished = input.required<number>();

  private readonly db = inject(DB);
  private readonly repo = inject(Repo);
  private readonly auth = inject(AuthApi);
  private readonly clock = inject(CLOCK);
  protected readonly copy = TOP_COPY;

  private readonly goalService = inject(GoalService);
  private readonly settings = inject(SettingsService);

  private readonly sessions = this.repo.live(() => this.db.sessions.filter((s) => !s.deleted).toArray());
  private readonly books = this.repo.live(() => this.db.books.filter((b) => !b.deleted).toArray());
  private readonly categories = this.repo.live(() => this.db.categories.filter((c) => !c.deleted).toArray());

  /** Rotation is paused while the pointer or focus is on the line, so it can be read. */
  protected readonly paused = signal(false);
  private readonly tick = signal(0);
  /** Refreshed with every tick, so the day and week rollovers are followed. */
  private readonly now = signal(this.clock.now());

  protected readonly lines = computed(() =>
    statLines({
      sessions: this.sessions() ?? [],
      books: this.books() ?? [],
      categories: this.categories() ?? [],
      goals: this.goalService.goals()() ?? [],
      finished: this.finished(),
      now: this.now(),
      weekStartsOn: this.settings.settings().weekStartsOn,
    }),
  );
  protected readonly line = computed(() => {
    const l = this.lines();
    return l[this.tick() % l.length];
  });

  protected readonly quote = computed(() => {
    const [text, author] = fullQuoteOfTheDay(this.now()).split(/\s+\u2014\s+/);
    return { text, author: author ?? '' };
  });
  protected readonly quoteIcon = inject(DomSanitizer).bypassSecurityTrustHtml(icon('quote', 16));
  protected readonly quoteOpen = signal(false);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected closeQuote(refocus = false): void {
    this.quoteOpen.set(false);
    if (refocus) this.host.nativeElement.querySelector<HTMLElement>('.quote-btn')?.focus();
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.quoteOpen()) this.closeQuote(true);
  }

  @HostListener('document:pointerdown', ['$event'])
  protected onOutside(e: Event): void {
    if (this.quoteOpen() && !(e.target as Element | null)?.closest('.quote-wrap')) this.quoteOpen.set(false);
  }

  protected readonly welcomeText = computed(() => {
    const name = firstName(this.auth.profile()?.name);
    return name ? this.copy.welcome(name) : this.copy.welcomeAnon;
  });

  constructor() {
    const timer = setInterval(() => {
      this.now.set(this.clock.now());
      if (!this.paused()) this.tick.update((n) => n + 1);
    }, ROTATE_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }
}
