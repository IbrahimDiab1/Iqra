const DEVICE_ID_KEY = 'iqra.deviceId';

/** A new record id (UUID). */
export function newId(): string {
  return crypto.randomUUID();
}

/** The stable id of this install. Created once and kept in localStorage. */
export function getDeviceId(): string {
  const existing = localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = newId();
  localStorage.setItem(DEVICE_ID_KEY, id);
  return id;
}
