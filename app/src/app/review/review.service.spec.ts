import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOCK } from '../core/clock';
import { DB, IqraDb } from '../core/db';
import { newId } from '../core/ids';
import { ReviewService } from './review.service';

describe('ReviewService', () => {
  let db: IqraDb;
  let service: ReviewService;
  const now = 1_000_000;
  const input = { text: ' Serendipity ', translation: 'صدفة', sourceLang: 'en' as const, bookId: 'b1', page: 3, context: 'A happy serendipity.' };

  beforeEach(() => {
    db = new IqraDb(`iqra-test-${newId()}`);
    TestBed.configureTestingModule({ providers: [{ provide: DB, useValue: db }, { provide: CLOCK, useValue: { now: () => now } }] });
    service = TestBed.inject(ReviewService);
  });
  afterEach(async () => {
    TestBed.resetTestingModule();
    await db.delete();
  });

  it('saves a trimmed item with a kind and a schedule due now', async () => {
    const { item, existed } = await service.add(input);
    expect(existed).toBe(false);
    expect(item).toMatchObject({ text: 'Serendipity', kind: 'word', translation: 'صدفة', bookId: 'b1', page: 3, createdAt: now });
    expect(item.srs).toMatchObject({ due: now, reps: 0, lapses: 0 });
    await vi.waitFor(() => expect(service.items()()?.map((r) => r.id)).toEqual([item.id]));
  });

  it('keeps one item per text and book and its schedule', async () => {
    const first = (await service.add(input)).item;
    await service.gradeItem(first.id, 'good');
    const again = await service.add({ ...input, text: 'serendipity', translation: 'حظ' });
    expect(again.existed).toBe(true);
    expect(again.item.id).toBe(first.id);
    expect(again.item.translation).toBe('حظ');
    expect(again.item.srs.reps).toBe(1);
    expect(await db.review.count()).toBe(1);
    // Another book may save the same word.
    expect((await service.add({ ...input, bookId: 'b2' })).existed).toBe(false);
  });

  it('soft-deletes and restores', async () => {
    const { item } = await service.add(input);
    const removed = await service.remove(item.id);
    expect(removed?.id).toBe(item.id);
    expect((await db.review.get(item.id))!.deleted).toBe(true);
    await vi.waitFor(() => expect(service.items()()).toEqual([]));
    expect(await service.remove(item.id)).toBeUndefined();
    await service.restore(removed!);
    expect((await db.review.get(item.id))!.deleted).toBeUndefined();
    await vi.waitFor(() => expect(service.items()()).toHaveLength(1));
  });

  it('edits text and translation and re-derives the kind', async () => {
    const { item } = await service.add(input);
    const next = await service.update(item.id, { text: 'a happy accident', translation: 'x' });
    expect(next).toMatchObject({ text: 'a happy accident', kind: 'phrase', translation: 'x' });
  });

  it('grades an item and counts due items', async () => {
    const a = (await service.add(input)).item;
    await service.add({ ...input, text: 'other' });
    const due = TestBed.runInInjectionContext(() => service.dueCount());
    await vi.waitFor(() => expect(due()).toBe(2));
    const graded = await service.gradeItem(a.id, 'good');
    expect(graded!.srs).toMatchObject({ reps: 1, intervalDays: 1, due: now + 86_400_000 });
    await vi.waitFor(() => expect(due()).toBe(1));
  });
});
