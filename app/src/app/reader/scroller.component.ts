import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  OnDestroy,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { Annotation, Rect } from '../core/models';
import type { Place } from './jump-history';
import { PageViewComponent, type PageTheme } from './page-view.component';
import type { PageRenderer } from './pdf-session';
import { annotationsByPage } from './annotations-by-page';
import { placeAtTop, visibleRange } from './virtualize';
import { ZoomGesturesDirective } from './zoom-gestures.directive';

const GAP_PX = 12;
const PLACE_DEBOUNCE_MS = 100;
const TAP_MAX_MOVE_PX = 6;
const TAP_MAX_MS = 300;
const DEFAULT_RATIO = 1.414;

@Component({
  selector: 'iqra-scroller',
  imports: [PageViewComponent, ZoomGesturesDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      #viewport
      class="viewport"
      iqraZoomGestures
      [zoom]="zoom()"
      view="page"
      [lastCustomZoom]="lastCustomZoom()"
      [suspended]="tool() !== 'none'"
      (zoomChange)="zoomChange.emit($event)"
      (scroll)="onScroll()"
      (pointerdown)="down($event)"
      (pointerup)="up($event)"
      (pointercancel)="press = undefined"
    >
      <div class="column" [style.width.px]="columnWidth()" [style.height.px]="totalHeight()">
        @for (box of boxes(); track box.index) {
          <div
            class="page"
            [attr.data-page]="box.index + 1"
            [style.top.px]="box.top"
            [style.left.px]="pageLeft()"
            [style.width.px]="pageWidth()"
            [style.height.px]="box.height"
          >
            @if (box.rendered) {
              <iqra-page-view
                [renderer]="renderer()"
                [page]="box.index + 1"
                [withText]="box.textual"
                [fitWidthPx]="fitWidth()"
                [zoom]="zoom()"
                [theme]="theme()"
                [annotations]="onPage(box.index + 1)"
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
    </div>
  `,
  styles: `
    :host { display: block; width: 100%; height: 100%; }
    .viewport { box-sizing: border-box; width: 100%; height: 100%; overflow: auto; overscroll-behavior: contain; touch-action: pan-x pan-y; }
    .column { position: relative; margin: 0 auto; }
    .page { position: absolute; }
  `,
})
export class ScrollerComponent implements OnDestroy {
  readonly renderer = input.required<PageRenderer>();
  readonly startPlace = input<Place>({ page: 1, offset: 0 });
  readonly zoom = input<number>(1);
  readonly theme = input<PageTheme>('paper');
  readonly placeChange = output<Place>();
  readonly zoomChange = output<number>();
  readonly annotations = input<Annotation[]>([]);
  readonly flashId = input<string | null>(null);
  readonly annotationTap = output<Annotation>();
  /** The active drawing tool; anything but 'none' turns pinch and tap handling off. */
  readonly tool = input<'none' | 'area'>('none');
  readonly areaDrawn = output<{ page: number; rect: Rect }>();
  readonly tap = output<void>();

  private readonly byPage = computed(() => annotationsByPage(this.annotations()));
  protected onPage(page: number): Annotation[] {
    return this.byPage().get(page) ?? [];
  }

  private readonly viewport = viewChild.required<ElementRef<HTMLElement>>('viewport');
  private readonly injector = inject(Injector);

  protected readonly fitWidth = signal(0);
  private readonly viewportH = signal(0);
  private readonly scrollTop = signal(0);
  /** Height / width per page; `undefined` until that page's own size has resolved. */
  private readonly ratios = signal<(number | undefined)[]>([]);
  private readonly defaultRatio = signal<number | undefined>(undefined);
  protected readonly lastCustomZoom = signal(1);

  protected readonly pageWidth = computed(() => this.fitWidth() * this.zoom());
  protected readonly columnWidth = computed(() => Math.max(this.pageWidth(), this.fitWidth()));

  /** Pages narrower than the viewport (zoom < 1) are centred; wider ones overflow from the left. */
  protected readonly pageLeft = computed(() => (this.columnWidth() - this.pageWidth()) / 2);

  private readonly heights = computed(() => {
    const def = this.defaultRatio();
    const w = this.pageWidth();
    const ratios = this.ratios();
    const n = this.renderer().numPages;
    if (def === undefined) return [] as number[];
    return Array.from({ length: n }, (_, i) => w * (ratios[i] ?? def));
  });
  private readonly tops = computed(() => {
    const out: number[] = [];
    let y = 0;
    for (const h of this.heights()) {
      out.push(y);
      y += h + GAP_PX;
    }
    return out;
  });
  protected readonly totalHeight = computed(() => {
    const h = this.heights();
    return h.length === 0 ? 0 : this.tops()[h.length - 1] + h[h.length - 1];
  });
  private readonly range = computed(() =>
    visibleRange({
      scrollTop: this.scrollTop(),
      viewportH: this.viewportH(),
      tops: this.tops(),
      heights: this.heights(),
      overscanPx: this.viewportH(),
    }),
  );
  /** Pages within half a viewport of the screen get a text layer; the rest of the render window is picture only. */
  private readonly textRange = computed(() =>
    visibleRange({
      scrollTop: this.scrollTop(),
      viewportH: this.viewportH(),
      tops: this.tops(),
      heights: this.heights(),
      overscanPx: this.viewportH() / 2,
    }),
  );
  protected readonly boxes = computed(() => {
    const { first, last } = this.range();
    const text = this.textRange();
    const tops = this.tops();
    const heights = this.heights();
    return heights.map((height, index) => ({
      index,
      top: tops[index],
      height,
      rendered: index >= first && index <= last,
      textual: index >= text.first && index <= text.last,
    }));
  });

  private observer: ResizeObserver | undefined;
  private frame: number | ReturnType<typeof setTimeout> | undefined;
  private placeTimer: ReturnType<typeof setTimeout> | undefined;
  private started = false;
  private destroyed = false;
  /** The page under the viewport centre and the fraction down it; survives zoom and height changes. */
  private anchor: { index: number; frac: number } = { index: 0, frac: 0 };
  private lastZoom: number | undefined;
  private requested = new Set<number>();
  protected press: { id: number; x: number; y: number; t: number } | undefined;

  constructor() {
    afterNextRender(() => {
      const el = this.viewport().nativeElement;
      const measure = () => {
        this.fitWidth.set(el.clientWidth);
        this.viewportH.set(el.clientHeight);
      };
      measure();
      if (typeof ResizeObserver !== 'undefined') {
        this.observer = new ResizeObserver(measure);
        this.observer.observe(el);
      }
    });

    // Start-up: learn the default aspect from page 1 and the start page's own size, then jump to the start place.
    effect(() => {
      const renderer = this.renderer();
      const width = this.fitWidth();
      if (this.started || width <= 0) return;
      this.started = true;
      const place = untracked(() => this.startPlace());
      const startPage = Math.min(Math.max(1, place.page), renderer.numPages);
      void Promise.all([this.sizeOf(renderer, 1), this.sizeOf(renderer, startPage)]).then(([first, start]) => {
        if (this.destroyed) return;
        this.requested.add(1).add(startPage);
        this.defaultRatio.set(first ?? DEFAULT_RATIO);
        if (start !== undefined) this.ratios.update((r) => this.withRatio(r, startPage - 1, start));
        afterNextRender(() => this.scrollTo({ page: startPage, offset: place.offset }), { injector: this.injector });
      });
    });

    // Resolve the real size of every page that enters the render range.
    effect(() => {
      const { first, last } = this.range();
      const renderer = untracked(() => this.renderer());
      for (let i = first; i <= last; i++) {
        if (this.requested.has(i + 1)) continue;
        this.requested.add(i + 1);
        void this.sizeOf(renderer, i + 1).then((ratio) => {
          if (ratio !== undefined && !this.destroyed) this.setRatio(i, ratio);
        });
      }
    });

    // Zoom keeps the viewport-centre anchor.
    effect(() => {
      const z = this.zoom();
      if (z > 1.05) this.lastCustomZoom.set(z);
      if (this.lastZoom !== undefined && this.lastZoom !== z && untracked(() => this.heights().length) > 0) {
        afterNextRender(() => this.restoreAnchor(), { injector: this.injector });
      }
      this.lastZoom = z;
    });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.observer?.disconnect();
    clearTimeout(this.placeTimer);
    if (this.frame !== undefined) {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.frame as number);
      clearTimeout(this.frame as ReturnType<typeof setTimeout>);
    }
  }

  /** Scrolls so `place.page` is at the top, `place.offset` of the way down it. */
  scrollTo(place: Place): void {
    const tops = this.tops();
    const heights = this.heights();
    const i = Math.min(Math.max(1, place.page), tops.length) - 1;
    if (i < 0) return;
    const el = this.viewport().nativeElement;
    el.scrollTop = tops[i] + Math.min(1, Math.max(0, place.offset)) * heights[i];
    this.sync();
  }

  /**
   * The space the top bar takes (padding on the viewport). Content coordinate c sits at viewport y = topPad + c - scrollTop,
   * so the reading line just below the bar is exactly c = scrollTop and the padding cancels out of scrollTo and the place.
   */
  private topPad(): number {
    const el = this.viewport().nativeElement;
    return typeof getComputedStyle === 'function' ? parseFloat(getComputedStyle(el).paddingTop) || 0 : 0;
  }

  private async sizeOf(renderer: PageRenderer, page: number): Promise<number | undefined> {
    try {
      const s = await renderer.pageSize(page);
      return s.heightPt / s.widthPt;
    } catch {
      return undefined;
    }
  }

  private withRatio(ratios: (number | undefined)[], i: number, ratio: number): (number | undefined)[] {
    const next = ratios.slice();
    next[i] = ratio;
    return next;
  }

  /** Records a page's real aspect; pages above the anchor shift the scroll position to keep the view still. */
  private setRatio(i: number, ratio: number): void {
    const before = this.heights()[i];
    this.ratios.update((r) => this.withRatio(r, i, ratio));
    const delta = this.heights()[i] - before;
    if (delta !== 0 && i < this.anchor.index) {
      afterNextRender(
        () => {
          this.viewport().nativeElement.scrollTop += delta;
          this.sync();
        },
        { injector: this.injector },
      );
    }
  }

  private restoreAnchor(): void {
    const { index, frac } = this.anchor;
    const tops = this.tops();
    const heights = this.heights();
    if (index >= tops.length) return;
    const el = this.viewport().nativeElement;
    el.scrollTop = Math.max(0, tops[index] + frac * heights[index] - el.clientHeight / 2 + this.topPad());
    this.sync();
  }

  protected onScroll(): void {
    if (this.frame !== undefined) return;
    const flush = () => {
      this.frame = undefined;
      this.sync();
    };
    this.frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(flush) : setTimeout(flush, 16);
  }

  /** Reads the scroll position, updates the render window and anchor, and schedules a place report. */
  private sync(): void {
    const el = this.viewport().nativeElement;
    const top = el.scrollTop;
    this.scrollTop.set(top);
    const tops = this.tops();
    const heights = this.heights();
    if (tops.length === 0) return;
    // The page under the viewport centre, for keeping the view still while zooming.
    const centre = placeAtTop({ scrollTop: top + el.clientHeight / 2 - this.topPad(), tops, heights });
    this.anchor = { index: centre.index, frac: centre.offset };
    clearTimeout(this.placeTimer);
    this.placeTimer = setTimeout(() => {
      // The reading line is the top of the content area, so the place is simply the content coordinate scrollTop.
      const at = placeAtTop({ scrollTop: el.scrollTop, tops: this.tops(), heights: this.heights() });
      this.placeChange.emit({ page: at.index + 1, offset: at.offset });
    }, PLACE_DEBOUNCE_MS);
  }

  protected down(e: PointerEvent): void {
    // A second finger (pinch) cancels the press so it cannot end as a tap.
    if (this.tool() !== 'none') {
      this.press = undefined;
      return;
    }
    this.press = this.press ? undefined : { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
  }

  protected up(e: PointerEvent): void {
    const p = this.press;
    this.press = undefined;
    if (!p || p.id !== e.pointerId) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < TAP_MAX_MOVE_PX && performance.now() - p.t < TAP_MAX_MS) {
      // A tap on a page is the page view's to interpret (highlight, word, or bars); it re-emits through pageTap.
      if (!(e.target as Element | null)?.closest?.('iqra-page-view')) this.tap.emit();
    }
  }
}
