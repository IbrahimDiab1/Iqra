import type { AuthApi } from './auth/auth.service';
import type { FakeCalendar } from './reminders/fake-calendar';
import type { FakeDrive } from './sync/fake-drive';
import type { SyncEngine } from './sync/sync-engine';

/** Handles that the e2e tests drive from outside the app. Only wired when FAKE_DRIVE is true. */
export interface E2eHandles {
  __iqraSync: SyncEngine;
  __iqraDrive: FakeDrive;
  /** The fake auth service: tests lapse the session with `markExpired()` to see the Reconnect bar. */
  __iqraAuth: AuthApi;
  /** Set by the lazy reminder service when it first runs. */
  __iqraCalendar: FakeCalendar;
}

export function exposeE2eHandles(handles: Partial<E2eHandles>): void {
  Object.assign(window, handles);
}
