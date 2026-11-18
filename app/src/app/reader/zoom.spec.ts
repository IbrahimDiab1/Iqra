import { canvasScale, clampZoom, fitScale, pinchZoom, toggleFit, zoomIn, zoomOut } from './zoom';

describe('zoom', () => {
  it('zoomIn steps through page zoom levels', () => {
    expect(zoomIn(1, 'page')).toBe(1.25);
    expect(zoomIn(4, 'page')).toBe(4);
    expect(zoomIn(1.1, 'page')).toBe(1.25);
  });

  it('zoomOut steps through page zoom levels', () => {
    expect(zoomOut(1, 'page')).toBe(0.75);
    expect(zoomOut(0.5, 'page')).toBe(0.5);
  });

  it('reflow zoom moves in 0.1 steps', () => {
    expect(zoomIn(1, 'reflow')).toBe(1.1);
    expect(zoomOut(0.8, 'reflow')).toBe(0.8);
  });

  it('clampZoom returns 1 for a non-finite zoom', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(clampZoom(bad, 'page')).toBe(1);
      expect(clampZoom(bad, 'reflow')).toBe(1);
    }
  });

  it('clampZoom keeps page and reflow zoom in their ranges', () => {
    expect(clampZoom(0.1, 'page')).toBe(0.5);
    expect(clampZoom(9, 'page')).toBe(4);
    expect(clampZoom(0.1, 'reflow')).toBe(0.8);
    expect(clampZoom(9, 'reflow')).toBe(2);
  });

  it('toggleFit goes to 1 unless already fitting', () => {
    expect(toggleFit(1.5, 1.5)).toBe(1);
    expect(toggleFit(1, 1.5)).toBe(1.5);
    expect(toggleFit(1, 1)).toBe(2);
  });

  it('pinchZoom scales the start zoom by the distance ratio, clamped', () => {
    expect(pinchZoom(1, 100, 200)).toBe(2);
    expect(pinchZoom(1, 100, 1000)).toBe(4);
  });

  it('fitScale is container width over page width', () => {
    expect(fitScale(600, 300)).toBe(0.5);
  });

  it('canvasScale uses dpr capped at 2', () => {
    expect(canvasScale(1, 612, 792, 2)).toBe(2);
  });

  it('canvasScale keeps the canvas area within 16 million pixels', () => {
    const s = canvasScale(4, 2000, 3000, 2);
    expect(s).toBeGreaterThan(0);
    expect(2000 * s * (3000 * s)).toBeLessThanOrEqual(16_000_000);
  });
});
