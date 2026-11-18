export const PAGE_ZOOM = { min: 0.5, max: 4, steps: [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] } as const;
export const TEXT_ZOOM = { min: 0.8, max: 2, step: 0.1 } as const;

const MAX_CANVAS_AREA = 16_000_000;

type View = 'page' | 'reflow';

function round1(z: number): number {
  return Math.round(z * 10) / 10;
}

export function clampZoom(z: number, view: View): number {
  const range = view === 'page' ? PAGE_ZOOM : TEXT_ZOOM;
  return Math.min(range.max, Math.max(range.min, z));
}

export function zoomIn(z: number, view: View): number {
  if (view === 'page') {
    return PAGE_ZOOM.steps.find((s) => s > z) ?? PAGE_ZOOM.max;
  }
  return clampZoom(round1(z + TEXT_ZOOM.step), 'reflow');
}

export function zoomOut(z: number, view: View): number {
  if (view === 'page') {
    const below = PAGE_ZOOM.steps.filter((s) => s < z);
    return below.length > 0 ? below[below.length - 1] : PAGE_ZOOM.min;
  }
  return clampZoom(round1(z - TEXT_ZOOM.step), 'reflow');
}

/** Toggles fit-to-width: fitting zooms to the last custom zoom (or 2 if none), anything else fits. */
export function toggleFit(current: number, lastCustom: number): number {
  if (Math.abs(current - 1) > 0.01) return 1;
  return lastCustom > 1.05 ? lastCustom : 2;
}

export function pinchZoom(startZoom: number, startDist: number, curDist: number): number {
  return clampZoom((startZoom * curDist) / startDist, 'page');
}

/** Scale that makes a page of `pageWidthPt` points exactly `containerWidthPx` wide. */
export function fitScale(pageWidthPt: number, containerWidthPx: number): number {
  return containerWidthPx / pageWidthPt;
}

/**
 * Canvas pixels per page point: the CSS scale times the device pixel ratio (capped at 2),
 * reduced until the canvas area is at most 16 million pixels.
 */
export function canvasScale(cssScale: number, pageWpt: number, pageHpt: number, dpr: number): number {
  let s = cssScale * Math.min(dpr, 2);
  const area = pageWpt * s * (pageHpt * s);
  if (area > MAX_CANVAS_AREA) {
    s *= Math.sqrt(MAX_CANVAS_AREA / area);
    // Guard against floating-point overshoot.
    while (pageWpt * s * (pageHpt * s) > MAX_CANVAS_AREA) s *= 0.9999;
  }
  return s;
}
