import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Category } from '../core/models';
import { HeatmapComponent } from './heatmap.component';
import type { HeatDay } from './heatmap';
import type { WeekStartsOn } from './week';

const local = (y: number, month: number, d: number) => new Date(y, month - 1, d).getTime();
const MIN = 60_000;
const cat = (id: string, name: string, order: number): Category => ({ id, name, order, updatedAt: 0, deviceId: 'd' });
const day = (d: string, value: number, over: Partial<HeatDay> = {}): HeatDay => ({
  day: d, value, pages: value, ms: value * 2 * MIN, categoryId: null, bookId: 'b', ...over,
});

describe('HeatmapComponent', () => {
  let fixture: ComponentFixture<HeatmapComponent>;
  let el: HTMLElement;
  let picked: string[];

  function render(inputs: {
    period?: 'month' | 'year';
    anchor?: number;
    weekStartsOn?: WeekStartsOn;
    days?: HeatDay[];
    categories?: Category[];
    measure?: 'pages' | 'time';
    selected?: string | null;
  } = {}): void {
    fixture = TestBed.createComponent(HeatmapComponent);
    el = fixture.nativeElement as HTMLElement;
    const ref = fixture.componentRef;
    ref.setInput('period', inputs.period ?? 'month');
    ref.setInput('anchor', inputs.anchor ?? local(2026, 11, 19));
    ref.setInput('weekStartsOn', inputs.weekStartsOn ?? 6);
    ref.setInput('days', inputs.days ?? []);
    ref.setInput('categories', inputs.categories ?? []);
    ref.setInput('measure', inputs.measure ?? 'pages');
    ref.setInput('selected', inputs.selected ?? null);
    picked = [];
    fixture.componentInstance.pick.subscribe((d) => picked.push(d));
    fixture.detectChanges();
  }

  const rowEls = () => Array.from(el.querySelectorAll<HTMLElement>('[role="row"]'));
  const weekdayLabels = () => Array.from(el.querySelectorAll('.wd')).map((w) => w.textContent!.trim()).filter(Boolean);
  const cells = () => Array.from(el.querySelectorAll<HTMLButtonElement>('button[data-day]'));
  const cellOf = (d: string) => el.querySelector<HTMLButtonElement>(`button[data-day="${d}"]`)!;
  const key = (target: HTMLElement, k: string) => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    fixture.detectChanges();
  };

  beforeEach(() => TestBed.configureTestingModule({}));

  describe('layout', () => {
    it('a year has one grid column per week: 53 for 2026 with Saturday weeks, and a cell for each day', () => {
      render({ period: 'year' });
      expect(el.querySelectorAll('[role="row"]')).toHaveLength(7);
      expect(rowEls()[0].querySelectorAll('[role="gridcell"]')).toHaveLength(53);
      expect(cells()).toHaveLength(365);
    });

    it('a leap year that needs 54 weeks draws 54 columns', () => {
      render({ period: 'year', anchor: local(2028, 6, 1), weekStartsOn: 0 });
      expect(rowEls()[0].querySelectorAll('[role="gridcell"]')).toHaveLength(54);
      expect(cells()).toHaveLength(366);
    });

    it('a month draws its weeks as columns', () => {
      render({ period: 'month' });
      expect(rowEls()[0].querySelectorAll('[role="gridcell"]')).toHaveLength(5);
      expect(cells()).toHaveLength(30);
    });

    it('the first row is the week start: every cell in row 0 falls on weekStartsOn', () => {
      for (const ws of [0, 1, 6] as const) {
        render({ period: 'year', weekStartsOn: ws });
        const firstRow = rowEls()[0].querySelectorAll<HTMLButtonElement>('button[data-day]');
        expect(firstRow.length).toBeGreaterThan(50);
        for (const b of Array.from(firstRow)) {
          const [y, m, d] = b.dataset['day']!.split('-').map(Number);
          expect(new Date(y, m - 1, d).getDay()).toBe(ws);
        }
        fixture.destroy();
      }
    });

    it('labels the months along the top of a year and the weekdays down the side', () => {
      render({ period: 'year' });
      const months = Array.from(el.querySelectorAll('.mlabel')).map((m) => m.textContent!.trim()).filter(Boolean);
      expect(months).toHaveLength(12);
      expect(weekdayLabels()).toHaveLength(3);
    });

    it('a month labels all seven weekdays and has no month row', () => {
      render({ period: 'month' });
      expect(weekdayLabels()).toHaveLength(7);
      expect(el.querySelector('.mlabel')).toBeNull();
    });

    it('shows the intensity scale', () => {
      render();
      expect(el.querySelectorAll('.scale [data-level]')).toHaveLength(5);
    });
  });

  describe('colour and intensity', () => {
    it('gives days with no reading level 0 and scales the rest to the largest day', () => {
      render({
        days: [day('2026-11-02', 100), day('2026-11-03', 25), day('2026-11-04', 26), day('2026-11-05', 51), day('2026-11-06', 76), day('2026-11-07', 0)],
      });
      const level = (d: string) => cellOf(d).dataset['level'];
      expect(['2026-11-01', '2026-11-07', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-02'].map(level)).toEqual(['0', '0', '1', '2', '3', '4', '4']);
    });

    it('uses the hue of the winning category by its order, and the accent for uncategorized', () => {
      render({
        categories: [cat('a', 'Fiqh', 0), cat('i', 'Ninth', 9)],
        days: [day('2026-11-02', 5, { categoryId: 'a' }), day('2026-11-03', 5, { categoryId: 'i' }), day('2026-11-04', 5, { categoryId: null })],
      });
      const hue = (d: string) => cellOf(d).style.getPropertyValue('--cell');
      expect(hue('2026-11-02')).toBe('var(--cat-1)');
      expect(hue('2026-11-03')).toBe('var(--cat-2)');
      expect(hue('2026-11-04')).toBe('var(--accent)');
    });

    it('draws a period with no reading as all-empty blocks, with no NaN anywhere', () => {
      render({ period: 'year' });
      expect(cells().every((c) => c.dataset['level'] === '0')).toBe(true);
      expect(el.textContent).not.toContain('NaN');
      expect(cells().every((c) => !c.getAttribute('aria-label')!.includes('NaN'))).toBe(true);
    });
  });

  describe('labels and selection', () => {
    it('labels a day with its date, pages, time and category, and an empty day as no reading', () => {
      render({ categories: [cat('a', 'Fiqh', 0)], days: [day('2026-11-14', 23, { ms: 41 * MIN, categoryId: 'a' })] });
      const label = cellOf('2026-11-14').getAttribute('aria-label')!;
      expect(label).toMatch(/^Sat 14 Nov · 23 pages · 41 min · Fiqh$/);
      expect(cellOf('2026-11-15').getAttribute('aria-label')).toMatch(/^Sun 15 Nov · No reading$/);
    });

    it('names uncategorized reading and a single page', () => {
      render({ days: [day('2026-11-14', 1, { ms: 90 * MIN })] });
      expect(cellOf('2026-11-14').getAttribute('aria-label')).toBe(`${cellOf('2026-11-14').getAttribute('aria-label')!.split(' · ')[0]} · 1 page · 1 h 30 min · Uncategorized`);
    });

    it('a click emits the day, and the selected day is marked', () => {
      render({ selected: '2026-11-10' });
      cellOf('2026-11-12').click();
      expect(picked).toEqual(['2026-11-12']);
      expect(cellOf('2026-11-10').getAttribute('aria-pressed')).toBe('true');
      expect(cellOf('2026-11-12').getAttribute('aria-pressed')).toBe('false');
    });

    it('is a grid with a name', () => {
      render();
      const grid = el.querySelector('[role="grid"]')!;
      expect(grid.getAttribute('aria-label')).toBe('Reading by day');
    });
  });

  describe('keyboard', () => {
    const stops = () => cells().filter((c) => c.tabIndex === 0).map((c) => c.dataset['day']);

    it('has a single tab stop: the selected day, else the latest day with reading, else the first day', () => {
      render({ days: [day('2026-11-05', 3), day('2026-11-20', 3)] });
      expect(stops()).toEqual(['2026-11-20']);
      fixture.componentRef.setInput('selected', '2026-11-12');
      fixture.detectChanges();
      expect(stops()).toEqual(['2026-11-12']);
      fixture.componentRef.setInput('days', []);
      fixture.componentRef.setInput('selected', null);
      fixture.detectChanges();
      expect(stops()).toEqual(['2026-11-01']);
    });

    it('Up and Down move one day, Left and Right one week', () => {
      render({ selected: '2026-11-10' });
      const at = () => document.activeElement?.getAttribute('data-day');
      cellOf('2026-11-10').focus();
      key(cellOf('2026-11-10'), 'ArrowDown');
      expect(at()).toBe('2026-11-11');
      key(cellOf('2026-11-11'), 'ArrowRight');
      expect(at()).toBe('2026-11-18');
      key(cellOf('2026-11-18'), 'ArrowLeft');
      expect(at()).toBe('2026-11-11');
      key(cellOf('2026-11-11'), 'ArrowUp');
      expect(at()).toBe('2026-11-10');
      expect(stops()).toEqual(['2026-11-10']);
    });

    it('stays put at the edges of the period and Home and End jump to its first and last day', () => {
      render({ selected: '2026-11-01' });
      const at = () => document.activeElement?.getAttribute('data-day');
      cellOf('2026-11-01').focus();
      key(cellOf('2026-11-01'), 'ArrowUp');
      expect(at()).toBe('2026-11-01');
      key(cellOf('2026-11-01'), 'ArrowLeft');
      expect(at()).toBe('2026-11-01');
      key(cellOf('2026-11-01'), 'End');
      expect(at()).toBe('2026-11-30');
      key(cellOf('2026-11-30'), 'ArrowDown');
      expect(at()).toBe('2026-11-30');
      key(cellOf('2026-11-30'), 'Home');
      expect(at()).toBe('2026-11-01');
    });

    it('mirrors Left and Right in right-to-left', () => {
      render({ selected: '2026-11-10' });
      el.setAttribute('dir', 'rtl');
      const at = () => document.activeElement?.getAttribute('data-day');
      cellOf('2026-11-10').focus();
      key(cellOf('2026-11-10'), 'ArrowLeft');
      expect(at()).toBe('2026-11-17');
      key(cellOf('2026-11-17'), 'ArrowRight');
      expect(at()).toBe('2026-11-10');
    });

    it('never leaves the period: an arrow that would land outside it stays on the day', () => {
      render({ selected: '2026-11-02' });
      const at = () => document.activeElement?.getAttribute('data-day');
      cellOf('2026-11-02').focus();
      // One week back from 2 Nov would be 26 Oct, which belongs to October.
      key(cellOf('2026-11-02'), 'ArrowLeft');
      expect(at()).toBe('2026-11-02');
    });
  });
});
