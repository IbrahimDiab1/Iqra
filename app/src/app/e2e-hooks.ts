import type { FakeDrive } from './sync/fake-drive';
import type { SyncEngine } from './sync/sync-engine';

/** Handles that the e2e tests drive from outside the app. Only wired when FAKE_DRIVE is true. */
export interface E2eHandles {
  __iqraSync: SyncEngine;
  __iqraDrive: FakeDrive;
}

export function exposeE2eHandles(handles: E2eHandles): void {
  Object.assign(window, handles);
}
