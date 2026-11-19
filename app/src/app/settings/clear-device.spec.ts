import { beforeEach, describe, expect, it } from 'vitest';
import { IqraDb } from '../core/db';
import { newId } from '../core/ids';
import { clearDevice } from './clear-device';

describe('clearDevice', () => {
  beforeEach(() => localStorage.clear());

  it('deletes the database and iqra.* keys but keeps the device id and other sites keys', async () => {
    const name = `iqra-test-${newId()}`;
    const db = new IqraDb(name);
    await db.books.put({ id: 'b' } as never);
    localStorage.setItem('iqra.deviceId', 'dev-1');
    localStorage.setItem('iqra.library', '{}');
    localStorage.setItem('iqra.device.syncOnMobile', 'false');
    localStorage.setItem('other', 'keep');
    await clearDevice(db);
    expect(db.isOpen()).toBe(false);
    expect(await (await import('dexie')).default.exists(name)).toBe(false);
    expect(localStorage.getItem('iqra.deviceId')).toBe('dev-1');
    expect(localStorage.getItem('other')).toBe('keep');
    expect(localStorage.getItem('iqra.library')).toBeNull();
    expect(localStorage.getItem('iqra.device.syncOnMobile')).toBeNull();
  });
});
