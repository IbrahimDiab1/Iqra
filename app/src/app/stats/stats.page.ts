import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { UNCATEGORIZED } from '../books/library/library-query';
import { BookDetailsService } from '../books/details/book-details.service';
import { CLOCK } from '../core/clock';
import { DB } from '../core/db';
import type { Book, Goal, ID } from '../core/models';
import { Repo } from '../core/repo';
import { SettingsService } from '../core/settings.service';
import { bookProgress } from '../progress/book-progress';
import { COPY } from '../ui/copy';
import { icon } from '../ui/icons';
import { booksOnDay, dayStats, goalProgress, perBook } from './aggregate';
import { ChartComponent, type ChartBar } from './chart.component';
import { StatsFiltersComponent } from './filters.component';
import { formatDuration, formatMinutes } from './format';
import { GoalEditorSheet } from './goal-editor.sheet';
import { GoalService } from './goal.service';
import { HeatmapComponent } from './heatmap.component';
import {
  canGoNext,
  dayLabel,
  filterSessions,
  heatmapDays,
  isCurrentPeriod,
  matchesFilter,
  periodBounds,
  shiftPeriod,
  type HeatFilter,
  type Period,
} from './heatmap';
import { STATS_COPY } from './stats-copy';
import { formatRange, weekRange } from './week';

type Measure = 'pages' | 'time';
const L = STATS_COPY;
const PERIODS: readonly Period[] = ['week', 'month', 'year'];

/**
 * Reading for a week, month or year: totals, weekly goals and a day-by-day chart for a week, a colour-by-category
 * heat map for a month or year, filters by category and book, and the books in progress.
 */
