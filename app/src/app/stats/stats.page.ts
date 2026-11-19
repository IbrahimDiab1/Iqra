import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { BookDetailsService } from '../books/details/book-details.service';
import { CLOCK } from '../core/clock';
import { DB } from '../core/db';
import type { Book, Goal, ID } from '../core/models';
import { Repo } from '../core/repo';
import { SettingsService } from '../core/settings.service';
import { bookProgress } from '../progress/book-progress';
import { COPY } from '../ui/copy';
import { dayStats, goalProgress, perBook } from './aggregate';
import { ChartComponent, type ChartBar } from './chart.component';
import { formatDuration, formatMinutes } from './format';
import { GoalEditorSheet } from './goal-editor.sheet';
import { GoalService } from './goal.service';
import { STATS_COPY } from './stats-copy';
import { formatRange, weekRange } from './week';

type Measure = 'pages' | 'time';
const L = STATS_COPY;

/** This week's reading, weekly goals, a day-by-day chart and the books in progress. */
@Component({
  selector: 'iqra-stats-page',
  imports: [ChartComponent, GoalEditorSheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page" [attr.data-ready]="ready() ? '' : null">
      <h1>{{ title }}</h1>
      @if (ready()) {
        <p class="week">{{ weekLabel() }}</p>

        <div class="totals">
          <div class="tile" data-total="pages">
            <span class="k">{{ l.pages }}</span>
            <span class="v">{{ week().pages }}</span>
            <span class="d">{{ pagesDelta() }}</span>
          </div>
          <div class="tile" data-total="time">
            <span class="k">{{ l.time }}</span>
            <span class="v">{{ timeText() }}</span>
            <span class="d">{{ timeDelta() }}</span>
          </div>
        </div>

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

        <h2>{{ l.dayByDay }}</h2>
        @if (week().pages === 0 && week().ms === 0) {
          <p class="empty">{{ l.noReading }}</p>
        } @else {
          <div class="seg" role="group" [attr.aria-label]="l.dayByDay">
            <button type="button" [attr.aria-pressed]="measure() === 'pages'" (click)="measure.set('pages')">{{ l.pages }}</button>
            <button type="button" [attr.aria-pressed]="measure() === 'time'" (click)="measure.set('time')">{{ l.time }}</button>
          </div>
          <iqra-bar-chart class="week-chart" [bars]="bars()" [unit]="measure()" [label]="l.dayByDay" />
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
    .week { margin: 0 0 12px; color: var(--muted); font-size: 14px; }
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
    .seg button { flex: 1; min-height: 40px; border: 0; background: none; border-radius: 9px; font-size: 13px; font-weight: 500; color: var(--muted); }
    .seg button[aria-pressed="true"] { background: var(--surface); color: var(--fg); box-shadow: 0 1px 3px rgba(0, 0, 0, .12); }
    button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  `,
})
export class StatsPage {
  protected readonly l = L;
  protected readonly goalCopy = L.goals;
  protected readonly title = COPY.nav.stats;
  protected readonly details = inject(BookDetailsService);

  private readonly db = inject(DB);
  private readonly repo = inject(Repo);
  private readonly clock = inject(CLOCK);
  private readonly settings = inject(SettingsService);
  private readonly goalService = inject(GoalService);

  private readonly sessionsRec = this.repo.live(() => this.db.sessions.filter((s) => !s.deleted).toArray());
  private readonly booksRec = this.repo.live(() => this.db.books.filter((b) => !b.deleted).toArray());
  private readonly categoriesRec = this.repo.live(() => this.db.categories.filter((c) => !c.deleted).sortBy('order'));
  private readonly markedRec = this.repo.live(async () => {
    const counts = new Map<ID, number>();
    await this.db.readMarks.filter((m) => !m.deleted && m.read).each((m) => counts.set(m.bookId, (counts.get(m.bookId) ?? 0) + 1));
    return counts;
  });

  protected readonly measure = signal<Measure>('pages');
  protected readonly editing = signal<Goal | null>(null);
  protected readonly editorOpen = signal(false);
  protected readonly categories = computed(() => this.categoriesRec() ?? []);

  protected readonly ready = computed(
    () => this.sessionsRec() !== undefined && this.booksRec() !== undefined && this.categoriesRec() !== undefined && this.goalService.goals()() !== undefined && this.markedRec() !== undefined,
  );

  private readonly now = this.clock.now();
  private readonly thisWeek = computed(() => weekRange(this.now, this.settings.settings().weekStartsOn));
  /** The day before this week starts is always in last week, whatever DST did in between. */
  private readonly lastWeek = computed(() => weekRange(this.thisWeek().from - 1, this.settings.settings().weekStartsOn));

  /** Sessions of books that still exist. */
  private readonly sessions = computed(() => {
    const live = new Set((this.booksRec() ?? []).map((b) => b.id));
    return (this.sessionsRec() ?? []).filter((s) => live.has(s.bookId));
  });

  private static sum(days: { pages: number; ms: number }[]): { pages: number; ms: number } {
    return days.reduce((a, d) => ({ pages: a.pages + d.pages, ms: a.ms + d.ms }), { pages: 0, ms: 0 });
  }
  private readonly weekDays = computed(() => dayStats(this.sessions(), this.thisWeek()));
  protected readonly week = computed(() => StatsPage.sum(this.weekDays()));
  private readonly last = computed(() => StatsPage.sum(dayStats(this.sessions(), this.lastWeek())));

  protected readonly weekLabel = computed(() => L.thisWeek(formatRange(this.thisWeek().from, this.thisWeek().to)));
  protected readonly timeText = computed(() => formatDuration(this.week().ms));
  protected readonly pagesDelta = computed(() => {
    const diff = this.week().pages - this.last().pages;
    return diff === 0 ? L.sameAsLast : diff > 0 ? L.morePages(diff) : L.lessPages(-diff);
  });
  protected readonly timeDelta = computed(() => {
    // Compare whole minutes so the text never says "+0 min".
    const diff = Math.floor(this.week().ms / 60_000) - Math.floor(this.last().ms / 60_000);
    return diff === 0 ? L.sameAsLast : diff > 0 ? L.moreTime(formatDuration(diff * 60_000)) : L.lessTime(formatDuration(-diff * 60_000));
  });

  protected readonly goalRows = computed(() => {
    const goals = this.goalService.goals()() ?? [];
    const books = this.booksRec() ?? [];
    const names = new Map(this.categories().map((c) => [c.id, c.name]));
    return goals.map((goal) => {
      const gone = goal.categoryId !== null && !names.has(goal.categoryId);
      const scope = goal.categoryId === null ? L.allBooks : gone ? L.categoryGone : names.get(goal.categoryId)!;
      // A goal whose category is gone is left out of the maths.
      const value = gone ? 0 : goalProgress(goal, this.sessions(), books, this.thisWeek()).value;
      const fraction = gone || goal.target <= 0 ? 0 : Math.min(1, value / goal.target);
      const text =
        goal.measure === 'time'
          ? L.progressOf(L.readingLabel, formatMinutes(value), formatMinutes(goal.target))
          : L.progressOf(L.pagesLabel, String(Math.floor(value)), String(goal.target));
      return { goal, scope, text, pct: Math.round(fraction * 100) };
    });
  });

  protected readonly bars = computed<ChartBar[]>(() => {
    const byDay = new Map(this.weekDays().map((d) => [d.day, d]));
    const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'narrow' });
    const long = new Intl.DateTimeFormat(undefined, { weekday: 'long' });
    return this.thisWeek().days.map((day) => {
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

  protected readonly inProgress = computed(() => {
    const per = perBook(this.sessions());
    const marked = this.markedRec() ?? new Map<ID, number>();
    return (this.booksRec() ?? [])
      .filter((b) => b.status === 'reading')
      .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))
      .map((book: Book) => {
        const markedCount = marked.get(book.id) ?? 0;
        const page = book.progressMode === 'marked' ? markedCount : book.lastPageReached;
        const pct = Math.round(bookProgress(book, markedCount) * 100);
        return { book, text: L.progressRow(page, book.pageCount, pct, formatDuration(per.get(book.id)?.ms ?? 0)) };
      });
  });
}
