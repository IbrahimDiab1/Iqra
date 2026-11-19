import { describe, expect, it } from 'vitest';
import type { Category } from '../core/models';
import { dropIndex, moveCategory, nextOrder, normalizeName } from './category-order';

const cat = (id: string, order: number): Category => ({ id, name: id, order, updatedAt: 1, deviceId: 'd' });

describe('moveCategory', () => {
  const list = [cat('A', 0), cat('B', 1), cat('C', 2)];

  it('moving 0 to 2 gives B, C, A with order 0, 1, 2', () => {
    const patch = moveCategory(list, 0, 2);
    expect(patch.map((c) => [c.id, c.order])).toEqual([['B', 0], ['C', 1], ['A', 2]]);
  });

  it('moving to the same index changes nothing', () => {
    expect(moveCategory(list, 1, 1)).toEqual([]);
  });

  it('returns only the items whose order changed', () => {
    expect(moveCategory(list, 0, 1).map((c) => [c.id, c.order])).toEqual([['B', 0], ['A', 1]]);
  });

  it('closes gaps in existing order values', () => {
    const gappy = [cat('A', 0), cat('B', 5), cat('C', 9)];
    expect(moveCategory(gappy, 2, 0).map((c) => [c.id, c.order])).toEqual([['C', 0], ['A', 1], ['B', 2]]);
  });

  it('ignores out-of-range indexes', () => {
    expect(moveCategory(list, 0, 3)).toEqual([]);
    expect(moveCategory(list, -1, 0)).toEqual([]);
  });

  it('does not mutate its input', () => {
    moveCategory(list, 0, 2);
    expect(list.map((c) => c.order)).toEqual([0, 1, 2]);
  });
});

describe('nextOrder', () => {
  it('is one past the highest order, or 0 for an empty list', () => {
    expect(nextOrder([])).toBe(0);
    expect(nextOrder([cat('A', 0), cat('B', 4)])).toBe(5);
  });
});

describe('normalizeName', () => {
  it('trims and collapses spaces', () => {
    expect(normalizeName('  a   b ')).toBe('a b');
  });

  it('truncates to 40 characters', () => {
    expect(normalizeName('x'.repeat(60))).toBe('x'.repeat(40));
  });

  it('returns an empty string for blank input', () => {
    expect(normalizeName('   ')).toBe('');
  });

  it('does not leave a trailing space after truncating', () => {
    expect(normalizeName('x'.repeat(39) + ' y')).toBe('x'.repeat(39));
  });
});

describe('dropIndex', () => {
  const rows = [{ top: 0, height: 40 }, { top: 40, height: 40 }, { top: 80, height: 40 }];

  it('picks the row under the pointer', () => {
    expect(dropIndex(rows, 10)).toBe(0);
    expect(dropIndex(rows, 60)).toBe(1);
    expect(dropIndex(rows, 110)).toBe(2);
  });

  it('clamps above the first and below the last row', () => {
    expect(dropIndex(rows, -50)).toBe(0);
    expect(dropIndex(rows, 500)).toBe(2);
  });

  it('is 0 for no rows', () => {
    expect(dropIndex([], 10)).toBe(0);
  });
});
