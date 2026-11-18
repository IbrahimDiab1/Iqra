import { Directive, HostListener, OnDestroy, input, output } from '@angular/core';
import { isReaderKeyIgnored } from './keys';
import { pinchZoom, toggleFit, zoomIn, zoomOut } from './zoom';

const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 30;
const TAP_MAX_MOVE_PX = 6;

type View = 'page' | 'reflow';

/** Pinch, ctrl+wheel, double-tap and Ctrl+=/-/0 zooming for the container it is placed on. */
@Directive({ selector: '[iqraZoomGestures]' })
export class ZoomGesturesDirective implements OnDestroy {
  readonly zoom = input<number>(1);
  readonly view = input<View>('page');
  readonly lastCustomZoom = input<number>(1);
  readonly zoomChange = output<number>();

  private readonly touches = new Map<number, { x: number; y: number }>();
  private pinch: { startZoom: number; startDist: number } | undefined;
  private pendingZoom: number | undefined;
  private frame: number | ReturnType<typeof setTimeout> | undefined;
  private press: { id: number; x: number; y: number } | undefined;
  private lastTap: { x: number; y: number; t: number } | undefined;

  ngOnDestroy(): void {
    this.cancelFrame();
  }

  private dist(): number {
    const [a, b] = [...this.touches.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private cancelFrame(): void {
    if (this.frame === undefined) return;
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.frame as number);
    clearTimeout(this.frame as ReturnType<typeof setTimeout>);
    this.frame = undefined;
  }

  private emitThrottled(z: number): void {
    this.pendingZoom = z;
    if (this.frame !== undefined) return;
    const flush = () => {
      this.frame = undefined;
      if (this.pendingZoom !== undefined) this.zoomChange.emit(this.pendingZoom);
      this.pendingZoom = undefined;
    };
    this.frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(flush) : setTimeout(flush, 16);
  }

  @HostListener('pointerdown', ['$event'])
  protected down(e: PointerEvent): void {
    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size === 2) {
        this.pinch = { startZoom: this.zoom(), startDist: Math.max(1, this.dist()) };
        this.press = undefined;
        this.lastTap = undefined;
        return;
      }
    }
    this.press = this.touches.size > 1 ? undefined : { id: e.pointerId, x: e.clientX, y: e.clientY };
  }

  @HostListener('pointermove', ['$event'])
  protected move(e: PointerEvent): void {
    const t = this.touches.get(e.pointerId);
    if (t) {
      t.x = e.clientX;
      t.y = e.clientY;
    }
    if (this.pinch && this.touches.size >= 2) {
      this.emitThrottled(pinchZoom(this.pinch.startZoom, this.pinch.startDist, this.dist()));
    }
  }

  @HostListener('pointerup', ['$event'])
  protected up(e: PointerEvent): void {
    this.touches.delete(e.pointerId);
    if (this.touches.size < 2) this.pinch = undefined;
    const p = this.press;
    this.press = undefined;
    if (!p || p.id !== e.pointerId) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > TAP_MAX_MOVE_PX) {
      this.lastTap = undefined;
      return;
    }
    const now = performance.now();
    const prev = this.lastTap;
    if (prev && now - prev.t <= DOUBLE_TAP_MS && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) <= DOUBLE_TAP_PX) {
      this.lastTap = undefined;
      this.zoomChange.emit(toggleFit(this.zoom(), this.lastCustomZoom()));
    } else {
      this.lastTap = { x: e.clientX, y: e.clientY, t: now };
    }
  }

  @HostListener('pointercancel', ['$event'])
  protected cancel(e: PointerEvent): void {
    this.touches.delete(e.pointerId);
    if (this.touches.size < 2) this.pinch = undefined;
    this.press = undefined;
  }

  @HostListener('wheel', ['$event'])
  protected wheel(e: WheelEvent): void {
    if (!e.ctrlKey || e.deltaY === 0) return;
    e.preventDefault();
    this.zoomChange.emit(e.deltaY < 0 ? zoomIn(this.zoom(), this.view()) : zoomOut(this.zoom(), this.view()));
  }

  @HostListener('document:keydown', ['$event'])
  protected key(e: KeyboardEvent): void {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || isReaderKeyIgnored(e)) return;
    if (e.key === '=' || e.key === '+') {
      this.zoomChange.emit(zoomIn(this.zoom(), this.view()));
    } else if (e.key === '-') {
      this.zoomChange.emit(zoomOut(this.zoom(), this.view()));
    } else if (e.key === '0') {
      this.zoomChange.emit(1);
    } else {
      return;
    }
    e.preventDefault();
  }
}
