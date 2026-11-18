import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { hitTest } from '../annotations/anchor';
import type { Annotation } from '../core/models';
import { COPY } from '../ui/copy';
import { HighlightLayerComponent } from './highlight-layer.component';
import { selectWordAt } from './selection.service';
import type { PageRenderer } from './pdf-session';

const ZOOM_DEBOUNCE_MS = 60;
const DEFAULT_RATIO = 1.414;

export type PageTheme = 'paper' | 'sepia' | 'night';

const FILTERS: Record<PageTheme, string> = {
  paper: '',
  sepia: 'sepia(.35) contrast(.95)',
  night: 'invert(1) hue-rotate(180deg) brightness(.92)',
};

@Component({
  selector: 'iqra-page-view',
  imports: [HighlightLayerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="box" [class.shimmer]="!painted()" [style.width.px]="cssWidth()" [style.height.px]="cssHeight()">
      <canvas #canvas [style.filter]="filter()"></canvas>
      <iqra-highlight-layer [annotations]="annotations()" [flashId]="flashId()" />
      <div
        #textLayer
        class="text-layer"
        [class.inert]="!interactive()"
        [attr.data-page]="page()"
        (click)="onClick($event)"
      ></div>
      @if (failed()) {
        <div class="failed" role="alert">
          <p>{{ copy.pageFailed }}</p>
          <button type="button" class="retry" (click)="retry()">{{ copy.retry }}</button>
        </div>
      }
    </div>
  `,
  styles: `
    :host { display: block; }
    .box { position: relative; background: var(--surface-2); overflow: hidden; }
    canvas { display: block; width: 100%; height: 100%; }
    /* pdf.js fills this with absolutely positioned, transparent spans; the browser's own selection works on them. */
    .text-layer {
      position: absolute;
      inset: 0;
      width: 100% !important;
      height: 100% !important;
      overflow: hidden;
      line-height: 1;
      color: transparent;
      user-select: text;
      -webkit-user-select: text;
    }
    .text-layer.inert { pointer-events: none; }
    .text-layer ::ng-deep span, .text-layer ::ng-deep br {
      position: absolute; margin: 0; padding: 0; color: transparent; white-space: pre; cursor: text; transform-origin: 0 0;
      /* pdf.js sets --font-height, --scale-x and --rotate per span, and --total-scale-factor on the layer. */
      font-size: calc(var(--font-height, 0px) * var(--total-scale-factor, 1));
      transform: rotate(var(--rotate, 0deg)) scaleX(var(--scale-x, 1));
    }
    .text-layer ::ng-deep .markedContent { display: contents; }
    .text-layer ::ng-deep ::selection { background: var(--sel); color: transparent; }
    .shimmer::after {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--surface) 70%, transparent), transparent);
      animation: shimmer 1.2s infinite;
    }
    @keyframes shimmer { from { transform: translateX(-100%); } to { transform: translateX(100%); } }
    .failed {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 16px;
      text-align: center;
      color: var(--fg);
      background: color-mix(in srgb, var(--surface) 85%, transparent);
    }
    .failed p { margin: 0; color: var(--muted); }
    .retry {
      min-height: 40px;
      min-width: 40px;
      padding: 0 16px;
      border: 1px solid var(--line);
      border-radius: var(--radius-control);
      background: var(--surface);
      color: var(--fg);
      font: inherit;
      cursor: pointer;
    }
    .retry:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  `,
})
export class PageViewComponent implements OnDestroy {
  readonly renderer = input.required<PageRenderer>();
  readonly page = input.required<number>();
  readonly fitWidthPx = input.required<number>();
  readonly zoom = input<number>(1);
  readonly theme = input<PageTheme>('paper');
  readonly annotations = input<Annotation[]>([]);
  readonly flashId = input<string | null>(null);
  readonly interactive = input(true);
  readonly rendered = output<number>();
  readonly annotationTap = output<Annotation>();
  readonly pageTap = output<void>();

  protected readonly copy = COPY.reader;
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly textLayer = viewChild.required<ElementRef<HTMLElement>>('textLayer');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly painted = signal(false);
  protected readonly failed = signal(false);
  private readonly ratio = signal(DEFAULT_RATIO);

  protected readonly cssWidth = computed(() => this.fitWidthPx() * this.zoom());
  protected readonly cssHeight = computed(() => this.cssWidth() * this.ratio());
  protected readonly filter = computed(() => FILTERS[this.theme()]);

  private controller: AbortController | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastPage: number | undefined;
  private generation = 0;
  private started = false;

  constructor() {
    // Re-render on every change of page, width or zoom. Page changes draw at once; zoom/width changes wait 60 ms.
    effect(() => {
      const page = this.page();
      const width = this.cssWidth();
      const renderer = this.renderer();
      untracked(() => {
        const pageChanged = page !== this.lastPage;
        this.lastPage = page;
        clearTimeout(this.timer);
        this.timer = undefined;
        // Abort now so a stale render never lands while the debounce waits.
        this.controller?.abort();
        this.controller = undefined;
        this.generation++;
        if (pageChanged) this.textLayer().nativeElement.replaceChildren();
        if (pageChanged || !this.started) {
          void renderer.pageSize(page).then((s) => {
            if (this.page() === page) this.ratio.set(s.heightPt / s.widthPt);
          }, () => undefined);
          this.start(renderer, page, width);
        } else {
          this.timer = setTimeout(() => this.start(renderer, page, width), ZOOM_DEBOUNCE_MS);
        }
      });
    });
  }

  protected retry(): void {
    this.start(this.renderer(), this.page(), this.cssWidth());
  }

  private start(renderer: PageRenderer, page: number, width: number): void {
    this.controller?.abort();
    this.failed.set(false);
    if (width <= 0) return;
    this.started = true;
    const controller = new AbortController();
    this.controller = controller;
    const generation = ++this.generation;
    renderer.renderPage(page, this.canvas().nativeElement, width, controller.signal).then(
      () => {
        if (generation !== this.generation || controller.signal.aborted) return;
        this.painted.set(true);
        this.rendered.emit(page);
        // The text layer is an extra: a failure here never fails the page, and a page without text just has none.
        renderer
          .renderTextLayer(page, this.textLayer().nativeElement, width, controller.signal)
          .catch(() => undefined);
      },
      (err: unknown) => {
        if (generation !== this.generation || controller.signal.aborted) return;
        if ((err as { name?: string } | null)?.name === 'AbortError') return;
        this.failed.set(true);
      },
    );
  }

  protected onClick(e: MouseEvent): void {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString() !== '') return;
    const rect = this.host.nativeElement.querySelector('.box')!.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const hit = hitTest(this.annotations(), this.page(), x, y);
    if (hit) {
      this.annotationTap.emit(hit);
    } else if ((e.target as Element | null)?.closest?.('[data-item]')) {
      // A tap on text selects the word under it (the selection toolbar then offers highlight/copy) instead of toggling the bars.
      selectWordAt(e.clientX, e.clientY);
    } else {
      this.pageTap.emit();
    }
  }

  ngOnDestroy(): void {
    clearTimeout(this.timer);
    this.controller?.abort();
    const canvas = this.canvas().nativeElement;
    canvas.width = 0;
    canvas.height = 0;
  }
}
