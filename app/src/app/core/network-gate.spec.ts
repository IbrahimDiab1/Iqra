import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setDevicePref } from './device-prefs';
import { mayUseMobileData } from './network-gate';

function setConnection(type: string | undefined): void {
  Object.defineProperty(navigator, 'connection', { value: type === undefined ? undefined : { type }, configurable: true });
}

describe('mayUseMobileData', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => setConnection(undefined));

  it('is true when mobile data is allowed, even on cellular', () => {
    setConnection('cellular');
    expect(mayUseMobileData()).toBe(true);
  });

  it('is false only when the pref is off and the connection is cellular', () => {
    setDevicePref('syncOnMobile', false);
    setConnection('cellular');
    expect(mayUseMobileData()).toBe(false);
    setConnection('wifi');
    expect(mayUseMobileData()).toBe(true);
  });

  it('never blocks when the Network Information API is missing', () => {
    setDevicePref('syncOnMobile', false);
    setConnection(undefined);
    expect(mayUseMobileData()).toBe(true);
  });
});
