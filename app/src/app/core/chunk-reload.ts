import { InjectionToken } from '@angular/core';

/** Called to restart the app on fresh code. Tests replace it. */
export const PAGE_RELOAD = new InjectionToken<() => void>('page-reload', {
  providedIn: 'root',
  factory: () => () => location.reload(),
});

const RELOAD_KEY = 'iqra.auto-reload-at';
/** A second automatic reload within this time is not done: a build that is really broken must not loop. */
export const RELOAD_GUARD_MS = 60_000;
const CHUNK_ERROR = /loading (css )?chunk|dynamically imported module|importing a module script failed|unable to preload css/i;

/**
 * A lazy route or chunk that failed to load. After a deploy the old chunk names are gone from the server (or cached
 * index.html points at them), so the import rejects; one reload fetches the new index and its chunks.
 */
export function isChunkLoadError(err: unknown): boolean {
  if (err === null || err === undefined) return false;
  const e = err as { name?: unknown; message?: unknown; rejection?: unknown };
  if (e.rejection !== undefined) return isChunkLoadError(e.rejection);
  if (e.name === 'ChunkLoadError') return true;
  const message = typeof e.message === 'string' ? e.message : typeof err === 'string' ? err : '';
  return CHUNK_ERROR.test(message);
}

/**
 * Reloads the page at most once per RELOAD_GUARD_MS (the time of the last automatic reload lives in sessionStorage).
 * Returns whether it reloaded.
 */
export function reloadOnce(now: number, reload: () => void): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY));
    if (Number.isFinite(last) && last > 0 && now - last < RELOAD_GUARD_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(now));
  } catch {
    // Without session storage there is no loop guard; a reload that does not fix it would loop, so do not reload.
    return false;
  }
  reload();
  return true;
}

/** Reloads once when a lazy chunk fails to load anywhere in the app (an `import()` outside the router). */
export function installChunkReload(now: () => number, reload: () => void): () => void {
  const onRejection = (e: PromiseRejectionEvent): void => {
    if (isChunkLoadError(e.reason)) reloadOnce(now(), reload);
  };
  const onError = (e: ErrorEvent): void => {
    if (isChunkLoadError(e.error ?? e.message)) reloadOnce(now(), reload);
  };
  window.addEventListener('unhandledrejection', onRejection);
  window.addEventListener('error', onError);
  return () => {
    window.removeEventListener('unhandledrejection', onRejection);
    window.removeEventListener('error', onError);
  };
}
