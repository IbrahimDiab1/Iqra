import { TestBed } from '@angular/core/testing';
import { CLOCK } from './clock';
import { DB, IqraDb } from './db';
import { getDeviceId, newId } from './ids';
import { Repo } from './repo';
import type { Book } from './models';

function bookDraft(id: string): Omit<Book, 'updatedAt' | 'deviceId'> {
  return {
    id,
    title: 'Sample',
    author: 'Author',
    driveFileId: 'drive-1',
    fileName: 'sample.pdf',
    sizeBytes: 1,
    sha256: 'abc',
    pageCount: 3,
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
  };
}

describe('Repo', () => {
  let repo: Repo;
  let db: IqraDb;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        { provide: DB, useFactory: () => new IqraDb(`iqra-test-${newId()}`) },
        { provide: CLOCK, useValue: { now: () => 1000 } },
      ],
    });
    repo = TestBed.inject(Repo);
    db = TestBed.inject(DB);
  });

  afterEach(async () => {
    await db.delete();
  });

  describe('put', () => {
    it('stamps updatedAt from the clock and deviceId from the install', async () => {
      await repo.put<Book>('books', bookDraft('b1'));

      const stored = await db.books.get('b1');
      expect(stored?.updatedAt).toBe(1000);
      expect(stored?.deviceId).toBe(getDeviceId());
    });

    it('emits once on changes$', async () => {
      const spy = vi.fn();
      const sub = repo.changes$.subscribe(spy);

      await repo.put<Book>('books', bookDraft('b1'));

      sub.unsubscribe();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toMatchObject({ table: 'books', rec: { id: 'b1', updatedAt: 1000 } });
    });
  });

  describe('softDelete', () => {
    it('keeps the record, marks it deleted and updates updatedAt', async () => {
      await repo.put<Book>('books', bookDraft('b1'));
      await repo.softDelete('books', 'b1');

      const stored = await db.books.get('b1');
      expect(stored).toBeDefined();
      expect(stored?.deleted).toBe(true);
      expect(stored?.updatedAt).toBe(1000);
    });

    it('emits once on changes$ with the deleted record', async () => {
      await repo.put<Book>('books', bookDraft('b1'));
      const spy = vi.fn();
      const sub = repo.changes$.subscribe(spy);

      await repo.softDelete('books', 'b1');

      sub.unsubscribe();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toMatchObject({ table: 'books', rec: { id: 'b1', deleted: true } });
    });
  });

  describe('applyRemote', () => {
    it('keeps the given updatedAt and emits nothing', async () => {
      const spy = vi.fn();
      const sub = repo.changes$.subscribe(spy);

      await repo.applyRemote('books', [{ ...bookDraft('b2'), updatedAt: 500, deviceId: 'remote' } as Book]);

      sub.unsubscribe();
      expect(spy).not.toHaveBeenCalled();
      const stored = await db.books.get('b2');
      expect(stored?.updatedAt).toBe(500);
      expect(stored?.deviceId).toBe('remote');
    });
  });

  describe('live', () => {
    it('reflects writes and is undefined until the first result', async () => {
      const signal = TestBed.runInInjectionContext(() =>
        repo.live(() => db.books.toArray()),
      );
      expect(signal()).toBeUndefined();

      await repo.put<Book>('books', bookDraft('b1'));

      await vi.waitFor(() => expect(signal()?.map((b) => b.id)).toEqual(['b1']));
    });
  });
});
