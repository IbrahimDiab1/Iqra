import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDevicePref, setDevicePref } from './device-prefs';

describe('device prefs', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('returns the fallback when the key is unset', () => {
    expect(getDevicePref('syncOnMobile', true)).toBe(true);
  });

  it('stores values under the iqra.device. prefix and reads them back', () => {
    setDevicePref('syncOnMobile', false);
    expect(localStorage.getItem('iqra.device.syncOnMobile')).toBe('false');
    expect(getDevicePref('syncOnMobile', true)).toBe(false);
  });

  it('falls back when the stored value is not valid JSON', () => {
    localStorage.setItem('iqra.device.x', '{oops');
    expect(getDevicePref('x', 7)).toBe(7);
  });

  it('survives localStorage throwing on read and write', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(getDevicePref('k', 'fb')).toBe('fb');
    expect(() => setDevicePref('k', 1)).not.toThrow();
  });
});
