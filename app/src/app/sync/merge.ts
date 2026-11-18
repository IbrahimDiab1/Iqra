import { Book, ID, SyncMeta, SyncRecord } from '../core/models';

const DEFAULT_TOMBSTONE_AGE_MS = 90 * 864e5;

/** True when record `a` beats record `b`: later updatedAt, or equal and higher deviceId. */
export function wins(a: SyncMeta, b: SyncMeta): boolean {
  return a.updatedAt > b.updatedAt || (a.updatedAt === b.updatedAt && a.deviceId > b.deviceId);
}

/**
 * Merges one table's local and remote records by id, last-writer-wins.
 * toLocal: remote records that win, or that are missing locally.
 * needsPush: a local record wins, or is missing remotely.
 * merged: the winning set.
 */
export function mergeTable(
  local: SyncRecord[],
  remote: SyncRecord[],
): { toLocal: SyncRecord[]; needsPush: boolean; merged: SyncRecord[] } {
  const localById = new Map<ID, SyncRecord>(local.map((r) => [r.id, r]));
  const remoteById = new Map<ID, SyncRecord>(remote.map((r) => [r.id, r]));
  const toLocal: SyncRecord[] = [];
  const merged: SyncRecord[] = [];
  let needsPush = false;

  for (const [id, localRec] of localById) {
    const remoteRec = remoteById.get(id);
    if (!remoteRec) {
      needsPush = true;
      merged.push(localRec);
    } else if (wins(remoteRec, localRec)) {
      toLocal.push(remoteRec);
      merged.push(remoteRec);
    } else {
      if (wins(localRec, remoteRec)) needsPush = true;
      merged.push(localRec);
    }
  }

  for (const [id, remoteRec] of remoteById) {
    if (!localById.has(id)) {
      toLocal.push(remoteRec);
      merged.push(remoteRec);
    }
  }

  return { toLocal, needsPush, merged };
}

/** Drops tombstones older than maxAgeMs. Live records are always kept. */
export function pruneTombstones(
  recs: SyncRecord[],
  now: number,
  maxAgeMs = DEFAULT_TOMBSTONE_AGE_MS,
): SyncRecord[] {
  return recs.filter((r) => !r.deleted || now - r.updatedAt <= maxAgeMs);
}

/**
 * Among live books with the same sha256, keeps the earliest addedAt (ties: lower id) and reports
 * each other book as a drop. The rule uses only immutable fields, so every device picks the same
 * book whatever its upload state.
 */
export function duplicateBooks(books: Book[]): { keep: ID; drop: ID }[] {
  const groups = new Map<string, Book[]>();
  for (const book of books) {
    if (book.deleted) continue;
    const group = groups.get(book.sha256);
    if (group) group.push(book);
    else groups.set(book.sha256, [book]);
  }

  const pairs: { keep: ID; drop: ID }[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => a.addedAt - b.addedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const [keep, ...rest] = group;
    for (const drop of rest) pairs.push({ keep: keep.id, drop: drop.id });
  }
  return pairs;
}
