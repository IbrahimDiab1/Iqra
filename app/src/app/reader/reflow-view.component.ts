import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  effect,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { hasDetail, occurrenceOf } from '../annotations/anchor';
import type { Annotation } from '../core/models';
import { COPY } from '../ui/copy';
import { isReaderKeyIgnored } from './keys';
import type { PageTheme } from './page-view.component';
import type { PageRenderer } from './pdf-session';
import { splitPageRuns, type RunMark } from './reflow-highlights';
import { buildReflow, hasSelectableText, type Paragraph, type TextItem } from './text';

const BASE_FONT_PX = 17;

type State = { kind: 'loading' } | { kind: 'failed' } | { kind: 'empty' } | { kind: 'text'; paragraphs: Paragraph[]; items: TextItem[] };

const THEME_VARS: Record<PageTheme, { paper: string; ink: string }> = {
  paper: { paper: 'var(--paper-light)', ink: 'var(--ink-light)' },
  sepia: { paper: 'var(--paper-sepia)', ink: 'var(--ink-sepia)' },
  night: { paper: 'var(--paper-night)', ink: 'var(--ink-night)' },
};

@Component({
  selector: 'iqra-reflow-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      #scroll
      class="scroll"
      [style.background]="colors().paper"
      [style.color]="colors().ink"
      (click)="clicked($event)"
    >
      @switch (state().kind) {
        @case ('text') {
          <article class="reflow-article" [attr.data-page]="page()" [style.font-size.px]="fontPx()">
            @if (hasPrev()) {
              <button type="button" class="nav prev" (click)="pageChange.emit(page() - 1)">{{ copy.prevPage }}</button>
            }
            @for (p of rendered(); track $index) {
              <p [attr.dir]="p.rtl ? 'rtl' : 'ltr'" [attr.lang]="p.rtl ? 'ar' : null">
                @for (r of p.runs; track $index) {
                  @if (r.annotationId) {
                    <mark
                      [attr.data-id]="r.annotationId"
                      [class]="r.color ? 'hl-' + r.color : ''"
                      [class.underline]="!!r.underline"
                      [class.flash]="r.annotationId === flashId()"
                    >{{ r.text }}@if (r.dot) {<span class="dot" aria-hidden="true"></span>}</mark>
                  } @else {{{ r.text }}}
                }
              </p>
            }
            @if (hasNext()) {
              <button type="button" class="nav next" (click)="pageChange.emit(page() + 1)">{{ copy.nextPage }}</button>
            }
          </article>
        }
        @case ('empty') {
          <div class="message">
            <p>{{ copy.noText }}</p>
            <button type="button" class="nav" (click)="showPage.emit()">{{ copy.showPage }}</button>
          </div>
        }
        @case ('failed') {
          <div class="message" role="alert">
            <p>{{ copy.pageFailed }}</p>
          </div>
        }
      }
    </div>
  `,
  styles: `
    :host { display: block; width: 100%; height: 100%; }
    .scroll { width: 100%; height: 100%; overflow-y: auto; padding: 24px 16px 32px; box-sizing: border-box; }
    article { max-width: 560px; margin: 0 auto; font-family: var(--book); line-height: 1.7; }
    article p { margin: 0 0 1em; }
    mark { background: transparent; color: inherit; border-radius: 2px; cursor: pointer; }
    mark.hl-yellow { background: var(--hl-yellow); }
    mark.hl-green { background: var(--hl-green); }
    mark.hl-blue { background: var(--hl-blue); }
    mark.hl-pink { background: var(--hl-pink); }
    mark.underline { text-decoration: underline; text-decoration-color: var(--accent); text-decoration-thickness: 2px; text-underline-offset: 3px; }
    mark .dot { display: inline-block; width: 6px; height: 6px; margin-inline-start: 2px; vertical-align: super; border-radius: 50%; background: var(--accent); }
    mark.flash { animation: flash 900ms ease-out; }
    @keyframes flash { 0%, 60% { outline: 2px solid var(--accent); outline-offset: 1px; } 100% { outline: 2px solid transparent; } }
    @media (prefers-reduced-motion: reduce) { mark.flash { animation: none; outline: 2px solid var(--accent); } }
    .message { max-width: 560px; margin: 48px auto 0; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 16px; }
    .message p { margin: 0; opacity: 0.8; }
    .nav {
      display: block;
      min-height: 40px;
      min-width: 40px;
      margin: 16px auto;
      padding: 0 16px;
      border: 1px solid currentColor;
      border-radius: var(--radius-control);
      background: transparent;
      color: inherit;
      font: 15px var(--ui, inherit);
      cursor: pointer;
    }
    .nav:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  `,
})
export class ReflowViewComponent {
  readonly renderer = input.required<PageRenderer>();
  readonly page = input.required<number>();
  readonly zoom = input<number>(1);
  readonly rtl = input<boolean>(false);
  /** The reader chose a direction for the book (rtl input is then that choice, not a guess). */
  readonly forced = input<boolean>(false);
  readonly theme = input<PageTheme>('paper');
  readonly pageChange = output<number>();
  readonly showPage = output<void>();
  readonly tap = output<void>();
  /** The book's annotations; those of this page that carry text are drawn as marks. */
  readonly annotations = input<Annotation[]>([]);
  readonly flashId = input<string | null>(null);
  readonly annotationTap = output<Annotation>();

  protected readonly copy = COPY.reader;
  private readonly scroll = viewChild.required<ElementRef<HTMLElement>>('scroll');

  protected readonly state = signal<State>({ kind: 'loading' });
  protected readonly paragraphs = computed(() => {
    const s = this.state();
    return s.kind === 'text' ? s.paragraphs : [];
  });
  private readonly pageAnnotations = computed(() =>
    this.annotations().filter((a) => (a.type === 'highlight' || a.type === 'note') && a.text?.page === this.page()),
  );
  protected readonly rendered = computed(() => {
    const s = this.state();
    const items = s.kind === 'text' ? s.items : [];
    const marks: RunMark[] = this.pageAnnotations().map((a) => {
      // Where the annotated text sits among the page's occurrences of it, so repeated text is drawn on the right one.
      const where = occurrenceOf(items, a.text!.quote, a.text!.start);
      return {
        id: a.id,
        quote: a.text!.quote,
        color: a.type === 'highlight' ? a.color : undefined,
        underline: a.type === 'note',
        hasDetail: hasDetail(a),
        ...(where ? { nth: where.nth, wordStart: where.wordStart, wordEnd: where.wordEnd } : {}),
      };
    });
    const paragraphs = this.paragraphs();
    const runs = splitPageRuns(
      paragraphs.map((p) => p.text),
      marks,
    );
    return paragraphs.map((p, i) => ({ rtl: p.rtl, runs: runs[i] }));
  });
  protected readonly colors = computed(() => THEME_VARS[this.theme()]);
  protected readonly fontPx = computed(() => Math.round(BASE_FONT_PX * this.zoom() * 100) / 100);
  protected readonly hasPrev = computed(() => this.page() > 1);
  protected readonly hasNext = computed(() => this.page() < this.renderer().numPages);

  private generation = 0;

  constructor() {
    effect(() => {
      const renderer = this.renderer();
      const page = this.page();
      const rtl = this.rtl();
      const forced = this.forced();
      const generation = ++this.generation;
      untracked(() => {
        this.state.set({ kind: 'loading' });
        const el = this.scroll().nativeElement;
        el.scrollTop = 0;
        renderer.textItems(page).then(
          (items) => {
            if (generation !== this.generation) return;
            this.state.set(
              hasSelectableText(items) ? { kind: 'text', paragraphs: buildReflow(items, { rtl, forced }), items } : { kind: 'empty' },
            );
            el.scrollTop = 0;
          },
          () => {
            if (generation === this.generation) this.state.set({ kind: 'failed' });
          },
        );
      });
    });
  }

  protected clicked(e: MouseEvent): void {
    if ((e.target as Element | null)?.closest?.('button')) return;
    if (typeof getSelection === 'function' && (getSelection()?.toString() ?? '') !== '') return;
    const id = (e.target as Element | null)?.closest?.<HTMLElement>('mark[data-id]')?.dataset['id'];
    const hit = id ? this.pageAnnotations().find((a) => a.id === id) : undefined;
    if (hit) {
      this.annotationTap.emit(hit);
      return;
    }
    this.tap.emit();
  }

  /** Left/right arrows turn the page, mirrored for rtl books. */
  @HostListener('document:keydown', ['$event'])
  protected onKey(e: KeyboardEvent): void {
    if (isReaderKeyIgnored(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const next = this.rtl() ? e.key === 'ArrowLeft' : e.key === 'ArrowRight';
    if (next ? this.hasNext() : this.hasPrev()) {
      this.pageChange.emit(this.page() + (next ? 1 : -1));
      e.preventDefault();
    }
  }
}
