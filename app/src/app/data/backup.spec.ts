import { describe, expect, it } from 'vitest';
import type { SyncRecord } from '../core/models';
import { BACKUP_VERSION, buildBackup, mergeInto, parseBackup } from './backup';

const rec = (id: string, updatedAt: number, deviceId = 'a', extra: Record<string, unknown> = {}): SyncRecord => ({ id, updatedAt, deviceId, ...extra });

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

describe('parseBackup', () => {
  it('round-trips with buildBackup', () => {
    const tables = { books: [rec('b1', 1, 'a', { title: 'Dune' })], annotations: [rec('n1', 5, 'a', { bookId: 'b1' })], sessions: [rec('s1', 5, 'a', { startedAt: 1_700_000_000_000 })] };
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
      expect(parseBackup(JSON.stringify({ schemaVersion: 1, tables: { books: [r] } }))).toEqual({ ok: false, error: 'bad-shape' });
    }
  });

  it('rejects records the sync shards could not place', () => {
    expect(parseBackup(JSON.stringify({ schemaVersion: 1, tables: { annotations: [rec('n1', 1)] } }))).toEqual({ ok: false, error: 'bad-shape' });
    expect(parseBackup(JSON.stringify({ schemaVersion: 1, tables: { sessions: [rec('s1', 1)] } }))).toEqual({ ok: false, error: 'bad-shape' });
  });

  it('rejects text over 50 MB without parsing it', () => {
    expect(parseBackup('x'.repeat(50 * 1024 * 1024 + 1))).toEqual({ ok: false, error: 'too-large' });
  });

  it('ignores unknown tables', () => {
    const res = parseBackup(JSON.stringify({ schemaVersion: 1, tables: { books: [rec('b1', 1)], evil: [{ nope: 1 }], __proto__: [rec('x', 1)] } }));
    expect(res).toEqual({ ok: true, tables: { books: [rec('b1', 1)] } });
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
