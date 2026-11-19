import { Injectable, Signal, inject } from '@angular/core';
import { DB } from '../core/db';
import { newId } from '../core/ids';
import type { Goal, ID } from '../core/models';
import { Repo } from '../core/repo';

export interface NewGoal {
  categoryId: ID | null;
  measure: Goal['measure'];
  target: number;
}

const MIN_TARGET = 1;
const MAX_TARGET = 100_000;

/** A whole number from 1 to 100 000; anything that is not a number becomes 1. */
function clampTarget(n: number): number {
  return Number.isFinite(n) ? Math.min(MAX_TARGET, Math.max(MIN_TARGET, Math.round(n))) : MIN_TARGET;
}

/** The only writer of weekly goals. Goals are never hard-deleted. */
@Injectable({ providedIn: 'root' })
export class GoalService {
  private readonly repo = inject(Repo);
  private readonly db = inject(DB);
  private readonly all = this.repo.live(() => this.db.goals.filter((g) => !g.deleted).toArray());

  /** Live goals that are not deleted; undefined until the first read. */
  goals(): Signal<Goal[] | undefined> {
    return this.all;
  }

  create(g: NewGoal): Promise<Goal> {
    return this.repo.put<Goal>('goals', { id: newId(), categoryId: g.categoryId, measure: g.measure, target: clampTarget(g.target) });
  }

  update(id: ID, patch: Partial<NewGoal>): Promise<Goal | undefined> {
    return this.repo.update<Goal>('goals', id, () => ({
      ...patch,
      ...(patch.target !== undefined ? { target: clampTarget(patch.target) } : {}),
    }));
  }

  /** Soft-deletes the goal. Returns it as it was, or undefined when it is missing or already deleted. */
  async remove(id: ID): Promise<Goal | undefined> {
    const existing = await this.db.goals.get(id);
    if (!existing || existing.deleted) return undefined;
    await this.repo.softDelete('goals', id);
    return existing;
  }

  /** Puts a removed goal back. It is re-stamped, so the restore syncs as the newest write. */
  async restore(goal: Goal): Promise<void> {
    const { deleted: _deleted, ...live } = goal;
    await this.repo.put<Goal>('goals', live);
  }
}
