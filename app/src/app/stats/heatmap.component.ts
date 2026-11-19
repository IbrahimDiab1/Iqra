import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, effect, inject, input, output, viewChild } from '@angular/core';
import type { Category } from '../core/models';
import { formatDuration } from './format';
import { categoryHue, dayLabel, gridColumns, intensityLevel, type HeatDay, type HeatMeasure } from './heatmap';
import { STATS_COPY } from './stats-copy';
import type { WeekStartsOn } from './week';

const H = STATS_COPY.heat;
const LABEL_COL_PX = 28;
const GAP_PX = 2;
/** The least width of a block, so a year scrolls inside its box on a narrow screen instead of squashing. */
const MIN_CELL_PX: Record<'month' | 'year', number> = { month: 34, year: 10 };
/** The most, so a month does not become a wall of huge squares on a wide screen. */
const MAX_CELL_PX: Record<'month' | 'year', number> = { month: 48, year: 16 };
const ROWS = [0, 1, 2, 3, 4, 5, 6] as const;

interface CellView {
  day: string;
  level: 0 | 1 | 2 | 3 | 4;
  hue: string;
  label: string;
}

/**
 * A GitHub-style block grid for one month or year: weeks are columns, the first row is the week start.
 * A block is coloured by the category that took the most reading time that day, in four intensities
 * (none plus four, relative to the busiest day shown). One tab stop; arrows move by day (Up/Down) and week (Left/Right).
 */
