import { currentPageAt, visibleRange } from './virtualize';

// 10 pages, each 100 tall, 10 px apart.
const tops = Array.from({ length: 10 }, (_, i) => i * 110);
const heights = Array.from({ length: 10 }, () => 100);

describe('visibleRange', () => {
  it('returns the pages intersecting the viewport', () => {
    expect(visibleRange({ scrollTop: 0, viewportH: 250, tops, heights, overscanPx: 0 })).toEqual({ first: 0, last: 2 });
  });

  it('starts at the first page visible below scrollTop 550', () => {
    // Page 4 spans 440-540 and ends above 550; page 5 spans 550-650; window ends at 800.
    expect(visibleRange({ scrollTop: 550, viewportH: 250, tops, heights, overscanPx: 0 })).toEqual({ first: 5, last: 7 });
  });

  it('extends the range by overscanPx on both sides', () => {
    expect(visibleRange({ scrollTop: 550, viewportH: 250, tops, heights, overscanPx: 120 })).toEqual({ first: 4, last: 8 });
  });
});

describe('currentPageAt', () => {
  it('returns the page covering the viewport centre, with offset clamped to 0', () => {
    expect(currentPageAt({ scrollTop: 100, viewportH: 200, tops, heights })).toEqual({ index: 1, offset: 0 });
  });

  it('returns the in-page offset when scrolled into a page', () => {
    // Centre at 160 lies in page 1 (110-210); (130 - 110) / 100 = 0.2.
    const r = currentPageAt({ scrollTop: 130, viewportH: 60, tops, heights });
    expect(r.index).toBe(1);
    expect(r.offset).toBeCloseTo(0.2, 5);
  });
});