@Component({
  selector: 'iqra-stats-page',
  imports: [ChartComponent, GoalEditorSheet, HeatmapComponent, StatsFiltersComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page" [attr.data-ready]="ready() ? '' : null">
      <h1>{{ title }}</h1>
      @if (ready()) {
        <div class="seg periods" role="group" [attr.aria-label]="l.period.label">
          @for (p of periods; track p) {
            <button type="button" [attr.data-period]="p" [attr.aria-pressed]="period() === p" (click)="setPeriod(p)">{{ l.period[p] }}</button>
          }
        </div>
        <div class="nav">
          <button type="button" class="step" data-nav="prev" [attr.aria-label]="l.prev[period()]" (click)="step(-1)" [innerHTML]="prevIcon"></button>
          <p class="week" data-testid="period-label" aria-live="polite">{{ periodLabel() }}</p>
          <button type="button" class="step" data-nav="next" [attr.aria-label]="l.next[period()]" [disabled]="!canNext()" (click)="step(1)" [innerHTML]="nextIcon"></button>
          @if (!isCurrent()) {
            <button type="button" class="today" (click)="goToday()">{{ l.today }}</button>
          }
        </div>

        <iqra-stats-filters
          [categories]="categories()"
          [books]="books()"
          [categoryId]="categoryFilter()"
          [bookId]="bookFilter()"
          (categoryChange)="categoryFilter.set($event)"
          (bookChange)="bookFilter.set($event)"
        />

        <div class="totals">
          <div class="tile" data-total="pages">
            <span class="k">{{ l.pages }}</span>
            <span class="v">{{ totalNow().pages }}</span>
            <span class="d">{{ pagesDelta() }}</span>
          </div>
          <div class="tile" data-total="time">
            <span class="k">{{ l.time }}</span>
            <span class="v">{{ timeText() }}</span>
            <span class="d">{{ timeDelta() }}</span>
          </div>
        </div>

        @if (period() === 'week') {
          <h2>{{ l.goalsTitle }}</h2>
          @if (goalRows().length === 0) {
            <p class="empty">{{ l.noGoals }}</p>
          }
          <ul class="goals">
            @for (g of goalRows(); track g.goal.id) {
              <li class="goal">
                <button type="button" class="goal-open" (click)="editing.set(g.goal); editorOpen.set(true)">
                  <span class="gl" dir="auto">{{ g.text }}</span>
                  <span class="gs" dir="auto">{{ g.scope }}</span>
                </button>
                <span class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="g.pct" [attr.aria-label]="g.text + ', ' + g.scope">
                  <span class="fill" [style.width.%]="g.pct"></span>
                </span>
              </li>
            }
          </ul>
          <button type="button" class="add" (click)="editing.set(null); editorOpen.set(true)">{{ goalCopy.add }}</button>
        }

        <h2>{{ period() === 'week' ? l.dayByDay : l.heatTitle[heatPeriod()] }}</h2>
        @if (periodEmpty()) {
          <p class="empty">{{ emptyText() }}</p>
        } @else {
          <div class="seg" role="group" [attr.aria-label]="l.dayByDay">
            <button type="button" [attr.aria-pressed]="measure() === 'pages'" (click)="measure.set('pages')">{{ l.pages }}</button>
            <button type="button" [attr.aria-pressed]="measure() === 'time'" (click)="measure.set('time')">{{ l.time }}</button>
          </div>
          @if (period() === 'week') {
            <iqra-bar-chart class="week-chart" [bars]="bars()" [unit]="measure()" [label]="l.dayByDay" />
          } @else {
            <iqra-heatmap
              [period]="heatPeriod()"
              [anchor]="shown()"
              [weekStartsOn]="weekStartsOn()"
              [days]="heatDays()"
              [categories]="categories()"
              [measure]="measure()"
              [selected]="selectedDay()"
              [scrollToEnd]="period() === 'year' && isCurrent()"
              (pick)="pickDay($event)"
            />
            @if (dayRows(); as rows) {
              <div class="day-detail" data-testid="day-detail">
                <h3>{{ l.heat.readOn(selectedLabel()) }}</h3>
                @if (rows.length === 0) {
                  <p class="empty">{{ l.heat.noBooksThatDay }}</p>
                }
                <ul class="plist">
                  @for (r of rows; track r.id) {
                    <li>
                      <button type="button" class="progress-row" (click)="details.open(r.id, 'stats')">
                        <span class="bt" dir="auto">{{ r.title }}</span>
                        <span class="bs">{{ r.text }}</span>
                      </button>
                    </li>
                  }
                </ul>
              </div>
            }
          }
        }

        <h2>{{ l.inProgress }}</h2>
        @if (inProgress().length === 0) {
          <p class="empty">{{ l.noneInProgress }}</p>
        }
        <ul class="plist">
          @for (r of inProgress(); track r.book.id) {
            <li>
              <button type="button" class="progress-row" (click)="details.open(r.book.id, 'stats')">
                <span class="bt" dir="auto">{{ r.book.title }}</span>
                <span class="bs">{{ r.text }}</span>
              </button>
            </li>
          }
        </ul>
      }
      <iqra-goal-editor-sheet [open]="editorOpen()" [goal]="editing()" [categories]="categories()" (closed)="editorOpen.set(false)" />
    </section>
  `,
  styles: `
    .page { padding: 16px var(--gutter) 24px; max-width: 720px; margin: 0 auto; }
    h1 { margin: 0 0 4px; font-family: var(--book); font-size: 28px; font-weight: 600; }
    h2 { margin: 24px 0 8px; font-size: 12px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
    .week { flex: 1; min-width: 0; margin: 0; color: var(--muted); font-size: 14px; text-align: center; overflow-wrap: anywhere; }
    .nav { display: flex; align-items: center; gap: 4px; margin-bottom: 12px; }
    .step { display: grid; place-items: center; flex: none; width: 40px; height: 40px; border: 0; border-radius: 12px; background: none; color: var(--fg); cursor: pointer; }
    .step:hover:not(:disabled) { background: var(--surface-2); }
    .step:disabled { opacity: .35; cursor: default; }
    .step:dir(rtl) svg { transform: scaleX(-1); }
    .today { flex: none; min-height: 40px; padding: 0 12px; border: 1px solid var(--line); border-radius: 999px; background: none; color: var(--accent); font: 600 13px var(--ui); cursor: pointer; }
    .day-detail { margin-top: 12px; }
    .day-detail h3 { margin: 0 0 4px; font-size: 14px; font-weight: 600; }
    .totals { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .tile { display: grid; gap: 2px; padding: 12px 14px; border-radius: 14px; background: var(--surface-2); }
    .k { font-size: 12px; color: var(--muted); }
    .v { font-size: 24px; font-weight: 600; font-variant-numeric: tabular-nums; }
    .d { font-size: 12px; color: var(--muted); }
    .empty { margin: 8px 0; color: var(--muted); font-size: 14px; line-height: 1.5; }
    ul { list-style: none; margin: 0; padding: 0; }
    .goal { padding: 4px 0 10px; border-bottom: 1px solid var(--line); }
    .goal-open, .progress-row { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; width: 100%; min-height: 44px; padding: 6px 2px; border: 0; background: none; color: var(--fg); font: 15px var(--ui); text-align: start; cursor: pointer; }
    .gs, .bs { color: var(--muted); font-size: 13px; }
    .progress-row { flex-direction: column; align-items: flex-start; gap: 2px; border-bottom: 1px solid var(--line); border-radius: 0; }
    .bt { font-weight: 500; overflow-wrap: anywhere; }
    .bar { display: block; height: 6px; border-radius: 3px; background: var(--surface-2); overflow: hidden; }
    .fill { display: block; height: 100%; background: var(--accent); }
    .add { margin-top: 10px; min-height: 40px; padding: 0 14px; border: 1px dashed var(--line); border-radius: 12px; background: none; color: var(--accent); font: 600 14px var(--ui); cursor: pointer; }
    .seg { display: flex; background: var(--surface-2); border-radius: 12px; padding: 3px; gap: 2px; margin-bottom: 8px; }
    .seg.periods { margin-bottom: 10px; }
    .seg button { flex: 1; min-height: 40px; border: 0; background: none; border-radius: 9px; font-size: 13px; font-weight: 500; color: var(--muted); }
    .seg button[aria-pressed="true"] { background: var(--surface); color: var(--fg); box-shadow: 0 1px 3px rgba(0, 0, 0, .12); }
    .step:focus-visible, .today:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  `,
})
export class StatsPage {
  protected readonly l = L;
  protected readonly goalCopy = L.goals;
  protected readonly title = COPY.nav.stats;
  protected readonly periods = PERIODS;
  protected readonly details = inject(BookDetailsService);

  private readonly db = inject(DB);
  private readonly repo = inject(Repo);
  private readonly clock = inject(CLOCK);
  private readonly settings = inject(SettingsService);
  private readonly goalService = inject(GoalService);
  private readonly sanitizer = inject(DomSanitizer);

  // Icon markup comes from the static table in icons.ts, so bypassing the sanitizer is safe.
  protected readonly prevIcon = this.sanitizer.bypassSecurityTrustHtml(icon('chevL', 20));
  protected readonly nextIcon = this.sanitizer.bypassSecurityTrustHtml(icon('chevR', 20));

  private readonly sessionsRec = this.repo.live(() => this.db.sessions.filter((s) => !s.deleted).toArray());
  private readonly booksRec = this.repo.live(() => this.db.books.filter((b) => !b.deleted).toArray());
  private readonly categoriesRec = this.repo.live(() => this.db.categories.filter((c) => !c.deleted).sortBy('order'));
  private readonly markedRec = this.repo.live(async () => {
    const counts = new Map<ID, number>();
    await this.db.readMarks.filter((m) => !m.deleted && m.read).each((m) => counts.set(m.bookId, (counts.get(m.bookId) ?? 0) + 1));
    return counts;
  });

  constructor() {
    const refresh = () => this.now.set(this.clock.now());
    const timer = setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', refresh);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    });
  }

  protected readonly measure = signal<Measure>('pages');
  protected readonly editing = signal<Goal | null>(null);
  protected readonly editorOpen = signal(false);
  protected readonly categories = computed(() => this.categoriesRec() ?? []);
  protected readonly books = computed(() => this.booksRec() ?? []);

  protected readonly ready = computed(
    () => this.sessionsRec() !== undefined && this.booksRec() !== undefined && this.categoriesRec() !== undefined && this.goalService.goals()() !== undefined && this.markedRec() !== undefined,
  );

  /** Refreshed every minute and when the app comes back to the front, so a screen left open follows midnight and the week rollover. */
  private readonly now = signal(this.clock.now());
  protected readonly weekStartsOn = computed(() => this.settings.settings().weekStartsOn);

  // ---- which period is shown ----
  protected readonly period = signal<Period>('week');
  /** Any moment in the period being viewed; null follows the present. */
  private readonly anchor = signal<number | null>(null);
  protected readonly shown = computed(() => this.anchor() ?? this.now());
  private readonly bounds = computed(() => periodBounds(this.period(), this.shown(), this.weekStartsOn()));
  /** The period just before the one shown. The day before its start is always inside it, whatever DST did. */
  private readonly prevBounds = computed(() => periodBounds(this.period(), this.bounds().from - 1, this.weekStartsOn()));
  protected readonly isCurrent = computed(() => isCurrentPeriod(this.period(), this.shown(), this.now(), this.weekStartsOn()));
  protected readonly canNext = computed(() => canGoNext(this.period(), this.shown(), this.now(), this.weekStartsOn()));
  protected readonly heatPeriod = computed<'month' | 'year'>(() => (this.period() === 'year' ? 'year' : 'month'));

  protected readonly periodLabel = computed(() => {
    const { from, to } = this.bounds();
    const current = this.isCurrent();
    switch (this.period()) {
      case 'week': {
        const range = formatRange(from, to);
        return current ? L.thisWeek(range) : range;
      }
      case 'month': {
        const name = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(from);
        return current ? L.thisMonth(name) : name;
      }
      case 'year': {
        const name = String(new Date(from).getFullYear());
        return current ? L.thisYear(name) : name;
      }
    }
  });

  protected readonly prevLabel = computed(() => (this.isCurrent() ? L.vsCurrent[this.period()] : L.vsPast[this.period()]));

  protected setPeriod(period: Period): void {
    this.period.set(period);
    this.selectedDay.set(null);
  }

  protected step(delta: -1 | 1): void {
    if (delta > 0 && !this.canNext()) return;
    const next = shiftPeriod(this.period(), this.shown(), delta, this.weekStartsOn());
    this.anchor.set(next);
    this.selectedDay.set(null);
  }

  protected goToday(): void {
    this.anchor.set(null);
    this.selectedDay.set(null);
  }

  // ---- filters ----
  protected readonly categoryFilter = signal<ID | null>(null);
  protected readonly bookFilter = signal<ID | null>(null);
  /** The filter with anything that has since been deleted taken off, so a hidden filter can never empty the screen. */
  private readonly filter = computed<HeatFilter>(() => {
    const categoryId = this.categoryFilter();
    const bookId = this.bookFilter();
    return {
      categoryId: categoryId === UNCATEGORIZED || this.categories().some((c) => c.id === categoryId) ? categoryId : null,
      bookId: this.books().some((b) => b.id === bookId) ? bookId : null,
    };
  });

  /** Sessions of books that still exist and pass the filter. */
  private readonly sessions = computed(() => filterSessions(this.sessionsRec() ?? [], this.books(), this.categories(), this.filter()));

  private static sum(days: { pages: number; ms: number }[]): { pages: number; ms: number } {
    return days.reduce((a, d) => ({ pages: a.pages + d.pages, ms: a.ms + d.ms }), { pages: 0, ms: 0 });
  }
  private readonly periodDays = computed(() => dayStats(this.sessions(), this.bounds()));
  protected readonly totalNow = computed(() => StatsPage.sum(this.periodDays()));
  private readonly totalBefore = computed(() => StatsPage.sum(dayStats(this.sessions(), this.prevBounds())));
  protected readonly periodEmpty = computed(() => this.totalNow().pages === 0 && this.totalNow().ms === 0);
  protected readonly emptyText = computed(() => {
    const period = this.period();
    if (!this.isCurrent()) return L.noReadingPast;
    return period === 'week' ? L.noReading : L.noReadingYet[period];
  });

  protected readonly timeText = computed(() => formatDuration(this.totalNow().ms));
  protected readonly pagesDelta = computed(() => {
    const diff = this.totalNow().pages - this.totalBefore().pages;
    const vs = this.prevLabel();
    return diff === 0 ? L.sameAsLast(vs) : diff > 0 ? L.morePages(diff, vs) : L.lessPages(-diff, vs);
  });
  protected readonly timeDelta = computed(() => {
    // Compare whole minutes so the text never says "+0 min".
    const diff = Math.floor(this.totalNow().ms / 60_000) - Math.floor(this.totalBefore().ms / 60_000);
    const vs = this.prevLabel();
    return diff === 0 ? L.sameAsLast(vs) : diff > 0 ? L.moreTime(formatDuration(diff * 60_000), vs) : L.lessTime(formatDuration(-diff * 60_000), vs);
  });

  protected readonly goalRows = computed(() => {
    const goals = this.goalService.goals()() ?? [];
    const books = this.booksRec() ?? [];
    const names = new Map(this.categories().map((c) => [c.id, c.name]));
    return goals.map((goal) => {
      const gone = goal.categoryId !== null && !names.has(goal.categoryId);
      const scope = goal.categoryId === null ? L.allBooks : gone ? L.categoryGone : names.get(goal.categoryId)!;
      // A goal whose category is gone is left out of the maths.
      const value = gone ? 0 : goalProgress(goal, this.sessions(), books, this.bounds()).value;
      const fraction = gone || goal.target <= 0 ? 0 : Math.min(1, value / goal.target);
      const text =
        goal.measure === 'time'
          ? L.progressOf(L.readingLabel, formatMinutes(value), formatMinutes(goal.target))
          : L.progressOf(L.pagesLabel, String(Math.floor(value)), String(goal.target));
      return { goal, scope, text, pct: Math.round(fraction * 100) };
    });
  });

  protected readonly bars = computed<ChartBar[]>(() => {
    const byDay = new Map(this.periodDays().map((d) => [d.day, d]));
    const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'narrow' });
    const long = new Intl.DateTimeFormat(undefined, { weekday: 'long' });
    return weekRange(this.shown(), this.weekStartsOn()).days.map((day) => {
      const [y, m, d] = day.split('-').map(Number);
      const date = new Date(y, m - 1, d);
      const s = byDay.get(day) ?? { pages: 0, ms: 0 };
      const pages = this.measure() === 'pages';
      return {
        label: weekday.format(date),
        value: pages ? s.pages : s.ms / 60_000,
        tooltip: `${long.format(date)}: ${pages ? `${s.pages} ${L.pages.toLowerCase()}` : formatDuration(s.ms)}`,
      };
    });
  });

  // ---- heat map ----
  protected readonly heatDays = computed(() =>
    heatmapDays(this.sessions(), this.books(), this.categories(), this.bounds(), this.measure(), this.filter()),
  );
  protected readonly selectedDay = signal<string | null>(null);
  protected readonly selectedLabel = computed(() => dayLabel(this.selectedDay() ?? ''));

  /** Clicking the selected day again closes its list. */
  protected pickDay(day: string): void {
    this.selectedDay.set(this.selectedDay() === day ? null : day);
  }

  /** The books read on the selected day; null when no day is selected. */
  protected readonly dayRows = computed(() => {
    const day = this.selectedDay();
    if (day === null) return null;
    const titles = new Map(this.books().map((b) => [b.id, b.title]));
    return booksOnDay(this.sessions(), day).map((r) => ({
      id: r.bookId,
      title: titles.get(r.bookId) ?? '',
      text: L.heat.bookRow(r.pages, formatDuration(r.ms)),
    }));
  });

  protected readonly inProgress = computed(() => {
    const per = perBook(this.sessions());
    const marked = this.markedRec() ?? new Map<ID, number>();
    const filter = this.filter();
    const categories = this.categories();
    return (this.booksRec() ?? [])
      .filter((b) => b.status === 'reading' && matchesFilter(b, categories, filter))
      .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))
      .map((book: Book) => {
        const markedCount = marked.get(book.id) ?? 0;
        const pct = Math.round(bookProgress(book, markedCount) * 100);
        const time = formatDuration(per.get(book.id)?.ms ?? 0);
        const text = book.progressMode === 'marked' ? L.progressRowMarked(markedCount, book.pageCount, pct, time) : L.progressRow(book.lastPageReached, book.pageCount, pct, time);
        return { book, text };
      });
  });
}
