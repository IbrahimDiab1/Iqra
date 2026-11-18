import { Book, SyncRecord } from '../core/models';
import { duplicateBooks, mergeTable, pruneTombstones } from './merge';

const DAY = 864e5;

function rec(overrides: Partial<SyncRecord> & { id: string }): SyncRecord {
  return { updatedAt: 1000, deviceId: 'a', ...overrides } as SyncRecord;
}

describe('mergeTable', () => {
  it('remote newer → appears in toLocal, needsPush = false', () => {
    const local = [rec({ id: 'x', updatedAt: 1, deviceId: 'a', title: 'old' })];
    const remote = [rec({ id: 'x', updatedAt: 2, deviceId: 'a', title: 'new' })];
    const result = mergeTable(local, remote);
    expect(result.toLocal).toEqual([remote[0]]);
    expect(result.needsPush).toBe(false);
  });

  it('local newer → not in toLocal, needsPush = true', () => {
    const local = [rec({ id: 'x', updatedAt: 2, deviceId: 'a', title: 'new' })];
    const remote = [rec({ id: 'x', updatedAt: 1, deviceId: 'a', title: 'old' })];
    const result = mergeTable(local, remote);
    expect(result.toLocal).toEqual([]);
    expect(result.needsPush).toBe(true);
  });

  it('equal updatedAt → the higher deviceId wins (local "b" beats remote "a")', () => {
    const local = [rec({ id: 'x', updatedAt: 5, deviceId: 'b' })];
    const remote = [rec({ id: 'x', updatedAt: 5, deviceId: 'a' })];
    const result = mergeTable(local, remote);
    expect(result.toLocal).toEqual([]);
    expect(result.needsPush).toBe(true);
    expect(result.merged).toEqual([local[0]]);
  });

  it('remote tombstone newer than a live local → toLocal contains the tombstone', () => {
    const local = [rec({ id: 'x', updatedAt: 1, deviceId: 'a' })];
    const remote = [rec({ id: 'x', updatedAt: 2, deviceId: 'a', deleted: true })];
    const result = mergeTable(local, remote);
    expect(result.toLocal).toEqual([remote[0]]);
    expect(result.merged).toEqual([remote[0]]);
  });

  it('local-only record → needsPush = true; remote-only record → in toLocal', () => {
    const localOnly = rec({ id: 'L' });
    const remoteOnly = rec({ id: 'R' });
    const pushResult = mergeTable([localOnly], []);
    expect(pushResult.needsPush).toBe(true);
    expect(pushResult.toLocal).toEqual([]);

    const pullResult = mergeTable([], [remoteOnly]);
    expect(pullResult.toLocal).toEqual([remoteOnly]);
    expect(pullResult.needsPush).toBe(false);
  });
});

describe('pruneTombstones', () => {
  const now = Date.UTC(2026, 10, 14);

  it('removes a tombstone 91 days old, keeps one 89 days old, always keeps live records', () => {
    const old = rec({ id: 'old', updatedAt: now - 91 * DAY, deleted: true });
    const recent = rec({ id: 'recent', updatedAt: now - 89 * DAY, deleted: true });
    const live = rec({ id: 'live', updatedAt: now - 365 * DAY });
    const kept = pruneTombstones([old, recent, live], now);
    expect(kept).toEqual([recent, live]);
  });
});

describe('duplicateBooks', () => {
  const base: Book = {
    id: 'base',
    addedAt: 0,
    title: 't',
    author: 'a',
    driveFileId: 'd',
    fileName: 'f.pdf',
    sizeBytes: 1,
    sha256: 'same',
    pageCount: 1,
    outline: [],
    language: 'en',
    direction: 'ltr',
    status: 'to-read',
    categoryIds: [],
    tags: [],
    progressMode: 'last-page',
    pageMode: 'swipe',
    lastPageReached: 0,
    deviceId: 'a',
    updatedAt: 1,
  };

  it('keeps the earlier addedAt among live duplicates and drops the later one', () => {
    const books = [
      { ...base, id: 'later', addedAt: 5 },
      { ...base, id: 'earlier', addedAt: 3 },
    ];
    expect(duplicateBooks(books)).toEqual([{ keep: 'earlier', drop: 'later' }]);
  });

  it('ignores a deleted duplicate', () => {
    const books = [
      { ...base, id: 'live', addedAt: 3 },
      { ...base, id: 'gone', addedAt: 5, deleted: true },
    ];
    expect(duplicateBooks(books)).toEqual([]);
  });

  it('prefers a copy with a driveFileId over an earlier one without', () => {
    const books = [
      { ...base, id: 'early', addedAt: 1, driveFileId: '' },
      { ...base, id: 'uploaded', addedAt: 5, driveFileId: 'f' },
    ];
    expect(duplicateBooks(books)).toEqual([{ keep: 'uploaded', drop: 'early' }]);
  });
});
