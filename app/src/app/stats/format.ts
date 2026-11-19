const finite = (ms: number): number => (Number.isFinite(ms) && ms > 0 ? ms : 0);

/** '0 min', '45 min', '1 h 05 min'. Negative or non-finite input reads as 0. */
export function formatDuration(ms: number): string {
  const minutes = Math.floor(finite(ms) / 60_000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}

/** Average time per page as 'm:ss'; '0:00' when there is none. */
export function formatAvg(ms: number): string {
  const seconds = Math.round(finite(ms) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
