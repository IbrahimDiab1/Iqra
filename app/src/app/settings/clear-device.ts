import { InjectionToken } from '@angular/core';
import type { IqraDb } from '../core/db';

/** Keys kept when this device is cleared: the install id stamps records, so it must survive. */
const KEEP = new Set(['iqra.deviceId']);

/**
 * Removes this device's Iqra data: the local database (books, notes, downloaded PDFs, covers) and
 * every `iqra.*` setting except the device id. Never touches Drive. The database is deleted in one
 * step, so a failure leaves it whole.
 */
export type ClearDevice = (db: IqraDb) => Promise<void>;

/** Deletes an IndexedDB database. Resolves when it is gone; rejects when another tab keeps it open. */
function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('Could not delete the database'));
    req.onblocked = () => reject(new Error('Another tab is using the database'));
  });
}

export async function clearDevice(db: IqraDb): Promise<void> {
  const name = db.name;
  db.close();
  try {
    await deleteDatabase(name);
  } catch (error) {
    await db.open();
    throw error;
  }
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('iqra.') && !KEEP.has(key)) localStorage.removeItem(key);
    }
  } catch {
    // Blocked storage has nothing to clear.
  }
}

export const CLEAR_DEVICE = new InjectionToken<ClearDevice>('clearDevice', { providedIn: 'root', factory: () => clearDevice });

/** Loads a path with a full page load, so every service starts fresh. Tests replace it. */
export const FULL_RELOAD = new InjectionToken<(path: string) => void>('fullReload', {
  providedIn: 'root',
  factory: () => (path) => location.assign(path),
});
