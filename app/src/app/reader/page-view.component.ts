import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { COPY } from '../ui/copy';
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
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="box" [class.shimmer]="!painted()" [style.width.px]="cssWidth()" [style.height.px]="cssHeight()">
      <canvas #canvas [style.filter]="filter()"></canvas>
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
  readonly rendered = output<number>();

  protected readonly copy = COPY.reader;
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

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
      },
      (err: unknown) => {
        if (generation !== this.generation || controller.signal.aborted) return;
        if ((err as { name?: string } | null)?.name === 'AbortError') return;
        this.failed.set(true);
      },
    );
  }

  ngOnDestroy(): void {
    clearTimeout(this.timer);
    this.controller?.abort();
    const canvas = this.canvas().nativeElement;
    canvas.width = 0;
    canvas.height = 0;
  }
}
