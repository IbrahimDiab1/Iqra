import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOCK } from '../core/clock';
import { DB, IqraDb } from '../core/db';
import { newId } from '../core/ids';
import type { Book, Goal, ReadingSession, Settings } from '../core/models';
import { ToastService } from '../ui/toast.service';
import { StatsPage } from './stats.page';
import { STATS_COPY } from './stats-copy';

// Thursday 2026-11-19, 12:00 local. With Saturday weeks: this week Nov 14 - 20, last week Nov 7 - 13.
const NOW = new Date(2026, 10, 19, 12).getTime();
const at = (m: number, d: number, h = 10) => new Date(2026, m - 1, d, h).getTime();
const range = (n: number, from = 1) => Array.from({ length: n }, (_, i) => from + i);

function makeBook(id: string, over: Partial<Book> = {}): Book {
  return {
    id, deviceId: 'dev', updatedAt: 1, title: `Book ${id}`, author: 'A', driveFileId: 'd', fileName: `${id}.pdf`, sizeBytes: 1,
    sha256: id, pageCount: 200, outline: [], language: 'en', direction: 'ltr', addedAt: 1, status: 'reading',
    categoryIds: [], tags: [], progressMode: 'last-page', pageMode: 'swipe', lastPageReached: 0, ...over,
  };
}

function session(id: string, startedAt: number, pages: number[], activeMs = 600_000, bookId = 'b1'): ReadingSession {
  return { id, deviceId: 'dev', updatedAt: 1, bookId, startedAt, endedAt: startedAt + activeMs, activeMs, pagesRead: pages };
}

function goal(id: string, over: Partial<Goal> = {}): Goal {
  return { id, deviceId: 'dev', updatedAt: 1, categoryId: null, measure: 'pages', target: 20, ...over };
}

