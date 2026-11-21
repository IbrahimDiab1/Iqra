import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { AuthApi } from '../../auth/auth.service';
import { CLOCK } from '../../core/clock';
import { DB } from '../../core/db';
import { Repo } from '../../core/repo';
import { GoalService } from '../../stats/goal.service';
import { SettingsService } from '../../core/settings.service';
import { SyncStatusComponent } from '../../sync/sync-status.component';
import type { BookView } from './book-card.component';
import { firstName, statLines } from './greeting';
import { quoteOfTheDay } from './quotes';
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
      <p
        class="stats"
        data-testid="welcome-stats"
        (mouseenter)="paused.set(true)"
        (mouseleave)="paused.set(false)"
        (focusin)="paused.set(true)"
        (focusout)="paused.set(false)"
      >
        <span class="quote" dir="auto" data-testid="quote">{{ quote() }}</span>
        <span class="dot" aria-hidden="true">·</span>
        @for (l of [line()]; track l) {
          <span class="line">{{ l }}</span>
        }
      </p>
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
    .stats { display: flex; align-items: baseline; gap: 6px; margin: 6px 0 0; min-height: 1.4em; color: var(--muted); font-size: 13.5px; font-variant-numeric: tabular-nums; }
    .quote { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-style: italic; }
    .dot { flex: none; }
    .line { flex: none; white-space: nowrap; display: inline-block; animation: line-in .4s ease; }
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

  protected readonly quote = computed(() => quoteOfTheDay(this.now()));

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
