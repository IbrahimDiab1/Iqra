import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { CLOCK } from '../core/clock';
import { DB, IqraDb } from '../core/db';
import { newId } from '../core/ids';
import type { Annotation, TextAnchor } from '../core/models';
import type { TextItem } from '../reader/text';
import { buildAnchor } from './anchor';
import { AnnotationService } from './annotation.service';

const SIZE = { widthPt: 600, heightPt: 800 };
const ITEMS: TextItem[] = [
  { str: 'Intro text', transform: [12, 0, 0, 12, 100, 720], width: 80, height: 12 },
  { str: 'abcdefghijklmnop', transform: [12, 0, 0, 12, 100, 700], width: 160, height: 12 },
];
const GEOMETRY = { items: ITEMS, size: SIZE };

function anchor(page: number, start: [number, number], end: [number, number]): TextAnchor {
  return buildAnchor(
    ITEMS,
    page,
    { item: start[0], offset: start[1] },
    { item: end[0], offset: end[1] },
    SIZE,
  );
}

describe('AnnotationService', () => {
  let service: AnnotationService;
  let db: IqraDb;
  let clock: { t: number };

  beforeEach(() => {
    localStorage.clear();
    clock = { t: 1000 };
    TestBed.configureTestingModule({
      providers: [
        { provide: DB, useFactory: () => new IqraDb(`iqra-annotations-${newId()}`) },
        { provide: CLOCK, useValue: { now: () => clock.t } },
      ],
    });
    service = TestBed.inject(AnnotationService);
    db = TestBed.inject(DB);
  });

  afterEach(async () => {
    await db.delete();
  });

  it('create stamps id, createdAt and an empty tag list', async () => {
    const rec = await service.create({ bookId: 'b1', type: 'bookmark', page: 2 });
    expect(rec.id).toBeTruthy();
    expect(rec.createdAt).toBe(1000);
    expect(rec.tags).toEqual([]);
    expect(rec.deviceId).toBeTruthy();
    expect(await db.annotations.get(rec.id)).toEqual(rec);
  });

  it('forBook returns only that book, live, sorted by page then createdAt, with summaries last', async () => {
    const signal = service.forBook('b1');
    clock.t = 1;
    await service.create({ bookId: 'b1', type: 'summary', scope: { kind: 'book' } });
    clock.t = 2;
    const late = await service.create({ bookId: 'b1', type: 'bookmark', page: 5 });
    clock.t = 3;
    const early = await service.create({ bookId: 'b1', type: 'bookmark', page: 1 });
    clock.t = 4;
    await service.create({ bookId: 'b2', type: 'bookmark', page: 1 });
    const gone = await service.create({ bookId: 'b1', type: 'bookmark', page: 0 });
    await service.remove(gone.id);

    await vi.waitFor(() => expect(signal()?.map((a) => a.type)).toEqual(['bookmark', 'bookmark', 'summary']));
    const ids = signal()!.map((a) => a.id);
    expect(ids[0]).toBe(early.id);
    expect(ids[1]).toBe(late.id);
  });

  it('remove soft-deletes and restore brings the record back', async () => {
    const signal = service.forBook('b1');
    const rec = await service.create({ bookId: 'b1', type: 'bookmark', page: 1 });
    await vi.waitFor(() => expect(signal()).toHaveLength(1));

    const before = await service.remove(rec.id);
    expect(before?.id).toBe(rec.id);
    expect(before?.deleted).toBeUndefined();
    await vi.waitFor(() => expect(signal()).toHaveLength(0));
    expect((await db.annotations.get(rec.id))?.deleted).toBe(true);

    await service.restore(before!);
    await vi.waitFor(() => expect(signal()).toHaveLength(1));
    expect(signal()![0].deleted).toBeUndefined();
  });

  it('update merges the patch and stamps the write', async () => {
    const rec = await service.create({ bookId: 'b1', type: 'note', page: 1, body: 'old', color: 'pink' });
    clock.t = 2000;
    const updated = await service.update(rec.id, { body: 'new', tags: ['x'] });
    expect(updated?.body).toBe('new');
    expect(updated?.tags).toEqual(['x']);
    expect(updated?.color).toBe('pink');
    expect(updated?.updatedAt).toBe(2000);
  });

  it('addHighlight with no overlap creates one highlight with the color and quote', async () => {
    const result = await service.addHighlight('b1', anchor(3, [1, 0], [1, 5]), 'yellow', GEOMETRY);
    expect(result.mergedAway).toEqual([]);
    expect(result.created.type).toBe('highlight');
    expect(result.created.color).toBe('yellow');
    expect(result.created.page).toBe(3);
    expect(result.created.text?.quote).toBe('abcde');
    expect(await db.annotations.count()).toBe(1);
  });

  it('addHighlight overlapping two highlights merges them without losing notes or tags', async () => {
    const a = await service.create({
      bookId: 'b1',
      type: 'highlight',
      page: 3,
      color: 'green',
      text: anchor(3, [1, 0], [1, 5]),
      body: 'a',
      tags: ['x'],
    });
    clock.t = 1100;
    const b = await service.create({
      bookId: 'b1',
      type: 'highlight',
      page: 3,
      color: 'blue',
      text: anchor(3, [1, 8], [1, 12]),
      body: 'b',
      tags: ['y'],
    });

    const { created, mergedAway } = await service.addHighlight('b1', anchor(3, [1, 3], [1, 10]), 'yellow', GEOMETRY);

    expect(created.color).toBe('yellow');
    expect(created.text?.start).toEqual({ item: 1, offset: 0 });
    expect(created.text?.end).toEqual({ item: 1, offset: 12 });
    expect(created.text?.quote).toBe('abcdefghijkl');
    expect(created.body).toBe('a\n\nb');
    expect(created.tags).toEqual(['x', 'y']);
    expect(created.createdAt).toBe(a.createdAt);
    expect(mergedAway.map((m) => m.id).sort()).toEqual([a.id, b.id].sort());
    expect((await db.annotations.get(a.id))?.deleted).toBe(true);
    expect((await db.annotations.get(b.id))?.deleted).toBe(true);
    expect(await db.annotations.filter((r) => !r.deleted).count()).toBe(1);
  });

  it('addHighlight does not merge across pages or with notes and areas', async () => {
    await service.create({ bookId: 'b1', type: 'highlight', page: 4, color: 'green', text: anchor(4, [1, 0], [1, 5]) });
    await service.create({ bookId: 'b1', type: 'note', page: 3, text: anchor(3, [1, 0], [1, 5]) });
    await service.create({
      bookId: 'b1',
      type: 'area',
      page: 3,
      color: 'pink',
      rect: { x: 0, y: 0, w: 1, h: 1 },
    });

    const result = await service.addHighlight('b1', anchor(3, [1, 2], [1, 8]), 'blue', GEOMETRY);
    expect(result.mergedAway).toEqual([]);
    expect(await db.annotations.filter((r) => !r.deleted).count()).toBe(4);
  });

  it('undoAddHighlight deletes the new highlight and restores the merged originals', async () => {
    const a = await service.create({
      bookId: 'b1',
      type: 'highlight',
      page: 3,
      color: 'green',
      text: anchor(3, [1, 0], [1, 5]),
      body: 'a',
      tags: ['x'],
    });
    const signal = service.forBook('b1');
    await vi.waitFor(() => expect(signal()).toHaveLength(1));

    const result = await service.addHighlight('b1', anchor(3, [1, 3], [1, 8]), 'pink', GEOMETRY);
    await vi.waitFor(() => expect(signal()?.[0]?.id).toBe(result.created.id));

    await service.undoAddHighlight(result);

    await vi.waitFor(() => expect(signal()?.[0]?.id).toBe(a.id));
    const [restored] = signal()!;
    expect(restored.id).toBe(a.id);
    expect(restored.color).toBe('green');
    expect(restored.body).toBe('a');
    expect(restored.tags).toEqual(['x']);
    expect(restored.text?.quote).toBe('abcde');
    expect(restored.deleted).toBeUndefined();
  });
});
