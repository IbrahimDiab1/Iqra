import { ReadMarkService } from '../../progress/read-mark.service';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOCK } from '../../core/clock';
import { DB, IqraDb } from '../../core/db';
import { newId } from '../../core/ids';
import type { Annotation, Book, ReadingSession } from '../../core/models';
import { totals } from '../../stats/aggregate';
import { formatAvg, formatDuration } from '../../stats/format';
import { STATS_COPY } from '../../stats/stats-copy';
import { BookStatsComponent } from './book-stats.component';

const NOW = new Date(2026, 10, 19, 12).getTime();
const DAY = 86_400_000;

function makeBook(over: Partial<Book> = {}): Book {
  return {
    id: 'b1', deviceId: 'dev', updatedAt: 1, title: 'Kitab', author: 'A', driveFileId: 'd', fileName: 'k.pdf', sizeBytes: 1,
    sha256: 'x', pageCount: 100, outline: [], language: 'en', direction: 'ltr', addedAt: NOW - 3 * DAY, status: 'to-read',
    categoryIds: [], tags: [], progressMode: 'last-page', pageMode: 'swipe', lastPageReached: 0, ...over,
  };
}

function session(id: string, over: Partial<ReadingSession> = {}): ReadingSession {
  return { id, deviceId: 'dev', updatedAt: 1, bookId: 'b1', startedAt: NOW - DAY, endedAt: NOW - DAY + 600_000, activeMs: 600_000, pagesRead: [1, 2, 3], ...over };
}

function ann(id: string, type: Annotation['type'], over: Partial<Annotation> = {}): Annotation {
  return { id, deviceId: 'dev', updatedAt: 1, bookId: 'b1', type, tags: [], createdAt: 1, page: 1, ...over };
}

describe('BookStatsComponent', () => {
  let db: IqraDb;
  let fixture: ComponentFixture<BookStatsComponent>;
  let el: HTMLElement;

  async function create(book: Book): Promise<void> {
    fixture = TestBed.createComponent(BookStatsComponent);
    fixture.componentRef.setInput('book', book);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(el.querySelector('[data-ready]')).not.toBeNull();
    });
  }

  beforeEach(() => {
    localStorage.clear();
    db = new IqraDb(`iqra-test-${newId()}`);
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: DB, useValue: db }, { provide: CLOCK, useValue: { now: () => NOW } }],
    });
  });

  afterEach(async () => {
    fixture?.destroy();
    TestBed.resetTestingModule();
    await db.delete();
  });

  const text = () => el.textContent!.replace(/\s+/g, ' ');

  it('shows Not yet for a book with no startedAt or finishedAt, and the empty text without NaN', async () => {
    await create(makeBook());
    expect(el.querySelectorAll('.tl dd')[1].textContent).toContain(STATS_COPY.notYet);
    expect(el.querySelectorAll('.tl dd')[2].textContent).toContain(STATS_COPY.notYet);
    expect(text()).toContain(STATS_COPY.book.noSessions);
    expect(text()).not.toContain('NaN');
    expect(text()).toContain('0:00');
  });

  it('shows dates for started and finished books', async () => {
    await create(makeBook({ startedAt: NOW - 2 * DAY, finishedAt: NOW }));
    expect(el.querySelectorAll('.tl dd')[1].textContent).not.toContain(STATS_COPY.notYet);
    expect(el.querySelectorAll('.tl dd')[2].textContent).not.toContain(STATS_COPY.notYet);
  });

  it('totals match the aggregate of the book sessions, ignoring deleted and other books', async () => {
    const mine = [session('s1'), session('s2', { startedAt: NOW - 2 * DAY, activeMs: 3_300_000, pagesRead: [4, 5] })];
    await db.sessions.bulkPut([...mine, session('s3', { deleted: true }), session('s4', { bookId: 'other' })]);
    await create(makeBook());
    const t = totals(mine);
    const values = [...el.querySelectorAll('.totals dd')].map((d) => d.textContent!.trim());
    expect(values).toEqual([formatDuration(t.ms), String(t.pages), String(t.sessions), String(t.days), formatAvg(t.avgMsPerPage)]);
    expect(values[0]).toBe('1 h 05 min');
    expect(el.querySelectorAll('rect.bar').length).toBeGreaterThan(0);
  });

  it('counts only live annotations and links with the right query params', async () => {
    await db.annotations.bulkPut([
      ann('h1', 'highlight'), ann('h2', 'highlight'), ann('h3', 'highlight', { deleted: true }),
      ann('n1', 'note'), ann('sn1', 'side-note'), ann('su1', 'summary'), ann('bm1', 'bookmark'),
      ann('x', 'highlight', { bookId: 'other' }),
    ]);
    await create(makeBook());
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(el.querySelector('a[data-type="highlight"] .n')!.textContent).toBe('2');
    });
    const link = el.querySelector<HTMLAnchorElement>('a[data-type="highlight"]')!;
    expect(link.getAttribute('href')).toBe('/notes?book=b1&type=highlight');
    expect(el.querySelector('a[data-type="side-note"]')!.getAttribute('href')).toBe('/notes?book=b1&type=side-note');
    expect(el.querySelector('a[data-type="summary"] .n')!.textContent).toBe('1');
    expect(el.querySelector('[data-type="bookmark"] .n')!.textContent).toBe('1');
  });

  it('shows rating and review read-only', async () => {
    await create(makeBook({ rating: 8, review: 'Lovely.' }));
    expect(text()).toContain('8/10');
    expect(text()).toContain('Lovely.');
    expect(el.querySelector('.rr input, .rr textarea')).toBeNull();
  });

  it('lists chapter progress for books with an outline', async () => {
    const outline = [
      { key: '0', title: 'One', page: 1, children: [] },
      { key: '1', title: 'Two', page: 51, children: [] },
    ];
    await create(makeBook({ outline, lastPageReached: 50 }));
    const bars = [...el.querySelectorAll('.chap [role=progressbar]')].map((b) => b.getAttribute('aria-valuenow'));
    expect(bars).toEqual(['100', '0']);
  });

  it('releases its read-mark live query when destroyed', async () => {
    const marks = TestBed.inject(ReadMarkService);
    const release = vi.spyOn(marks, 'release');
    await create(makeBook());
    fixture.destroy();
    expect(release).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledWith('b1');
  });
});
