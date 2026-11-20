import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { AuthApi } from '../../auth/auth.service';
import { CLOCK } from '../../core/clock';
import { DB } from '../../core/db';
import { Repo } from '../../core/repo';
import { formatDuration } from '../../stats/format';
import { SyncStatusComponent } from '../../sync/sync-status.component';
import type { BookView } from './book-card.component';
import { firstName, welcomeStats } from './greeting';
import { RecentCardComponent } from './recent-card.component';
import { TOP_COPY } from './top-copy';

/**
 * The top of the Library: the greeting with the streak and all-time reading time, and the Continue reading row.
 * The page loads it with `@defer`, so the statistics code stays out of the initial bundle.
 */
@Component({
  selector: 'iqra-library-top',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RecentCardComponent, SyncStatusComponent],
  template: `
    <header class="hello">
      <h1 data-testid="welcome">{{ welcomeText() }}</h1>
      <p class="stats" data-testid="welcome-stats">
        <span>{{ streakText() }}</span>
        <span class="sep" aria-hidden="true">·</span>
        <span>{{ timeText() }}</span>
        @if (stats().finished > 0) {
          <span class="sep" aria-hidden="true">·</span>
          <span>{{ copy.finishedCount(stats().finished) }}</span>
        }
      </p>
      <iqra-sync-status />
    </header>

    @if (recent().length > 0) {
      <section class="recent" data-testid="recent" aria-labelledby="recent-h">
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
    .hello { margin-bottom: 14px; }
    .stats { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 8px; margin: 6px 0 0; color: var(--muted); font-size: 13.5px; font-variant-numeric: tabular-nums; }
    .sep { opacity: 0.6; }
    .sec-h { margin: 0 0 10px; font-size: 17px; font-weight: 600; letter-spacing: -0.01em; }
    .recent { margin-bottom: 18px; }
    .recent-row {
      display: flex;
      gap: 12px;
      margin: 0 calc(-1 * var(--gutter));
      padding: 2px var(--gutter) 6px;
      overflow-x: auto;
      list-style: none;
      scroll-snap-type: x proximity;
      scroll-padding-inline: var(--gutter);
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

  private readonly sessions = this.repo.live(() => this.db.sessions.filter((s) => !s.deleted).toArray());
  protected readonly stats = computed(() => welcomeStats(this.sessions() ?? [], this.finished(), this.clock.now()));
  protected readonly welcomeText = computed(() => {
    const name = firstName(this.auth.profile()?.name);
    return name ? this.copy.welcome(name) : this.copy.welcomeAnon;
  });
  protected readonly streakText = computed(() => (this.stats().streak > 0 ? this.copy.streakDays(this.stats().streak) : this.copy.streakNone));
  protected readonly timeText = computed(() => this.copy.timeRead(formatDuration(this.stats().ms)));
}
