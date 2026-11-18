import { placeAtTop, visibleRange } from './virtualize';

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

describe('placeAtTop', () => {
  it('returns the page containing scrollTop and the fraction down it', () => {
    const r = placeAtTop({ scrollTop: 130, tops, heights });
    expect(r.index).toBe(1);
    expect(r.offset).toBeCloseTo(0.2, 5);
  });

  it('is the page top at offset 0', () => {
    expect(placeAtTop({ scrollTop: 110, tops, heights })).toEqual({ index: 1, offset: 0 });
  });

  it('uses the next page at offset 0 when scrollTop is in a gap', () => {
    expect(placeAtTop({ scrollTop: 105, tops, heights })).toEqual({ index: 1, offset: 0 });
  });

  it('clamps past the last page and for an empty list', () => {
    expect(placeAtTop({ scrollTop: 5000, tops, heights })).toEqual({ index: 9, offset: 1 });
    expect(placeAtTop({ scrollTop: 10, tops: [], heights: [] })).toEqual({ index: 0, offset: 0 });
  });

  it('round-trips: top + offset * height returns the scroll position (outside gaps) for mixed page heights', () => {
    const hs = Array.from({ length: 40 }, (_, i) => 60 + ((i * 37) % 300));
    const ts: number[] = [];
    let y = 0;
    for (const h of hs) {
      ts.push(y);
      y += h + 12;
    }
    let checked = 0;
    for (let s = 0; s < y - 12; s += 7.3) {
      const inGap = ts.some((t, i) => s >= t + hs[i] && s < (ts[i + 1] ?? Infinity));
      if (inGap) continue;
      const p = placeAtTop({ scrollTop: s, tops: ts, heights: hs });
      expect(Math.abs(ts[p.index] + p.offset * hs[p.index] - s)).toBeLessThan(1);
      checked++;
    }
    expect(checked).toBeGreaterThan(200);
  });
});
