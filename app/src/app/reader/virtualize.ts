/** Inclusive index range of pages to render. An empty range has last < first. */
export function visibleRange(o: {
  scrollTop: number;
  viewportH: number;
  tops: number[];
  heights: number[];
  overscanPx: number;
}): { first: number; last: number } {
  const n = o.tops.length;
  const winStart = o.scrollTop - o.overscanPx;
  const winEnd = o.scrollTop + o.viewportH + o.overscanPx;

  let first = n;
  let last = -1;
  for (let i = 0; i < n; i++) {
    const top = o.tops[i];
    const bottom = top + o.heights[i];
    if (bottom > winStart && first === n) first = i;
    if (top < winEnd) last = i;
  }
  return { first, last };
}

/**
 * The place at the reading line, which is the top of the viewport content: the page whose box contains
 * `scrollTop` and how far down it that is (0..1). In the gap between two pages it is the next page at offset 0.
 * `top + offset * height` of the result is the inverse (exact except inside a gap).
 */
export function placeAtTop(o: { scrollTop: number; tops: number[]; heights: number[] }): { index: number; offset: number } {
  const n = o.tops.length;
  if (n === 0) return { index: 0, offset: 0 };
  for (let i = 0; i < n; i++) {
    const bottom = o.tops[i] + o.heights[i];
    if (o.scrollTop < o.tops[i]) return { index: i, offset: 0 };
    if (o.scrollTop < bottom) {
      const height = o.heights[i] || 1;
      return { index: i, offset: Math.min(1, Math.max(0, (o.scrollTop - o.tops[i]) / height)) };
    }
  }
  return { index: n - 1, offset: 1 };
}
