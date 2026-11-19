import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLOCK } from '../core/clock';
import { DB, IqraDb } from '../core/db';
import { newId } from '../core/ids';
import { CategoryService } from './category.service';

describe('CategoryService', () => {
  let db: IqraDb;
  let service: CategoryService;
  let t: number;

  const live = async () => (await db.categories.toArray()).filter((c) => !c.deleted).sort((a, b) => a.order - b.order);

  beforeEach(() => {
    localStorage.clear();
    db = new IqraDb(`iqra-test-${newId()}`);
    t = 1000;
    TestBed.configureTestingModule({
      providers: [
        { provide: DB, useValue: db },
        { provide: CLOCK, useValue: { now: () => ++t } },
      ],
    });
    service = TestBed.inject(CategoryService);
  });

  afterEach(async () => {
    await db.delete();
  });

  it('a double submit of the same name makes one category and refuses the second', async () => {
    const results = await Promise.all([service.add('Fiqh'), service.add('fiqh')]);
    expect(results.filter((r) => r === null)).toHaveLength(1);
    expect(results.filter((r) => r === 'duplicate')).toHaveLength(1);
    expect(await live()).toHaveLength(1);
  });

  it('two different names added at once get different orders', async () => {
    await Promise.all([service.add('Fiqh'), service.add('History')]);
    const orders = (await live()).map((c) => c.order);
    expect(new Set(orders).size).toBe(2);
  });

  it('rename changes only the name, so a newer order written meanwhile is not lost', async () => {
    await service.add('Fiqh');
    const [stale] = await live();
    await db.categories.update(stale.id, { order: 7 });
    expect(await service.rename(stale, 'Law')).toBeNull();
    const [after] = await live();
    expect(after.name).toBe('Law');
    expect(after.order).toBe(7);
  });

  it('move writes only the order of the categories that change', async () => {
    await service.add('A');
    await service.add('B');
    await service.add('C');
    const list = await live();
    // The service reads its live signal; give the live query time to catch up.
    await new Promise((r) => setTimeout(r, 50));
    await db.categories.update(list[0].id, { name: 'A2' });
    await service.move(0, 2);
    const after = await live();
    expect(after.map((c) => c.id)).toEqual([list[1].id, list[2].id, list[0].id]);
    expect(after.find((c) => c.id === list[0].id)!.name).toBe('A2');
  });
});
