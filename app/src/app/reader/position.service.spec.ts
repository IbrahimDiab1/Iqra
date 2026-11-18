import { TestBed } from '@angular/core/testing';
import { CLOCK } from '../core/clock';
import { DB, IqraDb } from '../core/db';
import { DEVICE_ID, newId } from '../core/ids';
import type { Book, Position } from '../core/models';
import { Repo } from '../core/repo';
import { PositionService } from './position.service';

const THIS_DEVICE = 'device-a';
const OTHER_DEVICE = 'device-b';

function bookDraft(id: string, over: Partial<Book> = {}): Omit<Book, 'updatedAt' | 'deviceId'> {
  return {
    id,
    title: 'Sample',
    author: 'Author',
    driveFileId: 'drive-1',
    fileName: 'sample.pdf',
    sizeBytes: 1,
    sha256: 'abc',
    pageCount: 300,
    outline: [],
    language: 'en',
    direction: 'ltr',
    addedAt: 1,
    status: 'to-read',
    categoryIds: [],
    tags: [],
    progressMode: 'last-page',
    pageMode: 'swipe',
    lastPageReached: 0,
    ...over,
  };
}

describe('PositionService', () => {
  let db: IqraDb;
  let repo: Repo;
  let clock: { t: number };
  let service: PositionService;

  beforeEach(() => {
    localStorage.clear();
    clock = { t: 1000 };
    TestBed.configureTestingModule({
      providers: [
        { provide: DB, useFactory: () => new IqraDb(`iqra-test-${newId()}`) },
        { provide: CLOCK, useValue: { now: () => clock.t } },
        { provide: DEVICE_ID, useValue: THIS_DEVICE },
      ],
    });
    db = TestBed.inject(DB);
    repo = TestBed.inject(Repo);
    service = TestBed.inject(PositionService);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await db.delete();
  });

  async function addBook(over: Partial<Book> = {}): Promise<Book> {
    return repo.put<Book>('books', bookDraft('b1', over));
  }

  function otherDevicePosition(over: Partial<Position> & { updatedAt: number }): Promise<unknown> {
    return db.positions.put({
      id: `b1:${OTHER_DEVICE}`,
      bookId: 'b1',
      page: 1,
      offset: 0,
      zoom: 1,
      view: 'page',
      deviceId: OTHER_DEVICE,
      ...over,
    });
  }

  describe('restore', () => {
    it('starts at the last page reached when there is no position', async () => {
      const book = await addBook({ lastPageReached: 7 });
      const r = await service.restore(book);

      expect(r).toEqual({
        place: { page: 7, offset: 0 },
        zoom: 1,
        view: 'page',
        fromOtherDevice: false,
      });
    });

    it('starts at page 1 when nothing has been read', async () => {
      const book = await addBook({ lastPageReached: 0 });
      expect((await service.restore(book)).place.page).toBe(1);
    });

    it('takes the newest position and reports the previous local page after another device', async () => {
      const book = await addBook();
      clock.t = 1000;
      await repo.put<Position>('positions', {
        id: `b1:${THIS_DEVICE}`,
        bookId: 'b1',
        page: 5,
        offset: 0,
        zoom: 1,
        view: 'page',
      });
      await otherDevicePosition({ page: 90, offset: 0.2, updatedAt: 2000 });

      const r = await service.restore(book);
      expect(r.place).toEqual({ page: 90, offset: 0.2 });
      expect(r.fromOtherDevice).toBe(true);
      expect(r.previousLocal).toEqual({ page: 5, offset: 0 });
    });

    it('is not from another device when this device wrote the newest position', async () => {
      const book = await addBook();
      await otherDevicePosition({ page: 90, updatedAt: 1000 });
      clock.t = 2000;
      await repo.put<Position>('positions', {
        id: `b1:${THIS_DEVICE}`,
        bookId: 'b1',
        page: 5,
        offset: 0,
        zoom: 1,
        view: 'page',
      });

      const r = await service.restore(book);
      expect(r.place.page).toBe(5);
      expect(r.fromOtherDevice).toBe(false);
    });

    it('clamps the page to the book and the offset to 0..1, and the zoom to the view range', async () => {
      const book = await addBook({ pageCount: 300 });
      await repo.put<Position>('positions', {
        id: `b1:${THIS_DEVICE}`,
        bookId: 'b1',
        page: 9999,
        offset: 5,
        zoom: 9,
        view: 'page',
      });
      let r = await service.restore(book);
      expect(r.place).toEqual({ page: 300, offset: 1 });
      expect(r.zoom).toBe(4);

      await repo.put<Position>('positions', {
        id: `b1:${THIS_DEVICE}`,
        bookId: 'b1',
        page: 9999,
        offset: -1,
        zoom: 9,
        view: 'page',
      });
      r = await service.restore(book);
      expect(r.place.offset).toBe(0);
    });

    it('sanitizes a non-finite stored zoom', async () => {
      const book = await addBook();
      await repo.put<Position>('positions', { id: `b1:${THIS_DEVICE}`, bookId: 'b1', page: 2, offset: 0, zoom: NaN, view: 'page' });
      expect((await service.restore(book)).zoom).toBe(1);
    });

    it('ignores a soft-deleted newest position', async () => {
      const book = await addBook();
      await repo.put<Position>('positions', {
        id: `b1:${THIS_DEVICE}`,
        bookId: 'b1',
        page: 5,
        offset: 0,
        zoom: 1,
        view: 'page',
      });
      await otherDevicePosition({ page: 99, updatedAt: 5000, deleted: true });

      expect((await service.restore(book)).place.page).toBe(5);
    });
  });

  describe('schedule', () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));

    it('writes one position with the last values after three calls within 800 ms', async () => {
      await addBook();
      const put = vi.spyOn(repo, 'put');

      const b = (await db.books.get('b1'))!;
      service.schedule(b, { page: 3, offset: 0.1, zoom: 1, view: 'page' });
      service.schedule(b, { page: 7, offset: 0.2, zoom: 1, view: 'page' });
      service.schedule(b, { page: 4, offset: 0.9, zoom: 1.25, view: 'page' });
      await vi.advanceTimersByTimeAsync(800);
      await service.flush();

      const positionWrites = put.mock.calls.filter(([table]) => table === 'positions');
      expect(positionWrites).toHaveLength(1);
      const stored = await db.positions.get(`b1:${THIS_DEVICE}`);
      expect(stored).toMatchObject({ bookId: 'b1', page: 4, offset: 0.9, zoom: 1.25, view: 'page' });
    });

    it('raises lastPageReached to the furthest page', async () => {
      await addBook({ lastPageReached: 10 });
      const b = (await db.books.get('b1'))!;

      service.schedule(b, { page: 4, offset: 0, zoom: 1, view: 'page' });
      await service.flush();
      expect((await db.books.get('b1'))?.lastPageReached).toBe(10);

      service.schedule(b, { page: 12, offset: 0, zoom: 1, view: 'page' });
      await service.flush();
      expect((await db.books.get('b1'))?.lastPageReached).toBe(12);
    });

    it('does not change lastOpenedAt or status when only the place changes', async () => {
      await addBook();
      const b = (await db.books.get('b1'))!;
      service.schedule(b, { page: 2, offset: 0, zoom: 1, view: 'page' });
      await service.flush();
      const stored = await db.books.get('b1');
      expect(stored?.status).toBe('to-read');
      expect(stored?.lastOpenedAt).toBeUndefined();
    });
  });

  describe('markOpened', () => {
    it('sets lastOpenedAt and moves to-read to reading without writing a position', async () => {
      await addBook({ lastPageReached: 5 });
      clock.t = 4000;
      const b = (await db.books.get('b1'))!;
      await service.markOpened(b);
      await service.flush();

      expect(await db.books.get('b1')).toMatchObject({ status: 'reading', lastOpenedAt: 4000, lastPageReached: 5 });
      expect(await db.positions.count()).toBe(0);
    });

    it('keeps other statuses', async () => {
      await addBook({ status: 'finished' });
      await service.markOpened((await db.books.get('b1'))!);
      expect((await db.books.get('b1'))?.status).toBe('finished');
    });
  });

  describe('flush', () => {
    beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));

    it('writes the pending state immediately and cancels the timer', async () => {
      await addBook();
      const put = vi.spyOn(repo, 'put');
      const b = (await db.books.get('b1'))!;

      service.schedule(b, { page: 6, offset: 0.5, zoom: 1, view: 'page' });
      await service.flush();
      expect((await db.positions.get(`b1:${THIS_DEVICE}`))?.page).toBe(6);

      await vi.advanceTimersByTimeAsync(2000);
      expect(put.mock.calls.filter(([t]) => t === 'positions')).toHaveLength(1);
    });

    it('logs a failed timer-driven write instead of leaking an unhandled rejection', async () => {
      await addBook();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      vi.spyOn(repo, 'put').mockRejectedValue(new Error('disk full'));
      const b = (await db.books.get('b1'))!;

      service.schedule(b, { page: 6, offset: 0, zoom: 1, view: 'page' });
      await vi.advanceTimersByTimeAsync(900);
      await vi.advanceTimersByTimeAsync(0);
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });

    it('does nothing when nothing is pending', async () => {
      const put = vi.spyOn(repo, 'put');
      await service.flush();
      expect(put).not.toHaveBeenCalled();
    });
  });
});
