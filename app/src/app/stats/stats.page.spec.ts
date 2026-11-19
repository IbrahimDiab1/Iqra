import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BookDetailsService } from '../books/details/book-details.service';
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
    expect(el.querySelector('[role=dialog]')!.getAttribute('aria-hidden')).toBeNull();
  });

  it('draws seven day bars for the week with weekday labels', async () => {
    await db.sessions.put(session('s1', at(11, 16), range(4)));
    await create();
    expect(el.querySelectorAll('.week-chart rect.bar')).toHaveLength(7);
    expect(el.querySelectorAll('.week-chart text.lbl')).toHaveLength(7);
  });

  it('lists books in progress and opens the details sheet on the Stats tab', async () => {
    await db.books.put(makeBook('b3', { status: 'finished' }));
    await db.books.put(makeBook('b1', { categoryIds: ['c1'], lastPageReached: 50 }));
    await db.sessions.put(session('s1', at(11, 16), range(3), 3_900_000));
    await create();
    const rows = el.querySelectorAll<HTMLButtonElement>('.progress-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent!.replace(/\s+/g, ' ')).toContain('p. 50 of 200 · 25% · 1 h 05 min');
    rows[0].click();
    const details = TestBed.inject(BookDetailsService);
    await vi.waitFor(() => expect(details.openBook()?.id).toBe('b1'));
    expect(details.openTab()).toBe('stats');
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

  it('shows marked-mode progress as pages read, not a page number', async () => {
    await db.books.put(makeBook('b1', { progressMode: 'marked', pageCount: 100 }));
    for (const p of range(10)) await db.readMarks.put({ id: `b1:${p}`, deviceId: 'dev', updatedAt: 1, bookId: 'b1', page: p, read: true });
    await create();
    expect(el.querySelector('.progress-row')!.textContent!.replace(/\s+/g, ' ')).toContain('10 of 100 pages read · 10%');
  });
});
