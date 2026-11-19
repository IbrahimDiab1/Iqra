import { UNCATEGORIZED } from '../books/library/library-query';
import type { Book, Category, ID, ReadingSession } from '../core/models';
import { dayKey, weekRange, weekStart, type WeekStartsOn } from './week';

export type Period = 'week' | 'month' | 'year';
export type HeatMeasure = 'pages' | 'time';

/** A period as local midnights. `to` is exclusive. */
export interface PeriodBounds {
  from: number;
  to: number;
}

/** Local-midnight arithmetic through Date, so a DST change never moves a boundary off midnight. */
const dayAt = (y: number, month: number, d: number) => new Date(y, month, d).getTime();

/** The week, month or calendar year that contains `ms`. */
export function periodBounds(period: Period, ms: number, weekStartsOn: WeekStartsOn): PeriodBounds {
  const d = new Date(ms);
  switch (period) {
    case 'week': {
      const { from, to } = weekRange(ms, weekStartsOn);
      return { from, to };
    }
    case 'month':
      return { from: dayAt(d.getFullYear(), d.getMonth(), 1), to: dayAt(d.getFullYear(), d.getMonth() + 1, 1) };
    case 'year':
      return { from: dayAt(d.getFullYear(), 0, 1), to: dayAt(d.getFullYear() + 1, 0, 1) };
  }
}

/** The first day of the period `delta` periods away from the one containing `ms`. */
export function shiftPeriod(period: Period, ms: number, delta: number, weekStartsOn: WeekStartsOn): number {
  const { from } = periodBounds(period, ms, weekStartsOn);
  const d = new Date(from);
  switch (period) {
    case 'week':
      return dayAt(d.getFullYear(), d.getMonth(), d.getDate() + 7 * delta);
    case 'month':
      return dayAt(d.getFullYear(), d.getMonth() + delta, 1);
    case 'year':
      return dayAt(d.getFullYear() + delta, 0, 1);
  }
}

/** True when the period holds `nowMs`. */
export function isCurrentPeriod(period: Period, ms: number, nowMs: number, weekStartsOn: WeekStartsOn): boolean {
  const { from, to } = periodBounds(period, ms, weekStartsOn);
  return nowMs >= from && nowMs < to;
}

/** The next period may be shown only once it has begun. */
export function canGoNext(period: Period, ms: number, nowMs: number, weekStartsOn: WeekStartsOn): boolean {
  return periodBounds(period, ms, weekStartsOn).to <= nowMs;
}

export interface GridCell {
  /** Local 'YYYY-MM-DD', or null for padding before the first or after the last day of the period. */
  day: string | null;
}

/**
 * Weeks as columns of seven cells; row 0 is `weekStartsOn`. Cells outside the period are padding (day null).
 * Reading the columns left to right and each column top to bottom is chronological. A year takes 52 to 54 columns.
 */
export function gridColumns(period: 'month' | 'year', ms: number, weekStartsOn: WeekStartsOn): GridCell[][] {
  const { from, to } = periodBounds(period, ms, weekStartsOn);
  const first = new Date(weekStart(from, weekStartsOn));
  const columns: GridCell[][] = [];
  for (let week = 0; ; week++) {
    const col: GridCell[] = [];
    for (let row = 0; row < 7; row++) {
      const t = dayAt(first.getFullYear(), first.getMonth(), first.getDate() + week * 7 + row);
      col.push({ day: t >= from && t < to ? dayKey(t) : null });
    }
    if (col.every((c) => c.day === null)) break;
    columns.push(col);
    if (week > 60) break;
  }
  return columns;
}

/** 0 for no reading, else 1 to 4 for 1-25 / 26-50 / 51-75 / 76-100 percent of `max`. Compares without dividing, so boundaries are exact. */
export function intensityLevel(value: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (!(value > 0) || !(max > 0) || !Number.isFinite(value) || !Number.isFinite(max)) return 0;
  if (value * 100 <= max * 25) return 1;
  if (value * 100 <= max * 50) return 2;
  if (value * 100 <= max * 75) return 3;
  return 4;
}

const HUES = 8;

/** The palette slot, 1 to 8, for a category: its `order` modulo eight, so a colour stays with a category. */
export function categoryHue(order: number): number {
  return (((Math.trunc(order) % HUES) + HUES) % HUES) + 1;
}

export interface HeatFilter {
  /** A category id, `UNCATEGORIZED`, or null/undefined for all. */
  categoryId?: ID | null;
  /** One book, or null/undefined for all. */
  bookId?: ID | null;
}

export interface HeatDay {
  day: string;
  /** The day's reading by the chosen measure: unique pages (a book's page counts once per day) or minutes. */
  value: number;
  /** Unique pages that day. */
  pages: number;
  /** Active reading time that day. */
  ms: number;
  /** The category with the most reading time that day; null for books with no live category. */
  categoryId: ID | null;
  /** The book with the most reading time that day. */
  bookId: ID;
}

