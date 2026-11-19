import { ChangeDetectionStrategy, Component, Injector, computed, inject, input, runInInjectionContext, signal, untracked, type Signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AnnotationService } from '../../annotations/annotation.service';
import { CLOCK } from '../../core/clock';
import { DB } from '../../core/db';
import type { Annotation, Book, ID, ReadingSession } from '../../core/models';
import { Repo } from '../../core/repo';
import { SettingsService } from '../../core/settings.service';
import { chapterProgress } from '../../progress/progress';
import { ReadMarkService } from '../../progress/read-mark.service';
import { flattenOutline } from '../../reader/outline';
import { PROGRESS_COPY } from '../../reader/progress-copy';
import { COPY } from '../../ui/copy';
import { dayStats, totals } from '../../stats/aggregate';
import { ChartComponent, groupWeekly, type ChartBar } from '../../stats/chart.component';
import { formatAvg, formatDuration } from '../../stats/format';
import { STATS_COPY } from '../../stats/stats-copy';
import { dayKey } from '../../stats/week';
import { BookDetailsService } from './book-details.service';

type Measure = 'pages' | 'time';
const NOTE_TYPES = [
  { type: 'highlight', label: STATS_COPY.book.highlights },
  { type: 'note', label: STATS_COPY.book.notesCount },
  { type: 'side-note', label: STATS_COPY.book.sideNotes },
  { type: 'summary', label: STATS_COPY.book.summaries },
] as const;

