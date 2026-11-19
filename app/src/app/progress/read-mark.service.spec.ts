import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOCK } from '../core/clock';
import { DB, IqraDb } from '../core/db';
import { DEVICE_ID, newId } from '../core/ids';
import { ReadMarkService } from './read-mark.service';

describe('ReadMarkService', () => {
  let db: IqraDb;
  let service: ReadMarkService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        { provide: DB, useFactory: () => new IqraDb(`iqra-test-${newId()}`) },
        { provide: CLOCK, useValue: { now: () => 1000 } },
        { provide: DEVICE_ID, useValue: 'dev' },
      ],
    });
    db = TestBed.inject(DB);
    service = TestBed.inject(ReadMarkService);
  });

  afterEach(async () => {
    await db.delete();
  });

  it('toggle twice leaves read false and the record in place', async () => {
    await service.toggle('b', 4);
    expect((await db.readMarks.get('b:4'))?.read).toBe(true);
    await service.toggle('b', 4);
    const rec = await db.readMarks.get('b:4');
    expect(rec).toBeDefined();
    expect(rec!.read).toBe(false);
    expect(rec!.deleted).toBeUndefined();
  });

  it('setRange marks and clears every page in the range', async () => {
    await service.setRange('b', 3, 5, true);
    expect((await db.readMarks.toArray()).filter((m) => m.read).map((m) => m.page).sort()).toEqual([3, 4, 5]);
    await service.setRange('b', 3, 5, false);
    expect((await db.readMarks.toArray()).filter((m) => m.read)).toEqual([]);
    expect(await db.readMarks.count()).toBe(3);
  });

  it('marked() is live and only holds read, undeleted pages of that book', async () => {
    const marked = TestBed.runInInjectionContext(() => service.marked('b'));
    await service.setRange('b', 1, 2, true);
    await service.setRange('other', 9, 9, true);
    await service.toggle('b', 2);
    await new Promise((r) => setTimeout(r, 50));
    expect([...(marked() ?? [])]).toEqual([1]);
  });

  it('release drops the cached live set so a reopened book starts a fresh query', async () => {
    const first = TestBed.runInInjectionContext(() => service.marked('b'));
    expect(service.marked('b')).toBe(first); // a second user of the same book
    service.release('b');
    service.release('b');
    const second = service.marked('b');
    expect(second).not.toBe(first);
    await service.toggle('b', 3);
    await vi.waitFor(() => expect([...(second() ?? [])]).toEqual([3]));
  });
});
