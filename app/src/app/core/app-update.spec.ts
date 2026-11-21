import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppUpdateService } from './app-update';
import { PAGE_RELOAD, RELOAD_GUARD_MS, installChunkReload, isChunkLoadError, reloadOnce } from './chunk-reload';
import { CLOCK } from './clock';

describe('isChunkLoadError', () => {
  it('recognises the ways a failed lazy chunk is reported', () => {
    expect(isChunkLoadError(Object.assign(new Error('x'), { name: 'ChunkLoadError' }))).toBe(true);
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/chunk-ABC.js'))).toBe(true);
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('Loading chunk 12 failed.'))).toBe(true);
    expect(isChunkLoadError('Loading CSS chunk 3 failed')).toBe(true);
    expect(isChunkLoadError({ rejection: new TypeError('Failed to fetch dynamically imported module') })).toBe(true);
  });

  it('ignores everything else', () => {
    expect(isChunkLoadError(new Error('Network down'))).toBe(false);
    expect(isChunkLoadError(new TypeError('Failed to fetch'))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});

describe('reloadOnce', () => {
  beforeEach(() => sessionStorage.clear());

  it('reloads the first time and not again within a minute, so a broken build cannot loop', () => {
    const reload = vi.fn();
    expect(reloadOnce(1_000_000, reload)).toBe(true);
    expect(reloadOnce(1_000_000 + RELOAD_GUARD_MS - 1, reload)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reloadOnce(1_000_000 + RELOAD_GUARD_MS, reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('does not reload when the guard cannot be stored', () => {
    const reload = vi.fn();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      expect(reloadOnce(5, reload)).toBe(false);
      expect(reload).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe('installChunkReload', () => {
  beforeEach(() => sessionStorage.clear());

  it('reloads once when a lazy chunk fails to load (unhandled rejection or error event)', () => {
    const reload = vi.fn();
    const stop = installChunkReload(() => 1_000_000, reload);
    try {
      const rejection = new Event('unhandledrejection') as Event & { reason: unknown };
      rejection.reason = new TypeError('Failed to fetch dynamically imported module: /chunk-1.js');
      window.dispatchEvent(rejection);
      expect(reload).toHaveBeenCalledTimes(1);

      window.dispatchEvent(new ErrorEvent('error', { message: 'Loading chunk 4 failed.' }));
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });

  it('does not reload for an ordinary error, and stops listening when stopped', () => {
    const reload = vi.fn();
    const stop = installChunkReload(() => 1_000_000, reload);
    window.dispatchEvent(new ErrorEvent('error', { message: 'boom', error: new Error('boom') }));
    expect(reload).not.toHaveBeenCalled();
    stop();
    window.dispatchEvent(new ErrorEvent('error', { message: 'Loading chunk 4 failed.' }));
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('AppUpdateService', () => {
  let reload: ReturnType<typeof vi.fn>;
  let now: number;
  let versions: Subject<{ type: string }>;
  let unrecoverable: Subject<unknown>;
  let sw: { isEnabled: boolean; versionUpdates: Subject<{ type: string }>; unrecoverable: Subject<unknown>; checkForUpdate: ReturnType<typeof vi.fn>; activateUpdate: ReturnType<typeof vi.fn> };
  let service: AppUpdateService;
  let router: Router;

  function setup(enabled = true): void {
    sessionStorage.clear();
    reload = vi.fn();
    now = 10_000_000;
    versions = new Subject();
    unrecoverable = new Subject();
    sw = {
      isEnabled: enabled,
      versionUpdates: versions,
      unrecoverable,
      checkForUpdate: vi.fn().mockResolvedValue(false),
      activateUpdate: vi.fn().mockResolvedValue(true),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: SwUpdate, useValue: sw },
        { provide: PAGE_RELOAD, useValue: reload },
        { provide: CLOCK, useValue: { now: () => now } },
      ],
    });
    router = TestBed.inject(Router);
    service = TestBed.inject(AppUpdateService);
    service.start();
  }

  afterEach(() => {
    service?.ngOnDestroy();
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  function show(visible: boolean): void {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(visible ? 'visible' : 'hidden');
    document.dispatchEvent(new Event('visibilitychange'));
  }

  it('checks for a new version on start and each time the app comes back to the front', () => {
    setup();
    expect(sw.checkForUpdate).toHaveBeenCalledTimes(1);
    now += 40_000;
    show(true);
    expect(sw.checkForUpdate).toHaveBeenCalledTimes(2);
    // Not again right away, and not while hidden.
    show(true);
    expect(sw.checkForUpdate).toHaveBeenCalledTimes(2);
    now += 40_000;
    show(false);
    expect(sw.checkForUpdate).toHaveBeenCalledTimes(2);
  });

  it('activates a ready version and restarts into it at the next page change', async () => {
    setup();
    await router.navigateByUrl('/library');
    versions.next({ type: 'VERSION_READY' });
    await vi.waitFor(() => expect(sw.activateUpdate).toHaveBeenCalled());
    // The activation itself already counts as a quiet moment on the Library.
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it('waits while a book is open and restarts when the reader is left', async () => {
    setup();
    await router.navigateByUrl('/read/b1');
    versions.next({ type: 'VERSION_READY' });
    await vi.waitFor(() => expect(sw.activateUpdate).toHaveBeenCalled());
    await Promise.resolve();
    expect(reload).not.toHaveBeenCalled();
    show(true);
    expect(reload).not.toHaveBeenCalled();
    await router.navigateByUrl('/library');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('ignores other version events', async () => {
    setup();
    versions.next({ type: 'VERSION_DETECTED' });
    versions.next({ type: 'VERSION_INSTALLATION_FAILED' });
    await Promise.resolve();
    expect(sw.activateUpdate).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads once when the service worker is in an unrecoverable state', () => {
    setup();
    unrecoverable.next({ reason: 'hash mismatch' });
    unrecoverable.next({ reason: 'hash mismatch' });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('with the service worker off (dev, e2e) nothing is checked or activated', () => {
    setup(false);
    expect(sw.checkForUpdate).not.toHaveBeenCalled();
    versions.next({ type: 'VERSION_READY' });
    expect(sw.activateUpdate).not.toHaveBeenCalled();
  });
});
