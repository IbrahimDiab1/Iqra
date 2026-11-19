import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOCK } from '../core/clock';
import { DB, IqraDb } from '../core/db';
import { newId } from '../core/ids';
import { GoalService } from './goal.service';

describe('GoalService', () => {
  let db: IqraDb;
  let service: GoalService;

  beforeEach(() => {
    db = new IqraDb(`iqra-test-${newId()}`);
    TestBed.configureTestingModule({
      providers: [{ provide: DB, useValue: db }, { provide: CLOCK, useValue: { now: () => 5000 } }],
    });
    service = TestBed.inject(GoalService);
  });

  afterEach(async () => {
    TestBed.resetTestingModule();
    await db.delete();
  });

  it('creates a goal and lists it live', async () => {
    const g = await service.create({ categoryId: null, measure: 'pages', target: 100 });
    expect(g).toMatchObject({ categoryId: null, measure: 'pages', target: 100, updatedAt: 5000 });
    await vi.waitFor(() => expect(service.goals()()?.map((x) => x.id)).toEqual([g.id]));
  });

  it('clamps the target to a whole number from 1 to 100000', async () => {
    expect((await service.create({ categoryId: null, measure: 'time', target: 0 })).target).toBe(1);
    expect((await service.create({ categoryId: null, measure: 'time', target: -4 })).target).toBe(1);
    expect((await service.create({ categoryId: null, measure: 'time', target: 2.6 })).target).toBe(3);
    expect((await service.create({ categoryId: null, measure: 'time', target: 1e9 })).target).toBe(100_000);
    expect((await service.create({ categoryId: null, measure: 'time', target: Number.NaN })).target).toBe(1);
  });

  it('updates fields and clamps the target', async () => {
    const g = await service.create({ categoryId: null, measure: 'pages', target: 10 });
    const next = await service.update(g.id, { target: 500_000, measure: 'time' });
    expect(next).toMatchObject({ target: 100_000, measure: 'time' });
    expect((await db.goals.get(g.id))!.target).toBe(100_000);
  });

  it('soft-deletes and restores', async () => {
    const g = await service.create({ categoryId: 'c1', measure: 'pages', target: 10 });
    const removed = await service.remove(g.id);
    expect(removed?.id).toBe(g.id);
    expect((await db.goals.get(g.id))!.deleted).toBe(true);
    await vi.waitFor(() => expect(service.goals()()).toEqual([]));
    expect(await service.remove(g.id)).toBeUndefined();
    await service.restore(removed!);
    expect((await db.goals.get(g.id))!.deleted).toBeUndefined();
    await vi.waitFor(() => expect(service.goals()()).toHaveLength(1));
  });
});
