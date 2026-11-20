import type { Book, ReadingSession } from '../core/models';
import { totals } from './aggregate';
import { dayKey } from './week';

/** The local day key `delta` days from `key`. Goes through Date, so DST is safe. */
const shiftDay = (key: string, delta: number): string => {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d + delta).getTime());
};

/**
 * Reading streaks in local days. A day counts when it has a live session with reading in it. The current streak
 * runs back from today, or from yesterday when today is still empty. Pure, so Library can reuse it.
 */
export function streaks(sessions: ReadingSession[], nowMs: number): { current: number; longest: number } {
  const days = new Set<string>();
  for (const s of sessions) {
    if (!s.deleted && Number.isFinite(s.startedAt) && Number.isFinite(s.activeMs) && (s.activeMs > 0 || s.pagesRead.length > 0)) {
      days.add(dayKey(s.startedAt));
    }
  }
  let longest = 0;
  for (const day of days) {
    if (days.has(shiftDay(day, -1))) continue; // not the start of a run
    let n = 1;
    while (days.has(shiftDay(day, n))) n++;
    longest = Math.max(longest, n);
  }
  const today = dayKey(nowMs);
  let cursor = days.has(today) ? today : shiftDay(today, -1);
  let current = 0;
  while (days.has(cursor)) {
    current++;
    cursor = shiftDay(cursor, -1);
  }
  return { current, longest };
}

/** All-time reading: active time, unique pages, and how many of the given live books were started and finished. */
export function allTime(sessions: ReadingSession[], books: Book[]): { ms: number; pages: number; started: number; finished: number } {
  const { ms, pages } = totals(sessions);
  const live = books.filter((b) => !b.deleted);
  return {
    ms,
    pages,
    started: live.filter((b) => b.status !== 'to-read').length,
    finished: live.filter((b) => b.status === 'finished').length,
  };
}
