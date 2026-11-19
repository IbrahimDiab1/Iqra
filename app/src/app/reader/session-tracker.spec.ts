import { describe, expect, it } from 'vitest';
import { IDLE_END_MS, IDLE_PAUSE_MS, PAGE_COUNT_MS, SessionTracker } from './session-tracker';

describe('SessionTracker', () => {
  it('counts a page that was current for 5 s of active time, not one held for 4 s', () => {
    const t = new SessionTracker(0, 1);
    t.pageChanged(10_000, 2); // page 1 for 10 s
    t.pageChanged(14_000, 3); // page 2 for 4 s
    const s = t.snapshot(14_000);
    expect(s.pagesRead).toEqual([1]);
    expect(PAGE_COUNT_MS).toBe(5_000);
  });

  it('counts the current page as soon as it reaches 5 s, without a page change', () => {
    const t = new SessionTracker(0, 4);
    t.activity(3_000);
    t.activity(6_000);
    expect(t.snapshot(6_000).pagesRead).toEqual([4]);
  });

  it('adds only 2 minutes after 3 minutes without activity', () => {
    const t = new SessionTracker(0, 1);
    t.tick(180_000);
    expect(t.snapshot(180_000).activeMs).toBe(IDLE_PAUSE_MS);
  });

  it('resumes counting on activity after the pause', () => {
    const t = new SessionTracker(0, 1);
    t.tick(180_000); // paused at 120 s
    t.activity(180_000);
    t.activity(190_000);
    expect(t.snapshot(190_000).activeMs).toBe(IDLE_PAUSE_MS + 10_000);
  });

  it('ends after 30 minutes idle', () => {
    const t = new SessionTracker(0, 1);
    expect(t.tick(IDLE_END_MS - 1).ended).toBe(false);
    expect(t.tick(IDLE_END_MS + 1_000).ended).toBe(true);
  });

  it('adds nothing when the clock moves backwards', () => {
    const t = new SessionTracker(100_000, 1);
    t.activity(110_000);
    t.activity(50_000);
    const s = t.snapshot(40_000);
    expect(s.activeMs).toBe(10_000);
    expect(s.endedAt).toBeGreaterThanOrEqual(s.startedAt);
    t.activity(120_000);
    expect(t.snapshot(120_000).activeMs).toBe(20_000);
  });

  it('does not list a revisited page twice and accumulates time across visits', () => {
    const t = new SessionTracker(0, 1);
    t.pageChanged(6_000, 2); // p1 counted
    t.pageChanged(12_000, 1); // p2 counted
    t.pageChanged(18_000, 2); // p1 again
    const s = t.snapshot(18_000);
    expect(s.pagesRead).toEqual([1, 2]);
  });

  it('end returns the final snapshot', () => {
    const t = new SessionTracker(1_000, 1);
    t.activity(9_000);
    const s = t.end(9_000);
    expect(s).toEqual({ startedAt: 1_000, endedAt: 9_000, activeMs: 8_000, pagesRead: [1] });
  });

  it('endedAt never runs past the last activity plus the idle pause', () => {
    const t = new SessionTracker(0, 1);
    t.activity(10_000);
    expect(t.snapshot(10_000 + 30 * 60_000).endedAt).toBe(10_000 + 120_000);
  });
});
