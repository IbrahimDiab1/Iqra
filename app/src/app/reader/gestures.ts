export type SwipeResult = 'next' | 'prev' | 'stay';

const MIN_DISTANCE_FRACTION = 0.25;
const FAST_VELOCITY_PX_PER_MS = 0.5;
const FAST_MIN_DISTANCE_PX = 40;
const MAX_SWIPE_ZOOM = 1.05;

/** Decides what a horizontal swipe does. Swipes are ignored when zoomed in or mostly vertical. */
export function resolveSwipe(o: {
  dx: number;
  dy: number;
  dtMs: number;
  width: number;
  zoom: number;
  rtl: boolean;
}): SwipeResult {
  if (o.zoom > MAX_SWIPE_ZOOM) return 'stay';
  if (Math.abs(o.dy) > Math.abs(o.dx)) return 'stay';

  const dist = Math.abs(o.dx);
  const velocity = dist / Math.max(1, o.dtMs);
  const committed =
    dist >= MIN_DISTANCE_FRACTION * o.width ||
    (velocity >= FAST_VELOCITY_PX_PER_MS && dist >= FAST_MIN_DISTANCE_PX);
  if (!committed) return 'stay';

  // A left swipe moves forward in a left-to-right book, backward in a right-to-left one.
  const forward = o.dx < 0;
  return forward !== o.rtl ? 'next' : 'prev';
}
