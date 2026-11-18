import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  afterNextRender,
  computed,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { resolveSwipe } from './gestures';
import { PageViewComponent, type PageTheme } from './page-view.component';
import type { PageRenderer } from './pdf-session';

const SWIPE_MAX_ZOOM = 1.05;
const ANIMATION_MS = 220;
const TAP_MAX_MOVE_PX = 6;
const TAP_MAX_MS = 300;
const EDGE_RESISTANCE = 0.3;
const KEY_SCROLL_PX = 60;

interface Slot {
  role: 'prev' | 'cur' | 'next';
  page: number | null;
}

@Component({
  selector: 'iqra-pager',
  imports: [PageViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      #viewport
      class="viewport"
      [class.zoomed]="zoomed()"
      (pointerdown)="down($event)"
      (pointermove)="move($event)"
      (pointerup)="up($event)"
      (pointercancel)="cancel($event)"
    >
      @if (zoomed()) {
        <div #pan class="pan">
          <iqra-page-view
            [renderer]="renderer()"
            [page]="page()"
            [fitWidthPx]="width()"
            [zoom]="zoom()"
            [theme]="theme()"
          />
        </div>
      } @else {
        <div
          class="track"
          [style.transform]="'translate3d(' + (offset() - width()) + 'px,0,0)'"
          [style.transition]="animating() ? 'transform ' + animationMs + 'ms ease-out' : 'none'"
          [style.touch-action]="'pan-y'"
        >
          @for (slot of slots(); track slot.page ?? slot.role) {
            <div class="slot" [attr.data-slot]="slot.role" [style.width.px]="width()">
              @if (slot.page !== null) {
                <iqra-page-view
                  [renderer]="renderer()"
                  [page]="slot.page"
                  [fitWidthPx]="width()"
                  [zoom]="zoom()"
                  [theme]="theme()"
                />
              }
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: `
    :host { display: block; width: 100%; height: 100%; }
    .viewport { position: relative; width: 100%; height: 100%; overflow: hidden; user-select: none; touch-action: pan-y; }
    .viewport.zoomed { touch-action: auto; }
    .track { display: flex; height: 100%; will-change: transform; }
    .slot { flex: none; height: 100%; display: flex; align-items: flex-start; justify-content: center; overflow: hidden; }
    .pan { width: 100%; height: 100%; overflow: auto; }
  `,
})
export class PagerComponent implements OnDestroy {
  readonly renderer = input.required<PageRenderer>();
  readonly page = input.required<number>();
  readonly zoom = input<number>(1);
  readonly rtl = input<boolean>(false);
  readonly theme = input<PageTheme>('paper');
  readonly pageChange = output<number>();
  readonly zoomChange = output<number>();
  readonly tap = output<void>();

  protected readonly animationMs = ANIMATION_MS;
  private readonly viewport = viewChild.required<ElementRef<HTMLElement>>('viewport');
  private readonly pan = viewChild<ElementRef<HTMLElement>>('pan');

  protected readonly width = signal(0);
  protected readonly offset = signal(0);
  protected readonly animating = signal(false);
  protected readonly zoomed = computed(() => this.zoom() > SWIPE_MAX_ZOOM);

  /** Prev/cur/next in left-to-right DOM order; an rtl book mirrors it so the next page sits on the left. */
  protected readonly slots = computed<Slot[]>(() => {
    const p = this.page();
    const n = this.renderer().numPages;
    const slot = (role: Slot['role'], page: number): Slot => ({ role, page: page >= 1 && page <= n ? page : null });
    const prev = slot('prev', p - 1);
    const cur = slot('cur', p);
    const next = slot('next', p + 1);
    return this.rtl() ? [next, cur, prev] : [prev, cur, next];
  });

  private start: { x: number; y: number; t: number } | undefined;
  private dragging = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private observer: ResizeObserver | undefined;

  constructor() {
    afterNextRender(() => {
      const el = this.viewport().nativeElement;
      const measure = () => this.width.set(el.clientWidth);
      measure();
      if (typeof ResizeObserver !== 'undefined') {
        this.observer = new ResizeObserver(measure);
        this.observer.observe(el);
      }
    });
  }

  ngOnDestroy(): void {
    clearTimeout(this.timer);
    this.observer?.disconnect();
  }

  private hasPage(dir: 1 | -1): boolean {
    const target = this.page() + dir;
    return target >= 1 && target <= this.renderer().numPages;
  }

  protected down(e: PointerEvent): void {
    if (this.animating()) return;
    this.start = { x: e.clientX, y: e.clientY, t: performance.now() };
    this.dragging = false;
    if (!this.zoomed()) {
      try {
        (e.target as Element | null)?.setPointerCapture?.(e.pointerId);
      } catch {
        // Capture is an optimisation; synthetic or already-released pointers can throw.
      }
    }
  }

  protected move(e: PointerEvent): void {
    if (!this.start || this.zoomed()) return;
    const dx = e.clientX - this.start.x;
    const dy = e.clientY - this.start.y;
    if (!this.dragging) {
      if (Math.abs(dx) <= TAP_MAX_MOVE_PX || Math.abs(dy) > Math.abs(dx)) return;
      this.dragging = true;
    }
    // Moving right reveals the left slot: the previous page in ltr, the next one in rtl.
    const revealsNext = this.rtl() ? dx > 0 : dx < 0;
    const blocked = !this.hasPage(revealsNext ? 1 : -1);
    this.offset.set(blocked ? dx * EDGE_RESISTANCE : dx);
  }

  protected up(e: PointerEvent): void {
    const s = this.start;
    this.start = undefined;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    const dtMs = performance.now() - s.t;
    const wasDragging = this.dragging;
    this.dragging = false;

    if (Math.abs(dx) < TAP_MAX_MOVE_PX && Math.abs(dy) < TAP_MAX_MOVE_PX && dtMs < TAP_MAX_MS) {
      this.offset.set(0);
      this.tap.emit();
      return;
    }
    if (this.zoomed() || !wasDragging) {
      this.offset.set(0);
      return;
    }

    const width = this.width();
    const result = resolveSwipe({ dx, dy, dtMs, width, zoom: this.zoom(), rtl: this.rtl() });
    const dir = result === 'next' ? 1 : result === 'prev' ? -1 : 0;
    if (dir === 0 || !this.hasPage(dir)) {
      this.settle(0);
      return;
    }
    // The next page's slot is on the right in ltr and on the left in rtl.
    const toLeft = this.rtl() ? dir === -1 : dir === 1;
    this.settle(toLeft ? -width : width, this.page() + dir);
  }

  protected cancel(_e: PointerEvent): void {
    this.start = undefined;
    this.dragging = false;
    this.offset.set(0);
  }

  /** Animates the track to `target`, then (for a page turn) emits the new page and resets the track. */
  private settle(target: number, nextPage?: number): void {
    clearTimeout(this.timer);
    this.animating.set(true);
    this.offset.set(target);
    this.timer = setTimeout(() => {
      this.animating.set(false);
      this.offset.set(0);
      if (nextPage !== undefined) this.pageChange.emit(nextPage);
    }, ANIMATION_MS);
  }

  /** Programmatic turn used by keys: slides like a swipe. */
  private turn(dir: 1 | -1): void {
    if (this.animating() || !this.hasPage(dir)) return;
    if (this.zoomed()) {
      const pan = this.pan()?.nativeElement;
      if (pan) pan.scrollTop = pan.scrollLeft = 0;
      this.pageChange.emit(this.page() + dir);
      return;
    }
    const toLeft = this.rtl() ? dir === -1 : dir === 1;
    const width = this.width();
    this.settle(toLeft ? -width : width, this.page() + dir);
  }

  /**
   * Whether the key belongs to the focused element (the event target) rather than the pager.
   * Fields and dialogs own every key; buttons and links own only their activation keys.
   */
  private ownsKey(node: EventTarget | null, key: string): boolean {
    const el = node as HTMLElement | null;
    if (!el || typeof el.closest !== 'function') return false;
    if (
      el.isContentEditable === true ||
      el.closest('input, textarea, select, [contenteditable]:not([contenteditable=false]), [role=dialog]') !== null
    ) {
      return true;
    }
    return (key === ' ' || key === 'Enter') && el.closest('button, a[href], [role=button]') !== null;
  }

  @HostListener('document:keydown', ['$event'])
  protected onKey(e: KeyboardEvent): void {
    if (this.ownsKey(e.target, e.key)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const arrowNext = this.rtl() ? 'ArrowLeft' : 'ArrowRight';
    const arrowPrev = this.rtl() ? 'ArrowRight' : 'ArrowLeft';
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      if (this.zoomed()) {
        // Zoomed: arrows pan the page instead of turning it.
        this.pan()?.nativeElement.scrollBy?.({ left: e.key === 'ArrowRight' ? KEY_SCROLL_PX : -KEY_SCROLL_PX });
        e.preventDefault();
        return;
      }
      this.turn(e.key === arrowNext ? 1 : -1);
      e.preventDefault();
    } else if (e.key === 'PageDown') {
      this.turn(1);
      e.preventDefault();
    } else if (e.key === 'PageUp') {
      this.turn(-1);
      e.preventDefault();
    } else if (e.key === ' ') {
      this.turn(e.shiftKey ? -1 : 1);
      e.preventDefault();
    }
  }
}
