import { IqraDb } from './db';
import { newId } from './ids';

describe('IqraDb connection health', () => {
  const dbs: IqraDb[] = [];
  const make = (reload = vi.fn()) => {
    const db = new IqraDb(`iqra-test-${newId()}`, { reload });
    dbs.push(db);
    return { db, reload };
  };
  afterEach(async () => {
    for (const db of dbs.splice(0)) await db.delete().catch(() => undefined);
  });

  it('closes its connection and reloads the page when another tab needs to upgrade the database', async () => {
    const { db, reload } = make();
    await db.open();
    db.on('versionchange').fire({ oldVersion: 1, newVersion: 2 } as IDBVersionChangeEvent);
    expect(db.isOpen()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reports that opening is blocked by another tab, and clears it once it opens', async () => {
    const { db } = make();
    expect(db.blocked()).toBe(false);
    db.on('blocked').fire({} as Event);
    expect(db.blocked()).toBe(true);
    await db.open();
    expect(db.blocked()).toBe(false);
  });
});
