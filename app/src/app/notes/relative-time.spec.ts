import { describe, expect, it } from 'vitest';
import { relativeTime } from './relative-time';

const NOW = 1_000_000_000_000;
describe('relativeTime', () => {
  it('says just now under a minute and for the future', () => {
    expect(relativeTime(NOW - 5_000, NOW, 'Just now', 'en')).toBe('Just now');
    expect(relativeTime(NOW + 5_000, NOW, 'Just now', 'en')).toBe('Just now');
  });
  it('picks the largest fitting unit', () => {
    expect(relativeTime(NOW - 5 * 60_000, NOW, 'x', 'en')).toBe('5 minutes ago');
    expect(relativeTime(NOW - 3 * 3_600_000, NOW, 'x', 'en')).toBe('3 hours ago');
    expect(relativeTime(NOW - 86_400_000, NOW, 'x', 'en')).toBe('yesterday');
    expect(relativeTime(NOW - 21 * 86_400_000, NOW, 'x', 'en')).toBe('3 weeks ago');
  });
});
