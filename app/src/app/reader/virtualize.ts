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

/** The page covering the viewport centre, and the scroll position within it (0..1). */
export function currentPageAt(o: {
  scrollTop: number;
  viewportH: number;
  tops: number[];
  heights: number[];
}): { index: number; offset: number } {
  const centre = o.scrollTop + o.viewportH / 2;
  let index = 0;
  for (let i = 0; i < o.tops.length; i++) {
    if (o.tops[i] <= centre) index = i;
  }
  const top = o.tops[index] ?? 0;
  const height = o.heights[index] || 1;
  const offset = Math.min(1, Math.max(0, (o.scrollTop - top) / height));
  return { index, offset };
}