@Component({
  selector: 'iqra-heatmap',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div #scroll class="scroll">
      <div class="map" role="grid" [class.month]="period() === 'month'" [attr.aria-label]="label" [attr.aria-rowcount]="7" [attr.aria-colcount]="columns().length" [style.min-width.px]="minWidth()" (keydown)="onKey($event)">
        @if (period() === 'year') {
          <div class="row months" aria-hidden="true" [style.grid-template-columns]="template()">
            <span></span>
            @for (name of monthLabels(); track $index) {
              <span class="mlabel">{{ name }}</span>
            }
          </div>
        }
        @for (row of rows; track row) {
          <div class="row" role="row" [style.grid-template-columns]="template()">
            <span class="wd" aria-hidden="true">{{ weekdayLabel(row) }}</span>
            @for (col of columns(); track $index) {
              <div role="gridcell" class="cellbox">
                @if (col[row]; as c) {
                  <button
                    type="button"
                    class="cell"
                    [class.sel]="c.day === selected()"
                    [attr.data-day]="c.day"
                    [attr.data-level]="c.level"
                    [attr.aria-label]="c.label"
                    [attr.aria-pressed]="c.day === selected()"
                    [attr.tabindex]="c.day === tabDay() ? 0 : -1"
                    [style.--cell]="c.hue"
                    (click)="pick.emit(c.day)"
                  ></button>
                }
              </div>
            }
          </div>
        }
      </div>
    </div>
    <div class="scale" aria-hidden="true">
      <span>{{ less }}</span>
      @for (level of levels; track level) {
        <span class="swatch" [attr.data-level]="level"></span>
      }
      <span>{{ more }}</span>
    </div>
  `,
  styles: `
    :host { display: block; --cell: var(--accent); }
    .scroll { overflow-x: auto; padding: 3px; }
    .row { display: grid; justify-content: start; align-items: center; gap: ${GAP_PX}px; margin-bottom: ${GAP_PX}px; }
    .wd, .mlabel { color: var(--muted); font-size: 11px; line-height: 1; white-space: nowrap; }
    .mlabel { overflow: visible; padding-bottom: 4px; }
    .cellbox { min-width: 0; }
    .cell {
      display: block;
      width: 100%;
      aspect-ratio: 1;
      padding: 0;
      border: 0;
      border-radius: 3px;
      background: var(--surface-2);
      cursor: pointer;
    }
    .map.month .cell { border-radius: 8px; }
    .cell[data-level='1'], .swatch[data-level='1'] { background: color-mix(in srgb, var(--cell) 30%, var(--surface-2)); }
    .cell[data-level='2'], .swatch[data-level='2'] { background: color-mix(in srgb, var(--cell) 52%, var(--surface-2)); }
    .cell[data-level='3'], .swatch[data-level='3'] { background: color-mix(in srgb, var(--cell) 76%, var(--surface-2)); }
    .cell[data-level='4'], .swatch[data-level='4'] { background: var(--cell); }
    .cell:hover { outline: 1px solid var(--muted); }
    .cell.sel { outline: 2px solid var(--fg); outline-offset: 1px; }
    .cell:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .scale { display: flex; align-items: center; justify-content: flex-end; gap: 4px; margin-top: 6px; color: var(--muted); font-size: 11px; }
    .swatch { width: 12px; height: 12px; border-radius: 3px; background: var(--surface-2); }
  `,
})
export class HeatmapComponent {
  readonly period = input.required<'month' | 'year'>();
  /** Any moment inside the month or year to draw. */
  readonly anchor = input.required<number>();
  readonly weekStartsOn = input.required<WeekStartsOn>();
  readonly days = input<readonly HeatDay[]>([]);
  /** The live categories, for each hue and the category name in a label. */
  readonly categories = input<readonly Category[]>([]);
  readonly measure = input<HeatMeasure>('pages');
  readonly selected = input<string | null>(null);
  /** True to start scrolled to the most recent weeks (the current year). */
  readonly scrollToEnd = input(false);
  readonly pick = output<string>();

  private readonly injector = inject(Injector);
  private readonly scroll = viewChild.required<ElementRef<HTMLElement>>('scroll');

  protected readonly label = H.label;
  protected readonly less = H.less;
  protected readonly more = H.more;
  protected readonly rows = ROWS;
  protected readonly levels = [0, 1, 2, 3, 4] as const;

  private readonly grid = computed(() => gridColumns(this.period(), this.anchor(), this.weekStartsOn()));
  private readonly byDay = computed(() => new Map(this.days().map((d) => [d.day, d])));
  private readonly max = computed(() => this.days().reduce((m, d) => (Number.isFinite(d.value) ? Math.max(m, d.value) : m), 0));
  private readonly categoryById = computed(() => new Map(this.categories().map((c) => [c.id, c])));

  /** The grid as columns of seven views; padding is null. */
  protected readonly columns = computed<(CellView | null)[][]>(() => {
    const byDay = this.byDay();
    const max = this.max();
    const categories = this.categoryById();
    return this.grid().map((col) =>
      col.map((cell) => {
        if (cell.day === null) return null;
        const reading = byDay.get(cell.day);
        const date = dayLabel(cell.day);
        if (!reading) return { day: cell.day, level: 0, hue: 'var(--accent)', label: `${date} · ${H.none}` };
        const category = reading.categoryId === null ? undefined : categories.get(reading.categoryId);
        const hue = category ? `var(--cat-${categoryHue(category.order)})` : 'var(--accent)';
        const text = [date, H.pages(reading.pages), formatDuration(reading.ms), category?.name ?? H.uncategorized].join(' · ');
        return { day: cell.day, level: intensityLevel(reading.value, max), hue, label: text };
      }),
    );
  });

  protected readonly template = computed(() => `${LABEL_COL_PX}px repeat(${this.grid().length}, minmax(${MIN_CELL_PX[this.period()]}px, ${MAX_CELL_PX[this.period()]}px))`);
  protected readonly minWidth = computed(() => LABEL_COL_PX + this.grid().length * (MIN_CELL_PX[this.period()] + GAP_PX));

  /** The month name above the column that holds the 1st of that month, blank elsewhere. */
  protected readonly monthLabels = computed(() => {
    const format = new Intl.DateTimeFormat(undefined, { month: 'short' });
    return this.grid().map((col) => {
      const first = col.find((c) => c.day?.endsWith('-01'));
      if (!first?.day) return '';
      const [y, m] = first.day.split('-').map(Number);
      return format.format(new Date(y, m - 1, 1));
    });
  });

  private readonly allDays = computed(() => this.grid().flatMap((col) => col.map((c) => c.day).filter((d): d is string => d !== null)));

  /** The day that holds the tab stop: the selected one, else the latest with reading, else the first. */
  protected readonly tabDay = computed(() => {
    const all = this.allDays();
    const selected = this.selected();
    if (selected && all.includes(selected)) return selected;
    const withReading = all.filter((d) => this.byDay().has(d));
    return withReading.at(-1) ?? all[0] ?? null;
  });

  constructor() {
    // Opens a current year at its latest weeks.
    effect(() => {
      this.period();
      this.anchor();
      if (!this.scrollToEnd()) return;
      afterNextRender(
        () => {
          const el = this.scroll().nativeElement;
          el.scrollTo?.({ left: getComputedStyle(el).direction === 'rtl' ? -el.scrollWidth : el.scrollWidth });
        },
        { injector: this.injector },
      );
    });
  }

  protected weekdayLabel(row: number): string {
    // Every weekday in a month; Monday, Wednesday and Friday style (rows 1, 3, 5) in a year, as on GitHub.
    if (this.period() === 'year' && row % 2 === 0) return '';
    const dow = (this.weekStartsOn() + row) % 7;
    // 4 Jan 2026 is a Sunday.
    return new Intl.DateTimeFormat(undefined, { weekday: this.period() === 'year' ? 'short' : 'narrow' }).format(new Date(2026, 0, 4 + dow));
  }

  /** Up and Down step one day, Left and Right one week; Home and End go to the first and last day. Never leaves the period. */
  protected onKey(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    const from = target.dataset['day'];
    if (!from || event.altKey || event.ctrlKey || event.metaKey) return;
    const all = this.allDays();
    const at = all.indexOf(from);
    const rtl = getComputedStyle(this.scroll().nativeElement).direction === 'rtl';
    const weekRight = rtl ? -7 : 7;
    let next = -1;
    switch (event.key) {
      case 'ArrowDown': next = at + 1; break;
      case 'ArrowUp': next = at - 1; break;
      case 'ArrowRight': next = at + weekRight; break;
      case 'ArrowLeft': next = at - weekRight; break;
      case 'Home': next = 0; break;
      case 'End': next = all.length - 1; break;
      default: return;
    }
    event.preventDefault();
    const day = all[next] ?? from;
    const button = this.scroll().nativeElement.querySelector<HTMLElement>(`[data-day="${day}"]`);
    button?.focus();
  }
}
