import { resolveSwipe } from './gestures';

const base = { dy: 10, dtMs: 300, width: 400, zoom: 1, rtl: false };

describe('resolveSwipe', () => {
  it('commits a long left swipe as next and a right swipe as prev', () => {
    expect(resolveSwipe({ ...base, dx: -120 })).toBe('next');
    expect(resolveSwipe({ ...base, dx: 120 })).toBe('prev');
  });

  it('swaps direction for rtl books', () => {
    expect(resolveSwipe({ ...base, dx: -120, rtl: true })).toBe('prev');
    expect(resolveSwipe({ ...base, dx: 120, rtl: true })).toBe('next');
  });

  it('stays when a slow swipe is short of 25 % of the width', () => {
    expect(resolveSwipe({ ...base, dx: -60 })).toBe('stay');
  });

  it('commits a fast swipe of at least 40 px', () => {
    expect(resolveSwipe({ ...base, dx: -50, dtMs: 50 })).toBe('next');
  });

  it('stays for a fast swipe shorter than 40 px', () => {
    expect(resolveSwipe({ ...base, dx: -30, dtMs: 20 })).toBe('stay');
  });

  it('stays when the gesture is mostly vertical', () => {
    expect(resolveSwipe({ ...base, dx: -200, dy: 300 })).toBe('stay');
  });

  it('stays when zoomed in beyond 1.05', () => {
    expect(resolveSwipe({ ...base, dx: -120, zoom: 1.5 })).toBe('stay');
  });
});
