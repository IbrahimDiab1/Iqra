import type { Book, Goal, ID, ReadingSession } from '../core/models';
import { dayKey } from './week';

export interface DayStat {
  day: string;
  pages: number;
  ms: number;
}

export interface GoalProgress {
  goal: Goal;
  value: number; // minutes or pages
  fraction: number; // 0..1
}

export interface Range {
  from: number;
  to: number;
}

/** Sessions that count: not deleted, a finite non-negative activeMs, a finite start time, inside the range. */
function countable(sessions: ReadingSession[], range?: Range): ReadingSession[] {
  return sessions.filter(
    (s) =>
      !s.deleted &&
      Number.isFinite(s.startedAt) &&
      Number.isFinite(s.activeMs) &&
      s.activeMs >= 0 &&
      (!range || (s.startedAt >= range.from && s.startedAt < range.to)),
  );
}

/** Sorted per-day totals for days that have sessions. A (book, page) counts once per day; time goes to the start day. */
export function dayStats(sessions: ReadingSession[], range?: Range): DayStat[] {
  const days = new Map<string, { ms: number; keys: Set<string> }>();
  for (const s of countable(sessions, range)) {
    const day = dayKey(s.startedAt);
    let entry = days.get(day);
    if (!entry) days.set(day, (entry = { ms: 0, keys: new Set() }));
    entry.ms += s.activeMs;
    for (const page of s.pagesRead) entry.keys.add(`${s.bookId}:${page}`);
  }
  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, { ms, keys }]) => ({ day, pages: keys.size, ms }));
}

/** The books read on one local day: unique pages and active time, longest time first. Time goes to the day a session started. */
export function booksOnDay(sessions: ReadingSession[], day: string): { bookId: ID; pages: number; ms: number }[] {
  const books = new Map<ID, { ms: number; pages: Set<number> }>();
  for (const s of countable(sessions)) {
    if (dayKey(s.startedAt) !== day) continue;
    let entry = books.get(s.bookId);
    if (!entry) books.set(s.bookId, (entry = { ms: 0, pages: new Set() }));
    entry.ms += s.activeMs;
    for (const page of s.pagesRead) entry.pages.add(page);
  }
  return [...books.entries()]
    .map(([bookId, { ms, pages }]) => ({ bookId, pages: pages.size, ms }))
    .sort((a, b) => b.ms - a.ms || (a.bookId < b.bookId ? -1 : 1));
}

/** Totals over all countable sessions. Pages are unique (book, page, day); average is total time over pages. */
export function totals(sessions: ReadingSession[]): {
  ms: number;
  pages: number;
  sessions: number;
  days: number;
  avgMsPerPage: number;
} {
  const valid = countable(sessions);
  const keys = new Set<string>();
  const days = new Set<string>();
  let ms = 0;
  for (const s of valid) {
    const day = dayKey(s.startedAt);
    days.add(day);
    ms += s.activeMs;
    for (const page of s.pagesRead) keys.add(`${s.bookId}:${page}:${day}`);
  }
  const pages = keys.size;
  return { ms, pages, sessions: valid.length, days: days.size, avgMsPerPage: pages > 0 ? ms / pages : 0 };
}

/** Time and unique pages per book (unique per page and day). */
export function perBook(sessions: ReadingSession[]): Map<ID, { ms: number; pages: number }> {
  const out = new Map<ID, { ms: number; pages: number }>();
  const seen = new Map<ID, Set<string>>();
  for (const s of countable(sessions)) {
    const day = dayKey(s.startedAt);
    let entry = out.get(s.bookId);
    if (!entry) {
      out.set(s.bookId, (entry = { ms: 0, pages: 0 }));
      seen.set(s.bookId, new Set());
    }
    entry.ms += s.activeMs;
    const keys = seen.get(s.bookId)!;
    for (const page of s.pagesRead) keys.add(`${page}:${day}`);
    entry.pages = keys.size;
  }
  return out;
}

/**
 * Progress toward a goal in `range`. categoryId null counts every live book; otherwise only books in that category.
 * Time goals are minutes, page goals are unique (page, day) pairs. Fraction is capped at 1; a target <= 0 gives 0.
 */
export function goalProgress(goal: Goal, sessions: ReadingSession[], books: Book[], range: Range): GoalProgress {
  const eligible = new Set(
    books
      .filter((b) => !b.deleted && (goal.categoryId === null || b.categoryIds.includes(goal.categoryId)))
      .map((b) => b.id),
  );
  const inScope = countable(sessions, range).filter((s) => eligible.has(s.bookId));

  let value: number;
  if (goal.measure === 'time') {
    value = inScope.reduce((sum, s) => sum + s.activeMs, 0) / 60_000;
  } else {
    const keys = new Set<string>();
    for (const s of inScope) {
      const day = dayKey(s.startedAt);
      for (const page of s.pagesRead) keys.add(`${s.bookId}:${page}:${day}`);
    }
    value = keys.size;
  }
  const fraction = goal.target > 0 ? Math.min(1, value / goal.target) : 0;
  return { goal, value, fraction };
}
