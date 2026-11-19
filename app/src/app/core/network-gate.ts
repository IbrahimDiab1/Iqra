import type { ToastService } from '../ui/toast.service';

let toldOnce = false;

/** False only when "Sync on mobile data" is off and the browser reports a cellular connection. */
export function mayUseMobileData(): boolean {
  try {
    // The device pref iqra.device.syncOnMobile (see device-prefs.ts).
    if (localStorage.getItem('iqra.device.syncOnMobile') !== 'false') return true;
  } catch {
    return true;
  }
  return (navigator as { connection?: { type?: string } }).connection?.type !== 'cellular';
}

/**
 * True when PDF transfers must wait for Wi-Fi, with a "Waiting for Wi-Fi" toast (every time, or once
 * per session with `once`). Callers load this module on demand so it stays out of the main bundle.
 */
export function blockedOnMobile(toast: ToastService, once: boolean): boolean {
  if (mayUseMobileData()) return false;
  if (!once || !toldOnce) {
    toldOnce = true;
    void import('../settings/settings-copy').then((m) => toast.show(m.SETTINGS_COPY.waitingForWifi));
  }
  return true;
}
