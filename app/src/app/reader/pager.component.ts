import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  Injector,
  OnDestroy,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import type { Annotation, Rect } from '../core/models';
import { resolveSwipe } from './gestures';
import { isReaderKeyIgnored } from './keys';
import { PageViewComponent, type PageTheme } from './page-view.component';
import type { PageRenderer } from './pdf-session';
import { SelectionService } from './selection.service';
import { annotationsByPage } from './annotations-by-page';

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
            [annotations]="onPage(page())"
            [flashId]="flashId()"
            [areaTool]="tool() === 'area'"
            (areaDrawn)="areaDrawn.emit($event)"
            (annotationTap)="annotationTap.emit($event)"
            (pageTap)="tap.emit()"
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
            <div class="slot" [attr.data-slot]="slot.role" [attr.tabindex]="slot.role === 'cur' ? 0 : -1" [style.width.px]="width()">
              @if (slot.page !== null) {
                <iqra-page-view
                  [renderer]="renderer()"
                  [page]="slot.page"
                  [fitWidthPx]="width()"
                  [zoom]="zoom()"
                  [theme]="theme()"
                  [annotations]="onPage(slot.page)"
                  [flashId]="flashId()"
                  [areaTool]="tool() === 'area'"
                  (areaDrawn)="areaDrawn.emit($event)"
                  (annotationTap)="annotationTap.emit($event)"
                  (pageTap)="tap.emit()"
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
    /* Zoomed: the browser may pan but never pinch-zooms the whole app (that is the directive's job). */
    .viewport.zoomed { touch-action: pan-x pan-y; }
    .track { display: flex; height: 100%; will-change: transform; }
    /* A page taller than the viewport scrolls inside its slot; the bars' space is reserved as padding. */
    .slot {
      flex: none; box-sizing: border-box; height: 100%; display: flex; align-items: flex-start; justify-content: center;
      overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; outline: none;
      padding: var(--reader-top, 0px) 0 var(--reader-bottom, 0px);
    }
    .pan { box-sizing: border-box; width: 100%; height: 100%; overflow: auto; touch-action: pan-x pan-y; padding: var(--reader-top, 0px) 0 var(--reader-bottom, 0px); }
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
  readonly annotations = input<Annotation[]>([]);
  readonly flashId = input<string | null>(null);
  readonly annotationTap = output<Annotation>();
  /** The active drawing tool; anything but 'none' turns the swipe off. */
  readonly tool = input<'none' | 'area'>('none');
  readonly areaDrawn = output<{ page: number; rect: Rect }>();
  readonly tap = output<void>();

  private readonly byPage = computed(() => annotationsByPage(this.annotations()));
  protected onPage(page: number): Annotation[] {
    return this.byPage().get(page) ?? [];
  }
  private readonly selection = inject(SelectionService, { optional: true });

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
  /** Pointers currently down; a second one means a pinch, which never moves the track or turns the page. */
  private readonly activeIds = new Set<number>();
  private primaryId: number | undefined;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private dragging = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private observer: ResizeObserver | undefined;

  constructor() {
    // Switching between the zoomed and unzoomed templates destroys the element that got the pointer's up/cancel.
    effect(() => {
      this.zoomed();
      this.activeIds.clear();
      this.start = undefined;
      this.dragging = false;
    });
    // A newly shown page starts at its top, and the current page's slot takes keyboard focus so ArrowUp/ArrowDown scroll it.
    effect(() => {
      this.page();
      afterNextRender(
        () => {
          const root = this.host.nativeElement;
          root.querySelectorAll<HTMLElement>('.slot').forEach((el) => (el.scrollTop = 0));
          const active = document.activeElement;
          if (active === null || active === document.body || root.contains(active)) {
            root.querySelector<HTMLElement>('.slot[data-slot="cur"]')?.focus({ preventScroll: true });
          }
        },
        { injector: this.injector },
      );
    });
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
    // A new primary pointer starts a fresh gesture: ids left behind by a destroyed element must not count.
    if (e.isPrimary) this.activeIds.clear();
    this.activeIds.add(e.pointerId);
    if (this.activeIds.size > 1) {
      // A second finger: this is a pinch, not a swipe.
      this.start = undefined;
      this.dragging = false;
      this.offset.set(0);
      return;
    }
    this.primaryId = e.pointerId;
    if (this.tool() !== 'none') {
      this.start = undefined;
      this.dragging = false;
      return;
    }
    // A drag that begins while text is selected, or a mouse drag that starts on text, selects; it never swipes.
    if (this.selection?.active() || (e.pointerType === 'mouse' && this.onText(e))) {
      this.start = undefined;
      this.dragging = false;
      return;
    }
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
    if (!this.start || this.zoomed() || e.pointerId !== this.primaryId || this.activeIds.size > 1) return;
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
    this.activeIds.delete(e.pointerId);
    const s = this.start;
    if (e.pointerId !== this.primaryId) return;
    this.start = undefined;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    const dtMs = performance.now() - s.t;
    const wasDragging = this.dragging;
    this.dragging = false;

    if (Math.abs(dx) < TAP_MAX_MOVE_PX && Math.abs(dy) < TAP_MAX_MOVE_PX && dtMs < TAP_MAX_MS) {
      this.offset.set(0);
      // A tap on a page is the page view's to interpret (highlight, word, or bars); it re-emits through pageTap.
      if (!(e.target as Element | null)?.closest?.('iqra-page-view')) this.tap.emit();
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

  private onText(e: PointerEvent): boolean {
    return !!(e.target as Element | null)?.closest?.('.text-layer [data-item]');
  }

  protected cancel(e: PointerEvent): void {
    this.activeIds.delete(e.pointerId);
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

  @HostListener('document:keydown', ['$event'])
  protected onKey(e: KeyboardEvent): void {
    if (isReaderKeyIgnored(e)) return;
    if (e.ctrlKey || e.metaKey || e.altKey || this.tool() !== 'none') return;
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
