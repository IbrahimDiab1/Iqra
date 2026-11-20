import type { ReadingSession } from '../../core/models';
import { dayStats, totals } from '../../stats/aggregate';
import { dayKey } from '../../stats/week';

/** The first word of a profile name, or '' when there is none. */
export function firstName(name: string | undefined | null): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}

/**
 * Consecutive local days with reading, counted back from today. A day with no reading yet today does not
 * break the streak: it continues from yesterday.
 */
export function currentStreak(sessions: ReadingSession[], now: number): number {
  const read = new Set(dayStats(sessions).filter((d) => d.ms > 0 || d.pages > 0).map((d) => d.day));
  const d = new Date(now);
  let cursor = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (!read.has(dayKey(cursor.getTime()))) cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 1);
  let streak = 0;
  while (read.has(dayKey(cursor.getTime()))) {
    streak += 1;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - 1);
  }
  return streak;
}

export interface WelcomeStats {
  streak: number;
  /** All-time active reading time. */
  ms: number;
  finished: number;
}

export function welcomeStats(sessions: ReadingSession[], finished: number, now: number): WelcomeStats {
  return { streak: currentStreak(sessions, now), ms: totals(sessions).ms, finished };
}
