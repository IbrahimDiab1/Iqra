import { describe, expect, it } from 'vitest';
import type { SyncRecord } from '../core/models';
import { BACKUP_VERSION, buildBackup, mergeInto, parseBackup } from './backup';

const VALID: Record<string, Record<string, unknown>> = {
  books: { title: 'Dune', author: 'FH', driveFileId: 'd', fileName: 'd.pdf', sizeBytes: 10, sha256: 'x', pageCount: 3, outline: [{ key: '0', title: 'A', page: 1, children: [] }], language: 'en', direction: 'ltr', addedAt: 1, status: 'reading', categoryIds: ['c1'], tags: ['t'], progressMode: 'marked', pageMode: 'swipe', lastPageReached: 1 },
  categories: { name: 'Fiqh', order: 0 },
  upNext: { bookIds: ['b1'] },
  goals: { categoryId: null, measure: 'pages', target: 50 },
  settings: { defaultProgressMode: 'last-page', defaultPageMode: 'swipe', defaultView: 'page', readerTheme: 'paper', weekStartsOn: 6, reminders: { enabled: true, days: [1], time: '21:30' }, cardDirection: 'mixed' },
  annotations: { bookId: 'b1', type: 'highlight', page: 1, color: 'yellow', text: { page: 1, start: { item: 0, offset: 0 }, end: { item: 0, offset: 3 }, rects: [{ x: 0, y: 0, w: 1, h: 1 }], quote: 'q' }, tags: [], createdAt: 1 },
  positions: { bookId: 'b1', page: 1, offset: 0, zoom: 1, view: 'page' },
  readMarks: { bookId: 'b1', page: 1, read: true },
  sessions: { bookId: 'b1', startedAt: 1_700_000_000_000, endedAt: 1_700_000_060_000, activeMs: 60000, pagesRead: [1] },
};
const valid = (table: string, id = 'r1', updatedAt = 1): SyncRecord => rec(id, updatedAt, 'a', VALID[table]);
const BAD: Record<string, Record<string, unknown>> = {
  books: { categoryIds: 'c1' }, categories: { name: 5 }, upNext: { bookIds: [1] }, goals: { measure: 'money' }, settings: { reminders: { days: [9] } },
  annotations: { tags: undefined }, positions: { page: '1' }, readMarks: { read: 'yes' }, sessions: { pagesRead: 'x' },
};

function rec(id: string, updatedAt: number, deviceId = 'a', extra: Record<string, unknown> = {}): SyncRecord {
  return { id, updatedAt, deviceId, ...extra };
}

describe('buildBackup', () => {
  it('wraps tables with the version and time, keeping tombstones', () => {
    const tables = { books: [rec('b1', 1), rec('b2', 2, 'a', { deleted: true })], categories: [] };
    const out = buildBackup(tables, 1234);
    expect(out.schemaVersion).toBe(BACKUP_VERSION);
    expect(out.exportedAt).toBe(1234);
    expect(out.tables.books).toHaveLength(2);
    expect(out.tables.books![1].deleted).toBe(true);
  });
});

describe('parseBackup field validation', () => {
  it.each(Object.keys(BAD))('rejects the whole backup when one %s record has a bad field, naming table and index', (table) => {
    const tables = { books: [valid('books', 'ok')], [table]: [valid(table, 'good'), { ...valid(table, 'bad'), ...BAD[table] }] };
    expect(parseBackup(JSON.stringify({ schemaVersion: 1, tables }))).toEqual({ ok: false, error: 'bad-record', table, index: 1 });
  });

  it('rejects a missing required field, a bad optional field and a far-future updatedAt', () => {
    const { title: _t, ...noTitle } = VALID['books'];
    const cases = [rec('b', 1, 'a', noTitle), { ...valid('books'), rating: 'high' }, { ...valid('annotations'), color: 'red' }, { ...valid('annotations'), rect: { x: 1 } }, valid('books', 'b', Date.now() + 10 * 86_400_000), { ...valid('books'), sizeBytes: -1 }];
    for (const r of cases) {
      expect(parseBackup(JSON.stringify({ schemaVersion: 1, tables: { books: [r] } }))).toMatchObject({ ok: false, error: 'bad-record', table: 'books' });
    }
  });
});

