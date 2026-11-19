import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ChartComponent, groupWeekly } from './chart.component';
import type { DayStat } from './aggregate';
import { dayKey } from './week';
import { STATS_COPY } from './stats-copy';

function consecutive(startMs: number, n: number): DayStat[] {
  return Array.from({ length: n }, (_, i) => ({
    day: dayKey(new Date(new Date(startMs).getFullYear(), new Date(startMs).getMonth(), new Date(startMs).getDate() + i).getTime()),
    pages: 1,
    ms: 60_000,
  }));
}

describe('groupWeekly', () => {
  // 2026-11-14 is a Saturday.
  const sat = new Date(2026, 10, 14).getTime();

  it('groups more than 60 days into weeks (9 bars for 62 days from a week start)', () => {
    const weeks = groupWeekly(consecutive(sat, 62), 6);
    expect(weeks).toHaveLength(9);
    expect(weeks[0]).toEqual({ day: '2026-11-14', pages: 7, ms: 7 * 60_000 });
    expect(weeks[8].pages).toBe(6);
  });

  it('passes 60 days or fewer through unchanged', () => {
    const days = consecutive(sat, 60);
    expect(groupWeekly(days, 6)).toEqual(days);
  });

  it('starts weeks on the given day', () => {
    const weeks = groupWeekly(consecutive(sat, 62), 0);
    expect(weeks[0].day).toBe('2026-11-08');
  });
});

describe('ChartComponent', () => {
  let fixture: ComponentFixture<ChartComponent>;

  function render(bars: { label: string; value: number; tooltip: string }[]): HTMLElement {
    fixture = TestBed.createComponent(ChartComponent);
    fixture.componentRef.setInput('bars', bars);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders one rect per bar with a title', () => {
    const el = render([
      { label: 'S', value: 4, tooltip: '4 pages' },
      { label: 'S', value: 0, tooltip: '0 pages' },
      { label: 'M', value: 8, tooltip: '8 pages' },
    ]);
    expect(el.querySelectorAll('rect.bar')).toHaveLength(3);
    expect(el.querySelectorAll('title')[2].textContent).toBe('8 pages');
    const heights = [...el.querySelectorAll('rect.bar')].map((r) => Number(r.getAttribute('height')));
    expect(heights[2]).toBeGreaterThan(heights[0]);
    expect(heights[1]).toBe(0);
  });

  it('shows the no-data text when empty or all zero', () => {
    expect(render([]).textContent).toContain(STATS_COPY.noData);
    expect(render([{ label: 'S', value: 0, tooltip: '' }]).textContent).toContain(STATS_COPY.noData);
  });
});
