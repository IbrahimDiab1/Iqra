import type { Goal } from '../core/models';
import type { Range } from './aggregate';
import { weekRange, type WeekStartsOn } from './week';

export type GoalPeriod = NonNullable<Goal['period']>;

/** Nearest first. */
export const GOAL_PERIODS: readonly GoalPeriod[] = ['day', 'week', 'month'];

/** A goal's own period. Goals saved before periods existed are weekly. */
export function goalPeriod(goal: Pick<Goal, 'period'>): GoalPeriod {
  return goal.period ?? 'week';
}

/** The day, week or month (local time) that contains `now`. */
export function goalRange(period: GoalPeriod, now: number, weekStartsOn: WeekStartsOn): Range {
  const d = new Date(now);
  switch (period) {
    case 'day':
      return { from: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), to: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() };
    case 'week': {
      const { from, to } = weekRange(now, weekStartsOn);
      return { from, to };
    }
    case 'month':
      return { from: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), to: new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() };
  }
}
