import { describe, expect, it } from 'vitest';
import { introDue } from './intro-due';

describe('introDue', () => {
  it('opens for a new user with no books', () => expect(introDue(undefined, 0, false)).toBe(true));
  it('is shown once: not after it was seen', () => expect(introDue(true, 0, false)).toBe(false));
  it('does not interrupt someone who already has books', () => expect(introDue(undefined, 3, false)).toBe(false));
  it('can be suppressed', () => expect(introDue(undefined, 0, true)).toBe(false));
});
