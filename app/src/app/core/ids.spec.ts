import { getDeviceId, newId } from './ids';

describe('getDeviceId', () => {
  beforeEach(() => localStorage.clear());

  it('returns the same value on every call', () => {
    const first = getDeviceId();
    expect(getDeviceId()).toBe(first);
  });

  it('returns a new value after localStorage is cleared', () => {
    const first = getDeviceId();
    localStorage.clear();
    expect(getDeviceId()).not.toBe(first);
  });

  it('stores the id under iqra.deviceId', () => {
    const id = getDeviceId();
    expect(localStorage.getItem('iqra.deviceId')).toBe(id);
  });
});

describe('newId', () => {
  it('returns a UUID string', () => {
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('returns a different id on each call', () => {
    expect(newId()).not.toBe(newId());
  });
});