describe('parseBackup', () => {
  it('round-trips with buildBackup', () => {
    const tables = Object.fromEntries(Object.keys(VALID).map((t) => [t, [valid(t)]]));
    const res = parseBackup(JSON.stringify(buildBackup(tables, 9)));
    expect(res).toEqual({ ok: true, tables });
  });

  it('rejects text that is not JSON', () => {
    expect(parseBackup('nope {')).toEqual({ ok: false, error: 'not-json' });
    expect(parseBackup('')).toEqual({ ok: false, error: 'not-json' });
  });

  it('rejects a wrong or missing schemaVersion', () => {
    expect(parseBackup(JSON.stringify({ schemaVersion: 2, tables: {} }))).toEqual({ ok: false, error: 'wrong-version' });
    expect(parseBackup(JSON.stringify({ tables: {} }))).toEqual({ ok: false, error: 'wrong-version' });
  });

  it('rejects the wrong shape', () => {
    const values = [null, 5, 'x', [], { schemaVersion: 1 }, { schemaVersion: 1, tables: [] }, { schemaVersion: 1, tables: null }, { schemaVersion: 1, tables: { books: {} } }];
    for (const value of values) expect(parseBackup(JSON.stringify(value))).toEqual({ ok: false, error: 'bad-shape' });
  });

  it('rejects records without a string id or numeric updatedAt', () => {
    const bad = [{ updatedAt: 1 }, { id: '', updatedAt: 1 }, { id: 5, updatedAt: 1 }, { id: 'a' }, { id: 'a', updatedAt: '1' }, { id: 'a', updatedAt: null }, null, 'x'];
    for (const r of bad) {
      expect(parseBackup(JSON.stringify({ schemaVersion: 1, tables: { books: [r] } }))).toMatchObject({ ok: false, error: 'bad-record' });
    }
  });

  it('rejects records the sync shards could not place', () => {
    expect(parseBackup(JSON.stringify({ schemaVersion: 1, tables: { annotations: [rec('n1', 1)] } }))).toMatchObject({ ok: false, error: 'bad-record' });
    expect(parseBackup(JSON.stringify({ schemaVersion: 1, tables: { sessions: [rec('s1', 1)] } }))).toMatchObject({ ok: false, error: 'bad-record' });
  });

  it('rejects text over 50 MB without parsing it', () => {
    expect(parseBackup('x'.repeat(50 * 1024 * 1024 + 1))).toEqual({ ok: false, error: 'too-large' });
  });

  it('ignores unknown tables', () => {
    const res = parseBackup(JSON.stringify({ schemaVersion: 1, tables: { books: [valid('books', 'b1')], evil: [{ nope: 1 }], __proto__: [rec('x', 1)] } }));
    expect(res).toEqual({ ok: true, tables: { books: [valid('books', 'b1')] } });
  });
});

describe('mergeInto', () => {
  it('keeps the newer of two records and records unique to either side', () => {
    const existing = [rec('a', 5, 'x', { v: 'local' }), rec('only-local', 1), rec('older', 1, 'x', { v: 'local' })];
    const incoming = [rec('a', 3, 'y', { v: 'backup' }), rec('only-backup', 2), rec('older', 9, 'y', { v: 'backup' })];
    const merged = mergeInto(existing, incoming);
    const byId = Object.fromEntries(merged.map((r) => [r.id, r]));
    expect(byId['a']['v']).toBe('local');
    expect(byId['older']['v']).toBe('backup');
    expect(Object.keys(byId).sort()).toEqual(['a', 'older', 'only-backup', 'only-local']);
  });

  it('breaks a tie with the higher deviceId', () => {
    expect(mergeInto([rec('a', 5, 'a', { v: 1 })], [rec('a', 5, 'b', { v: 2 })])[0]['v']).toBe(2);
    expect(mergeInto([rec('a', 5, 'b', { v: 1 })], [rec('a', 5, 'a', { v: 2 })])[0]['v']).toBe(1);
  });
});
