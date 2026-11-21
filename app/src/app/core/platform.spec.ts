import { afterEach, describe, expect, it } from 'vitest';
import { isNativeApp } from './platform';

const g = globalThis as { Capacitor?: unknown };

describe('isNativeApp', () => {
  afterEach(() => delete g.Capacitor);

  it('is false in a plain browser (no Capacitor)', () => {
    expect(isNativeApp()).toBe(false);
  });

  it('is false when Capacitor runs on the web', () => {
    g.Capacitor = { isNativePlatform: () => false };
    expect(isNativeApp()).toBe(false);
  });

  it('is true inside the native shell', () => {
    g.Capacitor = { isNativePlatform: () => true };
    expect(isNativeApp()).toBe(true);
  });

  it('is false when the check throws', () => {
    g.Capacitor = {
      isNativePlatform: () => {
        throw new Error('boom');
      },
    };
    expect(isNativeApp()).toBe(false);
  });
});
