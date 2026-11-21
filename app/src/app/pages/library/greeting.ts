import type { Book, Category, Goal, ReadingSession } from '../../core/models';
import { dayStats, goalProgress, totals } from '../../stats/aggregate';
import { formatDuration, formatMinutes } from '../../stats/format';
import { GOAL_PERIODS, goalPeriod, goalRange } from '../../stats/goal-period';
import { dayKey, type WeekStartsOn } from '../../stats/week';
import { TOP_COPY } from './top-copy';

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

export interface StatLineInput {
  sessions: ReadingSession[];
  books: Book[];
  categories: Category[];
  goals: Goal[];
  finished: number;
  now: number;
  weekStartsOn: WeekStartsOn;
}

/**
 * What is left of the nearest goal that is not reached yet (day, then week, then month), worded for its period.
 * 'reached' when goals exist and every one is done; null when there is nothing to show (no goals).
 */
function goalLine(i: StatLineInput): string | 'reached' | null {
  const live = new Set(i.categories.filter((c) => !c.deleted).map((c) => c.id));
  // A goal whose category is gone is left out, as on the Stats tab.
  const goals = i.goals.filter((g) => !g.deleted && g.target > 0 && (g.categoryId === null || live.has(g.categoryId)));
  if (goals.length === 0) return null;
  for (const period of GOAL_PERIODS) {
    for (const goal of goals.filter((g) => goalPeriod(g) === period)) {
      const { value } = goalProgress(goal, i.sessions, i.books, goalRange(period, i.now, i.weekStartsOn));
      if (value >= goal.target) continue;
      const left = goal.target - value;
      return goal.measure === 'time'
        ? TOP_COPY.timeLeft(formatMinutes(Math.ceil(left)), period)
        : TOP_COPY.pagesLeft(Math.ceil(left), period);
    }
  }
  return 'reached';
}

/**
 * The lines the greeting rotates through: read time today, pages today, what is left of the goal, all-time pages,
 * all-time time and books finished. Lines with nothing to say are left out (no goal; no finished book).
 */
export function statLines(i: StatLineInput): string[] {
  const c = TOP_COPY;
  const day = goalRange('day', i.now, i.weekStartsOn);
  const today = dayStats(i.sessions, day).reduce((a, d) => ({ ms: a.ms + d.ms, pages: a.pages + d.pages }), { ms: 0, pages: 0 });
  const all = totals(i.sessions);
  const lines = [c.timeToday(formatDuration(today.ms)), c.pagesToday(today.pages)];
  const goal = goalLine(i);
  if (goal === 'reached') lines.push(c.goalReached);
  else if (goal !== null) lines.push(goal);
  lines.push(c.pagesAll(all.pages), c.timeAll(formatDuration(all.ms)));
  if (i.finished > 0) lines.push(c.finishedCount(i.finished));
  return lines;
}