/** The details sheet's Stats tab: timeline, reading chart, totals, notes counts, rating and chapter progress. */
@Component({
  selector: 'iqra-book-stats',
  imports: [ChartComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stats" [attr.data-ready]="ready() ? '' : null">
      <h4>{{ c.timeline }}</h4>
      <dl class="tl">
        <div><dt>{{ c.added }}</dt><dd>{{ date(book().addedAt) }}</dd></div>
        <div><dt>{{ c.started }}</dt><dd>{{ date(book().startedAt) }}</dd></div>
        <div><dt>{{ c.finished }}</dt><dd>{{ date(book().finishedAt) }}</dd></div>
      </dl>

      <h4>{{ c.chart }}</h4>
      <div class="seg" role="group" [attr.aria-label]="c.chart">
        <button type="button" [attr.aria-pressed]="measure() === 'pages'" (click)="measure.set('pages')">{{ c.pages }}</button>
        <button type="button" [attr.aria-pressed]="measure() === 'time'" (click)="measure.set('time')">{{ c.time }}</button>
      </div>
      <iqra-bar-chart [bars]="bars()" [unit]="measure()" [label]="c.chart" />

      <h4>{{ c.totals }}</h4>
      @if (empty()) {
        <p class="muted">{{ c.noSessions }}</p>
      }
      <dl class="totals">
        <div><dt>{{ c.timeSpent }}</dt><dd>{{ duration() }}</dd></div>
        <div><dt>{{ c.pagesRead }}</dt><dd>{{ total().pages }}</dd></div>
        <div><dt>{{ c.sessions }}</dt><dd>{{ total().sessions }}</dd></div>
        <div><dt>{{ c.daysRead }}</dt><dd>{{ total().days }}</dd></div>
        <div><dt>{{ c.avgPerPage }}</dt><dd>{{ avg() }}</dd></div>
      </dl>

      <h4>{{ c.notes }}</h4>
      <div class="notes">
        @for (n of noteTypes; track n.type) {
          <a class="nrow" [attr.data-type]="n.type" routerLink="/notes" [queryParams]="{ book: book().id, type: n.type }" (click)="details.close()">
            <span>{{ n.label }}</span><span class="n">{{ counts()[n.type] }}</span>
          </a>
        }
        <div class="nrow" data-type="bookmark">
          <span>{{ c.bookmarks }}</span><span class="n">{{ counts()['bookmark'] }}</span>
        </div>
      </div>

      <h4>{{ c.rating }}</h4>
      <div class="rr">
        <p>{{ book().rating ? details_.ratingOf(book().rating!) : c.noRating }}</p>
        <p dir="auto" [class.muted]="!book().review">{{ book().review || c.noReview }}</p>
      </div>

      @if (chapters().length > 0) {
        <h4>{{ c.chapters }}</h4>
        <ul class="chap">
          @for (e of chapters(); track e.key) {
            <li [style.padding-inline-start.px]="e.depth * 14">
              <span class="ct" dir="auto">{{ e.title }}</span>
              <span class="pct">{{ prog.chapterPct(e.pct) }}</span>
              <span class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="e.pct" [attr.aria-label]="e.title">
                <span class="fill" [style.width.%]="e.pct"></span>
              </span>
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: `
    h4 { margin: 18px 0 8px; font-size: 12px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
    dl { margin: 0; }
    .tl, .totals { display: grid; gap: 1px; background: var(--line); border-radius: 12px; overflow: hidden; }
    .tl > div, .totals > div { display: flex; justify-content: space-between; gap: 12px; padding: 10px 12px; background: var(--surface-2); font-size: 14px; }
    dt { color: var(--muted); }
    dd { margin: 0; font-variant-numeric: tabular-nums; font-weight: 500; }
    .seg { display: flex; background: var(--surface-2); border-radius: 12px; padding: 3px; gap: 2px; margin-bottom: 8px; }
    .seg button { flex: 1; min-height: 40px; border: 0; background: none; border-radius: 9px; font-size: 13px; font-weight: 500; color: var(--muted); }
    .seg button[aria-pressed="true"] { background: var(--surface); color: var(--fg); box-shadow: 0 1px 3px rgba(0, 0, 0, .12); }
    .seg button:focus-visible, .nrow:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .muted { color: var(--muted); font-size: 14px; }
    .notes { display: grid; gap: 1px; background: var(--line); border-radius: 12px; overflow: hidden; }
    .nrow { display: flex; align-items: center; justify-content: space-between; min-height: 44px; padding: 0 12px; background: var(--surface-2); color: var(--fg); text-decoration: none; font-size: 14px; }
    a.nrow:hover { background: var(--surface); }
    .n { font-variant-numeric: tabular-nums; color: var(--muted); }
    .rr p { margin: 0 0 6px; font-size: 14px; line-height: 1.5; }
    .chap { list-style: none; margin: 0; padding: 0; }
    .chap li { display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; padding-block: 6px; font-size: 14px; }
    .ct { min-width: 0; overflow-wrap: anywhere; }
    .pct { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
    .bar { grid-column: 1 / -1; height: 3px; background: var(--surface-2); border-radius: 2px; overflow: hidden; }
    .fill { display: block; height: 100%; background: var(--accent); }
  `,
})
export class BookStatsComponent {
  readonly book = input.required<Book>();

  protected readonly c = STATS_COPY.book;
  protected readonly prog = PROGRESS_COPY;
  protected readonly details_ = COPY.details;
  protected readonly noteTypes = NOTE_TYPES;
  protected readonly measure = signal<Measure>('pages');
  protected readonly details = inject(BookDetailsService);

  private readonly db = inject(DB);
  private readonly repo = inject(Repo);
  private readonly injector = inject(Injector);
  private readonly clock = inject(CLOCK);
  private readonly settings = inject(SettingsService);
  private readonly annotationService = inject(AnnotationService);
  private readonly marks = inject(ReadMarkService);
  private readonly sessionSignals = new Map<ID, Signal<ReadingSession[] | undefined>>();

  // The per-book live signals are created outside the reactive context (toSignal is not allowed inside it).
  private readonly sessions = computed(() => {
    const id = this.book().id;
    return untracked(() => this.sessionsOf(id))();
  });
  private readonly annotations = computed(() => {
    const id = this.book().id;
    return untracked(() => this.annotationService.forBook(id))();
  });
  private readonly marked = computed(() => {
    const id = this.book().id;
    return untracked(() => this.marks.marked(id))() ?? new Set<number>();
  });

  protected readonly ready = computed(() => this.sessions() !== undefined && this.annotations() !== undefined);
  protected readonly total = computed(() => totals(this.sessions() ?? []));
  protected readonly empty = computed(() => this.total().sessions === 0);
  protected readonly duration = computed(() => formatDuration(this.total().ms));
  protected readonly avg = computed(() => formatAvg(this.total().avgMsPerPage));

  protected readonly counts = computed(() => {
    const out: Record<Annotation['type'], number> = { highlight: 0, note: 0, area: 0, 'side-note': 0, summary: 0, bookmark: 0 };
    for (const a of this.annotations() ?? []) if (!a.deleted) out[a.type]++;
    return out;
  });

  protected readonly bars = computed<ChartBar[]>(() => {
    const sessions = this.sessions() ?? [];
    const stats = new Map(dayStats(sessions).map((d) => [d.day, d]));
    const first = [dayKey(this.book().addedAt), ...stats.keys()].sort()[0];
    const [y, m, d] = first.split('-').map(Number);
    const now = this.clock.now();
    const today = dayKey(now);
    const days = [];
    for (let i = 0; i < 5000; i++) {
      const key = dayKey(new Date(y, m - 1, d + i).getTime());
      if (key > today) break;
      days.push(stats.get(key) ?? { day: key, pages: 0, ms: 0 });
    }
    const weekly = days.length > 60;
    const fmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
    const at = (day: string) => {
      const [yy, mm, dd] = day.split('-').map(Number);
      return new Date(yy, mm - 1, dd);
    };
    return groupWeekly(days, this.settings.settings().weekStartsOn).map((s) => {
      const value = this.measure() === 'pages' ? s.pages : s.ms / 60_000;
      const when = fmt.format(at(s.day));
      const what = this.measure() === 'pages' ? `${s.pages} ${this.c.pages.toLowerCase()}` : formatDuration(s.ms);
      return { label: weekly ? when : String(at(s.day).getDate()), value, tooltip: `${weekly ? `${this.c.weekOf} ` : ''}${when}: ${what}` };
    });
  });

  protected readonly chapters = computed(() => {
    const book = this.book();
    const marked = this.marked();
    return flattenOutline(book.outline).map(({ node, depth }) => {
      const { fraction } = chapterProgress(book, node, marked);
      return { key: node.key, title: node.title, depth, pct: Math.round(fraction * 100) };
    });
  });

  protected date(ms: number | undefined): string {
    if (ms === undefined || !Number.isFinite(ms)) return STATS_COPY.notYet;
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(ms);
  }

  private sessionsOf(bookId: ID): Signal<ReadingSession[] | undefined> {
    let sig = this.sessionSignals.get(bookId);
    if (!sig) {
      sig = runInInjectionContext(this.injector, () =>
        this.repo.live(() => this.db.sessions.where('bookId').equals(bookId).filter((s) => !s.deleted).toArray()),
      );
      this.sessionSignals.set(bookId, sig);
    }
    return sig;
  }
}
