import { Directive, ElementRef, HostListener, OnDestroy, inject, input, output } from '@angular/core';
import type { Rect } from '../core/models';

/** A drag smaller than this (px) in either dimension is not an area. */
const MIN_DRAG_PX = 12;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Drag a rectangle on a page box. While enabled, a drag shows a rubber band and ends by emitting the
 * rectangle as fractions of the box (0..1, y from the top). The box must be `position: relative`.
 */
@Directive({
  selector: '[iqraAreaTool]',
  host: {
    '[style.touch-action]': 'enabled() ? "none" : null',
    '[style.cursor]': 'enabled() ? "crosshair" : null',
  },
})
export class AreaToolDirective implements OnDestroy {
  readonly enabled = input(false);
  readonly page = input.required<number>();
  readonly areaDrawn = output<{ page: number; rect: Rect }>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private drag: { id: number; x: number; y: number } | undefined;
  private band: HTMLElement | undefined;

  @HostListener('pointerdown', ['$event'])
  protected down(e: PointerEvent): void {
    if (!this.enabled() || this.drag || e.isPrimary === false) return;
    const box = this.host.nativeElement.getBoundingClientRect();
    if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) return;
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    try {
      this.host.nativeElement.setPointerCapture?.(e.pointerId);
    } catch {
      // Capture is an optimisation; synthetic or already-released pointers can throw.
    }
    e.preventDefault();
  }

  @HostListener('pointermove', ['$event'])
  protected move(e: PointerEvent): void {
    if (!this.drag || e.pointerId !== this.drag.id) return;
    const r = this.pixels(e);
    const band = (this.band ??= this.makeBand());
    band.style.left = `${r.left}px`;
    band.style.top = `${r.top}px`;
    band.style.width = `${r.width}px`;
    band.style.height = `${r.height}px`;
  }

  @HostListener('pointerup', ['$event'])
  protected up(e: PointerEvent): void {
    if (!this.drag || e.pointerId !== this.drag.id) return;
    const r = this.pixels(e);
    const box = this.host.nativeElement.getBoundingClientRect();
    this.end();
    if (r.width <= MIN_DRAG_PX || r.height <= MIN_DRAG_PX || box.width <= 0 || box.height <= 0) return;
    this.areaDrawn.emit({
      page: this.page(),
      rect: { x: r.left / box.width, y: r.top / box.height, w: r.width / box.width, h: r.height / box.height },
    });
  }

  @HostListener('pointercancel', ['$event'])
  protected cancel(e: PointerEvent): void {
    if (this.drag && e.pointerId === this.drag.id) this.end();
  }

  ngOnDestroy(): void {
    this.end();
  }

  /** The drag as a box in pixels relative to the host, clamped to the host. */
  private pixels(e: PointerEvent): { left: number; top: number; width: number; height: number } {
    const box = this.host.nativeElement.getBoundingClientRect();
    const d = this.drag!;
    const x0 = clamp(d.x, box.left, box.right) - box.left;
    const y0 = clamp(d.y, box.top, box.bottom) - box.top;
    const x1 = clamp(e.clientX, box.left, box.right) - box.left;
    const y1 = clamp(e.clientY, box.top, box.bottom) - box.top;
    return { left: Math.min(x0, x1), top: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
  }

  private makeBand(): HTMLElement {
    const band = document.createElement('div');
    band.className = 'area-preview';
    band.style.cssText =
      'position:absolute;pointer-events:none;box-sizing:border-box;border:2px dashed var(--accent);background:var(--sel);border-radius:2px;';
    this.host.nativeElement.appendChild(band);
    return band;
  }

  private end(): void {
    const id = this.drag?.id;
    this.drag = undefined;
    this.band?.remove();
    this.band = undefined;
    if (id !== undefined) {
      try {
        this.host.nativeElement.releasePointerCapture?.(id);
      } catch {
        // Already released.
      }
    }
  }
}