describe('StatsPage', () => {
  let clockNow = NOW;
  let db: IqraDb;
  let fixture: ComponentFixture<StatsPage>;
  let el: HTMLElement;

  async function create(): Promise<void> {
    fixture = TestBed.createComponent(StatsPage);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(el.querySelector('[data-ready]')).not.toBeNull();
    });
  }
  const text = () => el.textContent!.replace(/\s+/g, ' ');

  beforeEach(async () => {
    localStorage.clear();
    clockNow = NOW;
    db = new IqraDb(`iqra-test-${newId()}`);
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: DB, useValue: db }, { provide: CLOCK, useValue: { now: () => clockNow } }],
    });
    await db.books.put(makeBook('b1', { categoryIds: ['c1'] }));
    await db.categories.put({ id: 'c1', deviceId: 'dev', updatedAt: 1, name: 'Fiqh', order: 0 });
  });

  afterEach(async () => {
    fixture?.destroy();
    TestBed.resetTestingModule();
    await db.delete();
  });

  it('shows the Saturday-based week range by default', async () => {
    await create();
    expect(text()).toContain('This week · Nov 14 – 20');
  });

  it('follows Settings.weekStartsOn', async () => {
    const s: Settings = {
      id: 'settings', deviceId: 'd', updatedAt: 1, defaultProgressMode: 'last-page', defaultPageMode: 'swipe', defaultView: 'page',
      readerTheme: 'paper', weekStartsOn: 0, reminders: {}, cardDirection: 'en-ar',
    };
    await db.settings.put(s);
    await create();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(text()).toContain('This week · Nov 15 – 21');
    });
  });

  it('shows empty states for a new user', async () => {
    await create();
    expect(text()).toContain(STATS_COPY.noGoals);
    expect(text()).toContain(STATS_COPY.noReading);
    expect(text()).not.toContain('NaN');
  });

  it('shows page and time deltas against last week', async () => {
    await db.sessions.bulkPut([
      session('s1', at(11, 16), range(20), 3_600_000), // this week: 20 pages, 60 min
      session('s2', at(11, 10), range(8), 3_600_000 + 12 * 60_000), // last week: 8 pages, 72 min
    ]);
    await create();
    const pages = el.querySelector('[data-total="pages"]')!;
    const time = el.querySelector('[data-total="time"]')!;
    expect(pages.textContent).toContain('20');
    expect(pages.textContent).toContain('+12 vs last week');
    expect(time.textContent).toContain('1 h 00 min');
    expect(time.textContent).toContain('−12 min vs last week');
  });

  it('says Same as last week when nothing changed', async () => {
    await db.sessions.bulkPut([session('s1', at(11, 16), range(5)), session('s2', at(11, 10), range(5))]);
    await create();
    expect(el.querySelector('[data-total="pages"]')!.textContent).toContain('Same as last week');
  });

  it('renders a goal with 10 of 20 pages as a 50% bar', async () => {
    await db.goals.put(goal('g1'));
    await db.sessions.put(session('s1', at(11, 16), range(10)));
    await create();
    expect(text()).toContain('Pages · 10 of 20');
    expect(text()).toContain('All books');
    expect(el.querySelector('.goal [role=progressbar]')!.getAttribute('aria-valuenow')).toBe('50');
  });

  it('labels time goals in hours and uses the category name', async () => {
    await db.goals.put(goal('g1', { measure: 'time', target: 300, categoryId: 'c1' }));
    await db.sessions.put(session('s1', at(11, 16), [1], 3 * 3_600_000));
    await create();
    expect(text()).toContain('Reading · 3 h of 5 h');
    expect(text()).toContain('Fiqh');
  });

  it('a goal whose category was deleted falls back to the label and is excluded from the maths', async () => {
    await db.goals.put(goal('g1', { categoryId: 'gone', target: 10 }));
    await db.sessions.put(session('s1', at(11, 16), range(10)));
    await create();
    expect(text()).toContain(STATS_COPY.categoryGone);
    expect(el.querySelector('.goal [role=progressbar]')!.getAttribute('aria-valuenow')).toBe('0');
  });

  it('does not count sessions of deleted books', async () => {
    await db.books.put(makeBook('b2', { deleted: true }));
    await db.sessions.put(session('s1', at(11, 16), range(9), 600_000, 'b2'));
    await create();
    expect(text()).toContain(STATS_COPY.noReading);
  });

  it('deleting a goal from its editor shows Undo', async () => {
    await db.goals.put(goal('g1'));
    await create();
    el.querySelector<HTMLButtonElement>('.goal button.goal-open')!.click();
    fixture.detectChanges();
    [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent!.trim() === STATS_COPY.goals.delete)!.click();
    const toast = TestBed.inject(ToastService);
    await vi.waitFor(() => expect(toast.current()?.undo).toBeTypeOf('function'));
    await vi.waitFor(async () => expect((await db.goals.get('g1'))!.deleted).toBe(true));
  });

  it('tapping Add goal opens the editor', async () => {
    await create();
    [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent!.trim() === STATS_COPY.goals.add)!.click();
    fixture.detectChanges();
    expect(el.querySelector('#goal-target')).not.toBeNull();
    expect(el.querySelector('iqra-goal-editor-sheet [role=dialog]')!.getAttribute('aria-hidden')).toBeNull();
  });

  it('draws seven day bars for the week with weekday labels', async () => {
    await db.sessions.put(session('s1', at(11, 16), range(4)));
    await create();
    expect(el.querySelectorAll('.week-chart rect.bar')).toHaveLength(7);
    expect(el.querySelectorAll('.week-chart text.lbl')).toHaveLength(7);
  });

  it('moves to the next week when the app comes back after the rollover', async () => {
    await create();
    expect(text()).toContain('This week · Nov 14 – 20');
    clockNow = new Date(2026, 10, 21, 0, 5).getTime();
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(text()).toContain('This week · Nov 21 – 27');
    });
  });

  it('a minute timer refreshes the week and stops when the page is destroyed', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      await create();
      clockNow = new Date(2026, 10, 21, 0, 5).getTime();
      await vi.advanceTimersByTimeAsync(60_000);
      fixture.detectChanges();
      expect(text()).toContain('This week · Nov 21 – 27');
      fixture.destroy();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  describe('overview and all time', () => {
    const tile = (sel: string) => el.querySelector<HTMLElement>(sel)!.textContent!.replace(/\s+/g, ' ');

    it('no longer lists books in progress', async () => {
      await create();
      expect(el.querySelector('.progress-row')).toBeNull();
      expect(text()).not.toContain('Books in progress');
    });

    it('shows today vs the daily goal the user set, and both streaks', async () => {
      await db.goals.put(goal('g1', { measure: 'pages', target: 3, period: 'day' }));
      await db.goals.put(goal('g2', { measure: 'time', target: 20, period: 'day' }));
      await db.sessions.bulkPut([
        session('s0', at(11, 17), range(2)),
        session('s1', at(11, 18), range(2)),
        session('s2', at(11, 19, 9), range(2), 600_000),
        session('s3', at(11, 1), range(2)),
        session('s4', at(11, 2), range(2)),
        session('s5', at(11, 3), range(2)),
        session('s6', at(11, 4), range(2)),
        session('s7', at(11, 5), range(2)),
      ]);
      await create();
      expect(tile('[data-today="pages"]')).toContain('2');
      expect(tile('[data-today="pages"]')).toContain('of 3 daily goal');
      expect(tile('[data-today="time"]')).toContain('10 min');
      expect(tile('[data-today="time"]')).toContain('of 20 min daily goal');
      expect(el.querySelector('[data-today="pages"] [role=progressbar]')!.getAttribute('aria-valuenow')).toBe('67');
      expect(tile('[data-streak="current"]')).toContain('3 days');
      expect(tile('[data-streak="longest"]')).toContain('5 days');
      expect(text()).toContain(STATS_COPY.overview.streakNote);
    });

    it('a weekly or monthly goal is not turned into a daily one', async () => {
      await db.goals.put(goal('g1', { measure: 'pages', target: 21 }));
      await db.goals.put(goal('g2', { measure: 'time', target: 140, period: 'month' }));
      await create();
      expect(tile('[data-today="pages"]')).toContain(STATS_COPY.overview.noGoal);
      expect(tile('[data-today="time"]')).toContain(STATS_COPY.overview.noGoal);
    });

    it('says there is no daily goal and draws no bar without a goal', async () => {
      await create();
      expect(tile('[data-today="pages"]')).toContain(STATS_COPY.overview.noGoal);
      expect(el.querySelector('[data-today] [role=progressbar]')).toBeNull();
      expect(tile('[data-streak="current"]')).toContain('0 days');
    });

    it('all time sums time, pages and finished / started books, and follows the book filter while streaks stay global', async () => {
      await db.books.bulkPut([makeBook('b1', { status: 'finished', categoryIds: ['c1'] }), makeBook('b2', { title: 'Other', status: 'reading' }), makeBook('b3', { status: 'to-read' })]);
      await db.sessions.bulkPut([session('s1', at(1, 5), range(4), 3_600_000, 'b1'), session('s2', at(11, 18), range(3), 1_800_000, 'b2')]);
      await create();
      expect(tile('[data-all="time"]')).toContain('1 h 30 min');
      expect(tile('[data-all="pages"]')).toContain('7');
      expect(tile('[data-all="books"]')).toContain('1 / 2');

      el.querySelector<HTMLButtonElement>('[data-testid="book-picker"]')!.click();
      fixture.detectChanges();
      [...el.querySelectorAll<HTMLButtonElement>('[data-testid="book-option"]')].find((o) => o.textContent!.includes('Other'))!.click();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(tile('[data-all="pages"]')).toContain('3');
      });
      expect(tile('[data-all="time"]')).toContain('30 min');
      expect(tile('[data-streak="current"]')).toContain('1 day');
    });
  });

  describe('periods, heat map and filters', () => {
    const btn = (label: string) => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent!.trim() === label)!;
    const period = (name: string) => el.querySelector<HTMLButtonElement>(`[data-period="${name}"]`)!;
    const nav = (which: 'prev' | 'next') => el.querySelector<HTMLButtonElement>(`[data-nav="${which}"]`)!;
    const label = () => el.querySelector('[data-testid="period-label"]')!.textContent!.trim();
    const cells = () => [...el.querySelectorAll<HTMLButtonElement>('iqra-heatmap button[data-day]')];
    const cell = (day: string) => el.querySelector<HTMLButtonElement>(`iqra-heatmap button[data-day="${day}"]`)!;
    const legend = (name: string) => [...el.querySelectorAll<HTMLButtonElement>('.legend button')].find((b) => b.textContent!.trim() === name)!;
    async function settle(check: () => void): Promise<void> {
      await vi.waitFor(() => {
        fixture.detectChanges();
        check();
      });
    }
    async function seedTwoCategories(): Promise<void> {
      await db.categories.put({ id: 'c2', deviceId: 'dev', updatedAt: 1, name: 'History', order: 1 });
      await db.books.bulkPut([makeBook('b2', { title: 'History Book', categoryIds: ['c2'] }), makeBook('b3', { title: 'كتاب حر', categoryIds: [] })]);
    }

    it('each goal shows progress for its own period, whatever period the page is browsing', async () => {
      await db.goals.put(goal('gd', { measure: 'pages', target: 4, period: 'day' }));
      await db.goals.put(goal('gm', { measure: 'pages', target: 100, period: 'month' }));
      await db.sessions.bulkPut([session('s1', at(11, 19, 9), range(2)), session('s2', at(11, 3), range(5))]);
      await create();
      const rows = () => [...el.querySelectorAll('.goal .gl')].map((e) => e.textContent!.trim());
      expect(rows()).toEqual(expect.arrayContaining(['Pages · 2 of 4', 'Pages · 7 of 100']));
      period('year').click();
      await settle(() => expect(cells()).toHaveLength(365));
      expect(rows()).toEqual(expect.arrayContaining(['Pages · 2 of 4', 'Pages · 7 of 100']));
      expect(text()).toContain('All books · Daily');
    });

    it('starts on Week, and switching to Month or Year swaps the chart for a heat map; goals stay', async () => {
      await db.goals.put(goal('g1'));
      await db.sessions.put(session('s1', at(11, 16), range(4)));
      await create();
      expect(period('week').getAttribute('aria-pressed')).toBe('true');
      expect(el.querySelector('.week-chart')).not.toBeNull();
      expect(el.querySelector('.goal')).not.toBeNull();

      period('month').click();
      await settle(() => expect(cells()).toHaveLength(30));
      expect(el.querySelector('.week-chart')).toBeNull();
      expect(el.querySelector('.goal')).not.toBeNull();
      expect(label()).toBe('This month · November 2026');

      period('year').click();
      await settle(() => expect(cells()).toHaveLength(365));
      expect(el.querySelectorAll('iqra-heatmap [role="row"]')[0].querySelectorAll('[role="gridcell"]')).toHaveLength(53);
      expect(label()).toBe('This year · 2026');

      period('week').click();
      await settle(() => expect(el.querySelector('.week-chart')).not.toBeNull());
      expect(label()).toBe('This week · Nov 14 – 20');
    });

    it('steps back and forward, never past the current period, and Today returns', async () => {
      await db.sessions.bulkPut([session('s1', at(11, 16), range(20)), session('s2', at(11, 10), range(8))]);
      await create();
      expect(nav('next').disabled).toBe(true);
      expect(btn(STATS_COPY.today)).toBeUndefined();

      nav('prev').click();
      await settle(() => expect(label()).toBe('Nov 7 – 13'));
      expect(el.querySelector('[data-total="pages"]')!.textContent).toContain('8');
      expect(el.querySelector('[data-total="pages"]')!.textContent).toContain('vs the week before');
      expect(nav('next').disabled).toBe(false);

      btn(STATS_COPY.today).click();
      await settle(() => expect(label()).toBe('This week · Nov 14 – 20'));
      expect(nav('next').disabled).toBe(true);

      period('month').click();
      await settle(() => expect(label()).toBe('This month · November 2026'));
      nav('prev').click();
      await settle(() => expect(label()).toBe('October 2026'));
      nav('next').click();
      await settle(() => expect(label()).toBe('This month · November 2026'));

      period('year').click();
      nav('prev').click();
      await settle(() => expect(label()).toBe('2025'));
      expect(nav('prev').getAttribute('aria-label')).toBe('Previous year');
    });

    it('keeps the date when switching period: a past week becomes its month', async () => {
      await create();
      nav('prev').click();
      await settle(() => expect(label()).toBe('Nov 7 – 13'));
      period('month').click();
      await settle(() => expect(label()).toBe('This month · November 2026'));
    });

    it('compares a month with last month', async () => {
      await db.sessions.bulkPut([session('s1', at(11, 16), range(10)), session('s2', at(10, 16), range(4))]);
      await create();
      period('month').click();
      await settle(() => expect(el.querySelector('[data-total="pages"]')!.textContent).toContain('+6 vs last month'));
    });

    it('colours each day by the category with the most time and scales the intensity to the busiest day', async () => {
      await seedTwoCategories();
      await db.sessions.bulkPut([
        session('s1', at(11, 3), range(10), 10 * 60_000, 'b1'),
        session('s2', at(11, 3, 12), range(2), 40 * 60_000, 'b2'),
        session('s3', at(11, 4), range(2), 10 * 60_000, 'b1'),
        session('s4', at(11, 5), range(3), 10 * 60_000, 'b3'),
      ]);
      await create();
      period('month').click();
      await settle(() => expect(cells()).toHaveLength(30));
      // 3 Nov: 12 pages, History took 40 of 50 minutes. Busiest day: level 4.
      expect(cell('2026-11-03').style.getPropertyValue('--cell')).toBe('var(--cat-2)');
      expect(cell('2026-11-03').dataset['level']).toBe('4');
      expect(cell('2026-11-04').style.getPropertyValue('--cell')).toBe('var(--cat-1)');
      expect(cell('2026-11-04').dataset['level']).toBe('1');
      expect(cell('2026-11-05').style.getPropertyValue('--cell')).toBe('var(--accent)');
      expect(cell('2026-11-06').dataset['level']).toBe('0');
      expect(cell('2026-11-03').getAttribute('aria-label')).toMatch(/Tue 3 Nov · 12 pages · 50 min · History$/);
    });

    it('the measure switch re-scales the blocks by time instead of pages', async () => {
      await db.sessions.bulkPut([
        session('s1', at(11, 3), range(1), 60 * 60_000),
        session('s2', at(11, 4), range(10), 10 * 60_000),
      ]);
      await create();
      period('month').click();
      await settle(() => expect(cells()).toHaveLength(30));
      expect([cell('2026-11-03').dataset['level'], cell('2026-11-04').dataset['level']]).toEqual(['1', '4']);
      btn(STATS_COPY.time).click();
      await settle(() => expect([cell('2026-11-03').dataset['level'], cell('2026-11-04').dataset['level']]).toEqual(['4', '1']));
    });

    it('filters the totals, the blocks and the chart by category through the legend, and a second click clears it', async () => {
      await seedTwoCategories();
      await db.sessions.bulkPut([
        session('s1', at(11, 16), range(10), 600_000, 'b1'),
        session('s2', at(11, 17), range(5), 600_000, 'b2'),
        session('s3', at(11, 18), range(3), 600_000, 'b3'),
      ]);
      await create();
      expect(el.querySelector('[data-total="pages"] .v')!.textContent).toBe('18');

      legend('History').click();
      await settle(() => expect(el.querySelector('[data-total="pages"] .v')!.textContent).toBe('5'));
      expect(legend('History').getAttribute('aria-pressed')).toBe('true');
      expect(el.querySelectorAll('.week-chart rect.bar')[3].getAttribute('height')).not.toBe('0');

      period('month').click();
      await settle(() => expect(cells()).toHaveLength(30));
      expect(cells().filter((c) => c.dataset['level'] !== '0').map((c) => c.dataset['day'])).toEqual(['2026-11-17']);
      expect(cell('2026-11-17').style.getPropertyValue('--cell')).toBe('var(--cat-2)');

      legend('History').click();
      await settle(() => expect(cells().filter((c) => c.dataset['level'] !== '0')).toHaveLength(3));
      legend('Uncategorized').click();
      await settle(() => expect(cells().filter((c) => c.dataset['level'] !== '0').map((c) => c.dataset['day'])).toEqual(['2026-11-18']));
    });

    it('filters to one book from the picker, including an Arabic title', async () => {
      await seedTwoCategories();
      await db.sessions.bulkPut([session('s1', at(11, 16), range(10), 600_000, 'b1'), session('s3', at(11, 18), range(3), 600_000, 'b3')]);
      await create();
      el.querySelector<HTMLButtonElement>('[data-testid="book-picker"]')!.click();
      fixture.detectChanges();
      const option = [...el.querySelectorAll<HTMLButtonElement>('[data-testid="book-option"]')].find((o) => o.textContent!.includes('كتاب'))!;
      expect(option.querySelector('[dir="auto"]')).not.toBeNull();
      option.click();
      await settle(() => expect(el.querySelector('[data-total="pages"] .v')!.textContent).toBe('3'));
      expect(el.querySelector('[data-testid="book-picker"]')!.textContent).toContain('كتاب حر');

      el.querySelector<HTMLButtonElement>('[data-testid="book-clear"]')!.click();
      await settle(() => expect(el.querySelector('[data-total="pages"] .v')!.textContent).toBe('13'));
    });

    it('goals respect the filter', async () => {
      await seedTwoCategories();
      await db.goals.put(goal('g1', { target: 20 }));
      await db.sessions.bulkPut([session('s1', at(11, 16), range(10), 600_000, 'b1'), session('s2', at(11, 17), range(5), 600_000, 'b2')]);
      await create();
      expect(text()).toContain('Pages · 15 of 20');
      legend('History').click();
      await settle(() => expect(text()).toContain('Pages · 5 of 20'));
    });

    it('a filter on a category that was deleted is ignored', async () => {
      await db.sessions.put(session('s1', at(11, 16), range(10)));
      await create();
      legend('Fiqh').click();
      await settle(() => expect(el.querySelector('[data-total="pages"] .v')!.textContent).toBe('10'));
      await db.categories.put({ id: 'c1', deviceId: 'dev', updatedAt: 2, name: 'Fiqh', order: 0, deleted: true });
      await settle(() => expect(el.querySelector('.legend')).toBeNull());
      expect(el.querySelector('[data-total="pages"] .v')!.textContent).toBe('10');
    });

    it('clicking a day lists the books read that day, and clicking it again closes the list', async () => {
      await seedTwoCategories();
      await db.sessions.bulkPut([
        session('s1', at(11, 3), range(10), 10 * 60_000, 'b1'),
        session('s2', at(11, 3, 12), range(2), 40 * 60_000, 'b3'),
      ]);
      await create();
      period('month').click();
      await settle(() => expect(cells()).toHaveLength(30));
      expect(el.querySelector('[data-testid="day-detail"]')).toBeNull();

      cell('2026-11-03').click();
      await settle(() => expect(el.querySelector('[data-testid="day-detail"]')).not.toBeNull());
      const rows = [...el.querySelectorAll('[data-testid="day-detail"] li')];
      expect(rows.map((r) => [...r.querySelectorAll('span')].map((x) => x.textContent!.trim()))).toEqual([
        ['كتاب حر', '2 pages · 40 min'],
        ['Book b1', '10 pages · 10 min'],
      ]);
      expect(rows[0].querySelector('[dir="auto"]')).not.toBeNull();
      expect(cell('2026-11-03').getAttribute('aria-pressed')).toBe('true');

      cell('2026-11-03').click();
      await settle(() => expect(el.querySelector('[data-testid="day-detail"]')).toBeNull());
    });

    it('steps the selected day with large previous/next buttons, stopping at the period edges', async () => {
      await db.sessions.put(session('s1', at(11, 3), range(2)));
      await create();
      period('month').click();
      await settle(() => expect(cells()).toHaveLength(30));
      cell('2026-11-01').click();
      await settle(() => expect(el.querySelector('[data-testid="day-detail"]')).not.toBeNull());
      const prev = () => el.querySelector<HTMLButtonElement>('[data-testid="day-prev"]')!;
      const next = () => el.querySelector<HTMLButtonElement>('[data-testid="day-next"]')!;
      expect(prev().disabled).toBe(true);
      next().click();
      await settle(() => expect(cell('2026-11-02').getAttribute('aria-pressed')).toBe('true'));
      expect(el.querySelector('[data-testid="day-detail"] h3')!.textContent).toContain('Mon 2 Nov');
      expect(prev().disabled).toBe(false);
      prev().click();
      await settle(() => expect(cell('2026-11-01').getAttribute('aria-pressed')).toBe('true'));
    });

    it('changing period clears the selected day', async () => {
      await db.sessions.put(session('s1', at(11, 3), range(2)));
      await create();
      period('month').click();
      await settle(() => expect(cells()).toHaveLength(30));
      cell('2026-11-03').click();
      await settle(() => expect(el.querySelector('[data-testid="day-detail"]')).not.toBeNull());
      nav('prev').click();
      await settle(() => expect(el.querySelector('[data-testid="day-detail"]')).toBeNull());
    });

    it('shows an empty state for a month or year with nothing read, and no NaN', async () => {
      await create();
      period('month').click();
      await settle(() => expect(text()).toContain('Nothing read this month yet.'));
      expect(cells()).toHaveLength(0);
      expect(text()).not.toContain('NaN');
      nav('prev').click();
      await settle(() => expect(text()).toContain('Nothing read in this period.'));
      // The date is kept, so this is 2026 again: the current year.
      period('year').click();
      await settle(() => expect(text()).toContain('Nothing read this year yet.'));
      nav('prev').click();
      await settle(() => expect(text()).toContain('Nothing read in this period.'));
      expect(text()).not.toContain('NaN');
    });

    it('a past week with nothing read says so', async () => {
      await create();
      nav('prev').click();
      await settle(() => expect(text()).toContain('Nothing read in this period.'));
    });

    it('follows weekStartsOn in the month grid: Monday weeks start the first row on Monday', async () => {
      const s: Settings = {
        id: 'settings', deviceId: 'd', updatedAt: 1, defaultProgressMode: 'last-page', defaultPageMode: 'swipe', defaultView: 'page',
        readerTheme: 'paper', weekStartsOn: 1, reminders: {}, cardDirection: 'en-ar',
      };
      await db.settings.put(s);
      await db.sessions.put(session('s1', at(11, 3), range(2)));
      await create();
      period('month').click();
      await settle(() => expect(cells()).toHaveLength(30));
      const firstRow = el.querySelectorAll('iqra-heatmap [role="row"]')[0].querySelectorAll<HTMLButtonElement>('button[data-day]');
      expect(firstRow[0].dataset['day']).toBe('2026-11-02');
    });
  });

  describe('when the data cannot be read', () => {
    async function mount(): Promise<void> {
      fixture = TestBed.createComponent(StatsPage);
      el = fixture.nativeElement as HTMLElement;
      fixture.detectChanges();
    }

    it('shows an error with Retry instead of a blank page, and Retry brings the page back', async () => {
      vi.spyOn(db.sessions, 'filter').mockImplementationOnce(() => {
        throw new Error('Internal error opening backing store');
      });
      await mount();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(el.querySelector('[data-testid="stats-error"]')).not.toBeNull();
      });
      expect(text()).toContain(STATS_COPY.loadFailed);
      expect(el.querySelector('[data-ready]')).toBeNull();

      (el.querySelector('[data-testid="stats-retry"]') as HTMLButtonElement).click();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(el.querySelector('[data-ready]')).not.toBeNull();
      });
      expect(el.querySelector('[data-testid="stats-error"]')).toBeNull();
      expect(text()).toContain(STATS_COPY.noReading);
    });

    it('shows the error when loading never finishes (a database that never opens)', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
      try {
        vi.spyOn(db.books, 'filter').mockReturnValue({ toArray: () => new Promise(() => {}) } as never);
        await mount();
        expect(el.querySelector('[data-testid="stats-loading"]')).not.toBeNull();
        await vi.advanceTimersByTimeAsync(9000);
        fixture.detectChanges();
        expect(el.querySelector('[data-testid="stats-error"]')).not.toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('shows a Reload button next to Retry', async () => {
      vi.spyOn(db.categories, 'filter').mockImplementation(() => {
        throw new Error('closed');
      });
      await mount();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(el.querySelector('[data-testid="stats-reload"]')).not.toBeNull();
      });
    });
  });
});
