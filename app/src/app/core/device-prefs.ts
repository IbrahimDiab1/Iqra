const PREFIX = 'iqra.device.';

/** A per-device switch from localStorage, or `fallback` when it is unset, unreadable or blocked. */
export function getDevicePref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

/** Saves a per-device switch. Never synced. A blocked store is ignored. */
export function setDevicePref<T>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage can be blocked; the switch then lasts for this page load only.
  }
}
