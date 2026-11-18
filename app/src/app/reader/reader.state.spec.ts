import { describe, expect, it, vi } from 'vitest';
import type { Book } from '../core/models';
import type { PositionService } from './position.service';
import { ReaderState } from './reader.state';

const book = { id: 'b1', pageCount: 100 } as Book;

function setup(flushResult: Promise<void> = Promise.resolve()) {
  const positions = { schedule: vi.fn(), flush: vi.fn(() => flushResult) };
  const state = new ReaderState(book, positions as unknown as PositionService);
  state.init({ place: { page: 5, offset: 0.25 }, zoom: 1, view: 'page', fromOtherDevice: false });
  positions.schedule.mockClear();
  return { state, positions };
}

describe('ReaderState', () => {
  it('opens at the restored place', () => {
    const { state } = setup();
    expect(state.page()).toBe(5);
    expect(state.offset()).toBe(0.25);
    expect(state.chrome()).toBe(true);
  });

  it('a plain page change does not touch history but schedules a save', () => {
    const { state, positions } = setup();
    state.pageChange(6);
    expect(state.page()).toBe(6);
    expect(state.canBack()).toBe(false);
    expect(positions.schedule).toHaveBeenCalledWith(book, { page: 6, offset: 0, zoom: 1, view: 'page' });
  });

  it('re-reporting the restored place (the scroller does on mount) saves nothing; a real change saves once', () => {
    const { state, positions } = setup();
    state.placeChange({ page: 5, offset: 0.251 });
    state.setZoom(1);
    expect(positions.schedule).not.toHaveBeenCalled();
    state.placeChange({ page: 5, offset: 0.4 });
    expect(positions.schedule).toHaveBeenCalledTimes(1);
    state.placeChange({ page: 5, offset: 0.4 });
    expect(positions.schedule).toHaveBeenCalledTimes(1);
  });

  it('a jump pushes history; back and forward walk it', () => {
    const { state } = setup();
    state.jumpTo({ page: 40, offset: 0 });
    expect(state.page()).toBe(40);
    expect(state.canBack()).toBe(true);
    expect(state.canForward()).toBe(false);
    expect(state.historyBack()).toEqual({ page: 5, offset: 0.25 });
    expect(state.page()).toBe(5);
    expect(state.canForward()).toBe(true);
    expect(state.historyForward()).toEqual({ page: 40, offset: 0 });
    expect(state.page()).toBe(40);
  });

  it('keeps separate zoom values for page view and reading mode', () => {
    const { state } = setup();
    state.setZoom(2);
    state.setView('reflow');
    expect(state.zoom()).toBe(1);
    state.setZoom(1.4);
    state.setView('page');
    expect(state.zoom()).toBe(2);
    expect(state.lastCustomZoom()).toBe(2);
  });

  it('clamps zoom to the range of the view', () => {
    const { state } = setup();
    state.setZoom(9);
    expect(state.zoom()).toBe(4);
  });

  it('ignores a chrome tap that follows another within 350 ms', () => {
    const { state } = setup();
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    state.toggleChrome();
    expect(state.chrome()).toBe(false);
    now += 200;
    state.toggleChrome();
    expect(state.chrome()).toBe(false);
    now += 400;
    state.toggleChrome();
    expect(state.chrome()).toBe(true);
    vi.restoreAllMocks();
  });

  it('warns instead of rejecting when a flush fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { state } = setup(Promise.reject(new Error('disk')));
    await expect(state.flush()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('flashAnnotation sets the id and clears it after 1200 ms', () => {
    vi.useFakeTimers();
    try {
      const { state } = setup();
      state.flashAnnotation('a1');
      expect(state.flash()).toBe('a1');
      vi.advanceTimersByTime(1199);
      expect(state.flash()).toBe('a1');
      vi.advanceTimersByTime(2);
      expect(state.flash()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