/** The first live category of the book by `order`; null when it has none. `categories` are the live ones. */
export function primaryCategory(book: Book, categories: readonly Category[]): ID | null {
  const own = new Set(book.categoryIds);
  const sorted = [...categories].sort((a, b) => a.order - b.order);
  return sorted.find((c) => own.has(c.id))?.id ?? null;
}

/** True when the book passes the filter: it is the chosen book, and is in the chosen category (or has none, for Uncategorized). */
export function matchesFilter(book: Book, categories: readonly Category[], filter: HeatFilter | undefined): boolean {
  if (filter?.bookId && book.id !== filter.bookId) return false;
  const wanted = filter?.categoryId;
  if (!wanted) return true;
  if (wanted === UNCATEGORIZED) return primaryCategory(book, categories) === null;
  return book.categoryIds.includes(wanted) && categories.some((c) => c.id === wanted);
}

/** Sessions that count: live, finite numbers, of a book that exists and passes the filter. */
export function filterSessions(
  sessions: readonly ReadingSession[],
  books: readonly Book[],
  categories: readonly Category[],
  filter?: HeatFilter,
): ReadingSession[] {
  const eligible = new Set(books.filter((b) => !b.deleted && matchesFilter(b, categories, filter)).map((b) => b.id));
  return sessions.filter((s) => !s.deleted && eligible.has(s.bookId));
}

/**
 * One entry per day with reading in `range`. A session belongs to the day it started. The day's colour is the
 * category with the most time (a tie goes to the earlier category, uncategorized last); with a category filter
 * every day takes that category. `value` is unique pages or minutes.
 */
export function heatmapDays(
  sessions: readonly ReadingSession[],
  books: readonly Book[],
  categories: readonly Category[],
  range: PeriodBounds,
  measure: HeatMeasure,
  filter?: HeatFilter,
): HeatDay[] {
  const byId = new Map(books.map((b) => [b.id, b]));
  const order = new Map(categories.map((c) => [c.id, c.order]));
  const forced = filter?.categoryId && filter.categoryId !== UNCATEGORIZED ? filter.categoryId : undefined;
  const days = new Map<string, { ms: number; pages: Set<string>; byCategory: Map<ID | null, number>; byBook: Map<ID, number> }>();

  for (const s of filterSessions(sessions, books, categories, filter)) {
    if (!Number.isFinite(s.startedAt) || !Number.isFinite(s.activeMs) || s.activeMs < 0) continue;
    if (s.startedAt < range.from || s.startedAt >= range.to) continue;
    const book = byId.get(s.bookId)!;
    const day = dayKey(s.startedAt);
    let entry = days.get(day);
    if (!entry) days.set(day, (entry = { ms: 0, pages: new Set(), byCategory: new Map(), byBook: new Map() }));
    entry.ms += s.activeMs;
    for (const page of s.pagesRead) entry.pages.add(`${s.bookId}:${page}`);
    const category = forced ?? primaryCategory(book, categories);
    entry.byCategory.set(category, (entry.byCategory.get(category) ?? 0) + s.activeMs);
    entry.byBook.set(s.bookId, (entry.byBook.get(s.bookId) ?? 0) + s.activeMs);
  }

  const rank = (id: ID | null) => (id === null ? Number.POSITIVE_INFINITY : (order.get(id) ?? Number.POSITIVE_INFINITY));
  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, e]) => {
      const category = [...e.byCategory.entries()].sort(([ca, ma], [cb, mb]) => mb - ma || rank(ca) - rank(cb))[0][0];
      const book = [...e.byBook.entries()].sort(([ia, ma], [ib, mb]) => mb - ma || (ia < ib ? -1 : ia > ib ? 1 : 0))[0][0];
      return { day, value: measure === 'pages' ? e.pages.size : e.ms / 60_000, pages: e.pages.size, ms: e.ms, categoryId: category, bookId: book };
    });
}

/** 'Sat 14 Nov' in the given locale (the browser's by default). Weekday, day and month in that order. */
export function dayLabel(day: string, locale?: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const parts = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }).formatToParts(new Date(y, m - 1, d));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('weekday')} ${part('day')} ${part('month')}`;
}

/** The day `delta` days from `day` ('YYYY-MM-DD'), or null when that is outside the period. */
export function neighbourDay(day: string, delta: number, bounds: PeriodBounds): string | null {
  const [y, m, d] = day.split('-').map(Number);
  const at = new Date(y, m - 1, d + delta).getTime();
  return at >= bounds.from && at < bounds.to ? dayKey(at) : null;
}
