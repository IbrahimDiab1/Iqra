/** After this long without activity the active clock pauses. */
export const IDLE_PAUSE_MS = 120_000;
/** After this long without activity the session is over. */
export const IDLE_END_MS = 1_800_000;
/** A page counts as read after this much active time as the current page. */
export const PAGE_COUNT_MS = 5_000;

export interface SessionSnapshot {
  startedAt: number;
  endedAt: number;
  activeMs: number;
  pagesRead: number[];
}

/**
 * Turns reader activity into active time and counted pages. Pure: time is always passed in.
 * A `now` that goes backwards is clamped to the latest time seen, so time never decreases.
 */
export class SessionTracker {
  private readonly startedAt: number;
  private last: number;
  private lastActivity: number;
  private activeMs = 0;
  private page: number;
  private readonly pageMs = new Map<number, number>();
  private readonly read = new Set<number>();

  constructor(now: number, page: number) {
    this.startedAt = now;
    this.last = now;
    this.lastActivity = now;
    this.page = page;
  }

  activity(now: number): void {
    this.advance(now);
    this.lastActivity = this.last;
  }

  pageChanged(now: number, page: number): void {
    this.advance(now);
    this.lastActivity = this.last;
    this.page = page;
  }

  tick(now: number): { ended: boolean } {
    this.advance(now);
    return { ended: this.last - this.lastActivity >= IDLE_END_MS };
  }

  snapshot(now: number): SessionSnapshot {
    this.advance(now);
    return { startedAt: this.startedAt, endedAt: this.last, activeMs: this.activeMs, pagesRead: [...this.read] };
  }

  end(now: number): SessionSnapshot {
    return this.snapshot(now);
  }

  /** Moves the clock to `now` and books the active part of the elapsed time on the current page. */
  private advance(now: number): void {
    const to = Math.max(now, this.last);
    const activeUntil = Math.min(to, this.lastActivity + IDLE_PAUSE_MS);
    const delta = Math.max(0, activeUntil - this.last);
    this.last = to;
    if (delta === 0) return;
    this.activeMs += delta;
    const onPage = (this.pageMs.get(this.page) ?? 0) + delta;
    this.pageMs.set(this.page, onPage);
    if (onPage >= PAGE_COUNT_MS) this.read.add(this.page);
  }
}
