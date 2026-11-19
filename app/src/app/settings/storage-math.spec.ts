import { describe, expect, it } from 'vitest';
import { deviceSegments, driveSegments, formatBytes } from './storage-math';

const by = (segs: { label: string; bytes: number; fraction: number }[], label: string) => segs.find((s) => s.label === label)!;

describe('driveSegments', () => {
  it('splits a finite quota into books, other and free', () => {
    const segs = driveSegments({ limit: 100, usage: 40 }, 10);
    expect(segs.map((s) => s.label)).toEqual(['books', 'other', 'free']);
    expect(by(segs, 'books')).toMatchObject({ bytes: 10, fraction: 0.1 });
    expect(by(segs, 'other')).toMatchObject({ bytes: 30, fraction: 0.3 });
    expect(by(segs, 'free')).toMatchObject({ bytes: 60, fraction: 0.6 });
  });

  it('has no free segment for unlimited storage and fractions sum to 1', () => {
    const segs = driveSegments({ limit: Infinity, usage: 40 }, 10);
    expect(segs.some((s) => s.label === 'free')).toBe(false);
    expect(segs.reduce((n, s) => n + s.fraction, 0)).toBeCloseTo(1);
    const noLimit = driveSegments({ limit: NaN, usage: 40 }, 10);
    expect(noLimit.some((s) => s.label === 'free')).toBe(false);
  });

  it('clamps books to usage', () => {
    const segs = driveSegments({ limit: 100, usage: 40 }, 90);
    expect(by(segs, 'books').bytes).toBe(40);
    expect(by(segs, 'other').bytes).toBe(0);
  });

  it('never exceeds 100 percent when usage is over the limit', () => {
    const segs = driveSegments({ limit: 100, usage: 150 }, 10);
    expect(segs.reduce((n, s) => n + s.fraction, 0)).toBeLessThanOrEqual(1 + 1e-9);
    expect(segs.every((s) => s.bytes >= 0 && s.fraction >= 0)).toBe(true);
  });

  it('returns nothing when there is nothing to show', () => {
    expect(driveSegments({ limit: 0, usage: 0 }, 0)).toEqual([]);
    expect(driveSegments({ limit: Infinity, usage: 0 }, 0)).toEqual([]);
  });

  it('copes with negative or NaN inputs', () => {
    const segs = driveSegments({ limit: 100, usage: NaN }, -5);
    expect(segs.every((s) => Number.isFinite(s.fraction) && s.bytes >= 0)).toBe(true);
  });
});

describe('deviceSegments', () => {
  it('shows only downloads when the estimate is unavailable', () => {
    const segs = deviceSegments(null, 5e6);
    expect(segs).toEqual([{ label: 'downloads', bytes: 5e6, fraction: 1 }]);
  });

  it('is empty with no estimate and no downloads', () => {
    expect(deviceSegments(null, 0)).toEqual([]);
  });

  it('puts the rest of the usage into one data segment', () => {
    const segs = deviceSegments({ usage: 50, quota: 200 }, 20);
    expect(segs.map((s) => s.label)).toEqual(['downloads', 'data']);
    expect(by(segs, 'downloads')).toMatchObject({ bytes: 20, fraction: 0.1 });
    expect(by(segs, 'data')).toMatchObject({ bytes: 30, fraction: 0.15 });
  });

  it('clamps downloads to usage and keeps fractions within 0..1', () => {
    const segs = deviceSegments({ usage: 10, quota: 5 }, 40);
    expect(by(segs, 'downloads').bytes).toBe(10);
    expect(segs.reduce((n, s) => n + s.fraction, 0)).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('uses usage as the whole when quota is missing', () => {
    const segs = deviceSegments({ usage: 40 }, 10);
    expect(segs.reduce((n, s) => n + s.fraction, 0)).toBeCloseTo(1);
  });
});

describe('formatBytes', () => {
  it('formats sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1_468_006)).toBe('1.4 MB');
    expect(formatBytes(12 * 1024 ** 3)).toBe('12 GB');
    expect(formatBytes(1024)).toBe('1 KB');
  });

  it('treats negative, NaN and infinite as zero', () => {
    expect(formatBytes(-1)).toBe('0 B');
    expect(formatBytes(NaN)).toBe('0 B');
    expect(formatBytes(Infinity)).toBe('0 B');
  });

  it('does not show 1024 of a unit', () => {
    expect(formatBytes(1024 * 1024 - 1)).toBe('1 MB');
  });
});
