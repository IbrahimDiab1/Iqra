import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { DayStat } from './aggregate';
import { STATS_COPY } from './stats-copy';
import { dayKey, weekStart, type WeekStartsOn } from './week';

const SLOT = 40; // px per bar: also the tap target width
const BAR = 24;
const HEIGHT = 120;
const LABEL_ROOM = 20;

export interface ChartBar {
  label: string;
  value: number;
  tooltip: string;
}

/** More than `threshold` daily bars become weekly bars (the day is the week's first day). Input is in day order. */
export function groupWeekly(days: DayStat[], weekStartsOn: WeekStartsOn = 6, threshold = 60): DayStat[] {
  if (days.length <= threshold) return days;
  const weeks = new Map<string, DayStat>();
  for (const d of days) {
    const [y, m, dd] = d.day.split('-').map(Number);
    const key = dayKey(weekStart(new Date(y, m - 1, dd).getTime(), weekStartsOn));
    const w = weeks.get(key);
    if (w) {
      w.pages += d.pages;
      w.ms += d.ms;
    } else {
      weeks.set(key, { day: key, pages: d.pages, ms: d.ms });
    }
  }
  return [...weeks.values()];
}

/** A plain SVG bar chart. Bars scale to the largest value; scrolls sideways when there are many. */
@Component({
  selector: 'iqra-bar-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (shape(); as s) {
      <div class="scroll">
        <svg role="img" [attr.aria-label]="label()" [attr.width]="s.width" [attr.height]="s.height" [attr.viewBox]="'0 0 ' + s.width + ' ' + s.height">
          @for (b of s.bars; track $index) {
            <g>
              <rect class="slot" [attr.x]="b.x" y="0" [attr.width]="slot" [attr.height]="s.height" fill="transparent" />
              <rect class="bar" [attr.x]="b.x + (slot - bar) / 2" [attr.y]="b.y" [attr.width]="bar" [attr.height]="b.h" rx="4">
                <title>{{ b.tooltip }}</title>
              </rect>
              @if (b.showLabel) {
                <text class="lbl" [attr.x]="b.x + slot / 2" [attr.y]="s.height - 5" text-anchor="middle">{{ b.label }}</text>
              }
            </g>
          }
        </svg>
      </div>
    } @else {
      <p class="empty">{{ noData }}</p>
    }
  `,
  styles: `
    :host { display: block; }
    .scroll { overflow-x: auto; }
    svg { display: block; }
    .bar { fill: var(--accent); }
    .lbl { fill: var(--muted); font: 11px var(--ui); }
    .empty { margin: 8px 0; color: var(--muted); font-size: 14px; }
  `,
})
export class ChartComponent {
  readonly bars = input<ChartBar[]>([]);
  readonly unit = input<'pages' | 'time'>('pages');
  /** Accessible name for the chart. */
  readonly label = input('');

  protected readonly noData = STATS_COPY.noData;
  protected readonly slot = SLOT;
  protected readonly bar = BAR;

  protected readonly shape = computed(() => {
    const bars = this.bars();
    const values = bars.map((b) => (Number.isFinite(b.value) && b.value > 0 ? b.value : 0));
    const max = Math.max(0, ...values);
    if (bars.length === 0 || max === 0) return null;
    const plot = HEIGHT - LABEL_ROOM;
    const every = bars.length <= 14 ? 1 : 7;
    return {
      width: bars.length * SLOT,
      height: HEIGHT,
      bars: bars.map((b, i) => {
        const h = values[i] === 0 ? 0 : Math.max(2, Math.round((values[i] / max) * plot));
        return { x: i * SLOT, y: plot - h, h, label: b.label, tooltip: b.tooltip, showLabel: i % every === 0 };
      }),
    };
  });
}
