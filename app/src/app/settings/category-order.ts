import type { Category } from '../core/models';

const MAX_NAME = 40;

/**
 * Moves one category and returns only the categories whose `order` changes, with their new values,
 * in their new order. `list` must be sorted by `order`. Orders become 0..n-1, which also closes gaps.
 * An out-of-range index or a move to the same place returns [].
 */
export function moveCategory(list: readonly Category[], from: number, to: number): Category[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [];
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  const before = new Map(list.map((c) => [c.id, c.order]));
  return next.map((c, order) => ({ ...c, order })).filter((c) => before.get(c.id) !== c.order);
}

/** The `order` for a category added at the end. */
export function nextOrder(list: readonly Category[]): number {
  return list.reduce((max, c) => Math.max(max, c.order + 1), 0);
}

/** Trims, collapses runs of spaces and cuts to 40 characters. '' when nothing is left. */
export function normalizeName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME).trimEnd();
}

/** The row index a dragged item would drop at, for a pointer at `y`. Clamped to the first and last row. */
export function dropIndex(rows: readonly { top: number; height: number }[], y: number): number {
  if (rows.length === 0) return 0;
  const index = rows.findIndex((r) => y < r.top + r.height);
  return index === -1 ? rows.length - 1 : index;
}
