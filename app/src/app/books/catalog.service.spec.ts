import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOCK } from '../core/clock';
import { DB, IqraDb } from '../core/db';
import { newId } from '../core/ids';
import { Repo } from '../core/repo';
import { CatalogService } from './catalog.service';

describe('CatalogService', () => {
  let db: IqraDb;
  let clock: { t: number };
  let catalog: CatalogService;
  let repo: Repo;

  beforeEach(() => {
    localStorage.clear();
    db = new IqraDb(`iqra-test-${newId()}`);
    clock = { t: 1000 };
    TestBed.configureTestingModule({
      providers: [
        { provide: DB, useValue: db },
        { provide: CLOCK, useValue: { now: () => clock.t } },
      ],
    });
    catalog = TestBed.inject(CatalogService);
    repo = TestBed.inject(Repo);
  });

  afterEach(async () => {
    await db.delete();
  });

  describe('addCategory', () => {
    it('trims the name and returns the same category when added twice', async () => {
      const first = await catalog.addCategory(' Tech ');
      const second = await catalog.addCategory(' Tech ');

      expect(first.name).toBe('Tech');
      expect(second.id).toBe(first.id);
      const stored = await db.categories.toArray();
      expect(stored).toHaveLength(1);
      expect(stored[0].name).toBe('Tech');
    });

    it('matches existing names case-insensitively', async () => {
      const first = await catalog.addCategory('Tech');
      const again = await catalog.addCategory('tECH');

      expect(again.id).toBe(first.id);
      expect(await db.categories.count()).toBe(1);
    });

    it('orders a new category after the highest existing order', async () => {
      const a = await catalog.addCategory('A');
      const b = await catalog.addCategory('B');
      const c = await catalog.addCategory('C');

      expect([a.order, b.order, c.order]).toEqual([0, 1, 2]);
    });

    it('ignores deleted categories when matching names', async () => {
      const old = await catalog.addCategory('Tech');
      await repo.softDelete('categories', old.id);

      const fresh = await catalog.addCategory('Tech');

      expect(fresh.id).not.toBe(old.id);
      expect(fresh.deleted).toBeFalsy();
    });
  });

  describe('categories', () => {
    it('lists live categories sorted by order', async () => {
      await catalog.addCategory('Second');
      await catalog.addCategory('First');
      const gone = await catalog.addCategory('Gone');
      await repo.softDelete('categories', gone.id);

      await vi.waitFor(() => expect(catalog.categories().map((c) => c.name)).toEqual(['Second', 'First']));
    });
  });

  describe('up next', () => {
    it('is empty when there is no up-next record', () => {
      expect(catalog.upNext()).toEqual([]);
    });

    it('appends on toggle on and removes on toggle off', async () => {
      await catalog.toggleUpNext('a', true);
      await catalog.toggleUpNext('b', true);
      await catalog.toggleUpNext('a', false);

      expect((await db.upNext.get('up-next'))?.bookIds).toEqual(['b']);
      await vi.waitFor(() => expect(catalog.upNext()).toEqual(['b']));
    });

    it('does nothing when toggling on a book already in the list', async () => {
      await catalog.toggleUpNext('a', true);
      await catalog.toggleUpNext('b', true);
      await catalog.toggleUpNext('a', true);

      expect((await db.upNext.get('up-next'))?.bookIds).toEqual(['a', 'b']);
    });

    it('does nothing when toggling off a book not in the list', async () => {
      await catalog.toggleUpNext('a', true);
      const before = await db.upNext.get('up-next');

      await catalog.toggleUpNext('z', false);

      expect(await db.upNext.get('up-next')).toEqual(before);
    });

    it('setUpNext keeps the first occurrence of each id', async () => {
      await catalog.setUpNext(['a', 'b', 'a', 'c', 'b']);

      expect((await db.upNext.get('up-next'))?.bookIds).toEqual(['a', 'b', 'c']);
    });
  });
});
