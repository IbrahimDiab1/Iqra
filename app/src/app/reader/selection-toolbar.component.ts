import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { HIGHLIGHT_COLORS, type HighlightColor } from '../annotations/annotation.service';
import type { Rect } from '../core/models';
import { REVIEW_COPY } from '../review/review-copy';
import { COPY } from '../ui/copy';
import { icon } from '../ui/icons';
import type { PendingSelection } from './selection.service';

/** A drawn rectangle waiting for a color or a note. `anchor` is where it sits in the viewport, for placing the toolbar. */
export interface PendingArea {
  kind: 'area';
  page: number;
  rect: Rect;
  anchor: DOMRect;
}

const WIDTH = 296;
const HEIGHT = 48;
const MARGIN = 8;
/** On touch the system's selection handles hang under the selection; the bar sits this much further away. */
export const TOUCH_CLEARANCE = 28;

/**
 * Where the toolbar goes: below the selection with an 8 px gap, flipped above only if it would run off the bottom of
 * the viewport, centred on the selection and kept inside the viewport.
 */
export function placeToolbar(o: { rect: DOMRect; touch: boolean; vw: number; vh: number }): { left: number; top: number } {
  const { rect: r, vw, vh } = o;
  const gap = MARGIN + (o.touch ? TOUCH_CLEARANCE : 0);
  const left = Math.min(Math.max(r.left + r.width / 2 - WIDTH / 2, MARGIN), Math.max(MARGIN, vw - WIDTH - MARGIN));
  const lowest = Math.max(MARGIN, vh - HEIGHT - MARGIN);
  const below = r.bottom + gap;
  if (below <= lowest) return { left, top: below };
  const above = r.top - HEIGHT - gap;
  return { left, top: above >= MARGIN ? above : lowest };
}

/** Floating toolbar for a text selection: four highlight colors, Note, Copy. Rendered once by the reader. */
@Component({
  selector: 'iqra-selection-toolbar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (selection(); as sel) {
      <div
        class="bar"
        role="toolbar"
        [attr.aria-label]="copy.highlight"
        [style.left.px]="pos().left"
        [style.top.px]="pos().top"
        (mousedown)="$event.preventDefault()"
        (pointerdown)="$event.stopPropagation()"
      >
        @for (c of colors; track c) {
          <button
            type="button"
            class="dot"
            [attr.aria-label]="copy.colors[c]"
            [style.--c]="'var(--hl-' + c + ')'"
            (click)="color.emit(c)"
          ></button>
        }
        <button type="button" class="note" (click)="note.emit()">{{ copy.note }}</button>
        @if (!isArea()) {
          <button type="button" class="copy" (click)="copy_.emit()">{{ copy.copy }}</button>
          <button type="button" class="tr" data-testid="translate" [attr.aria-label]="translateLabel" (click)="translate.emit()" [innerHTML]="translateIcon"></button>
        }
      </div>
    }
  `,
  styles: `
    .bar {
      position: fixed; z-index: 23; display: flex; align-items: center; gap: 2px; height: 48px; padding: 0 4px;
      border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--surface); color: var(--fg); box-shadow: var(--shadow);
    }
    button { min-width: 36px; min-height: 40px; border: 0; border-radius: var(--radius-control); background: none; color: inherit; font: 13px var(--ui); cursor: pointer; }
    button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .dot { position: relative; min-width: 36px; }
    .tr { display: inline-grid; place-items: center; min-width: 40px; color: var(--accent); }
    .tr:hover { background: var(--accent-soft); }
    .dot::after { content: ''; position: absolute; inset: 8px; border-radius: 50%; background: var(--c); box-shadow: inset 0 0 0 1px var(--line); }
    .note, .copy { padding: 0 6px; min-width: 40px; }
    .note:hover, .copy:hover { background: var(--accent-soft); }
  `,
})
export class SelectionToolbarComponent {
  readonly selection = input<PendingSelection | PendingArea | null>(null);
  readonly color = output<HighlightColor>();
  readonly note = output<void>();
  readonly translate = output<void>();
  /** Named `copy` for the parent's template; the property is `copy_` because `copy` is the copy-strings table. */
  readonly copy_ = output<void>({ alias: 'copy' });

  protected readonly translateLabel = REVIEW_COPY.translate;
  protected readonly translateIcon = inject(DomSanitizer).bypassSecurityTrustHtml(icon('translate', 20));
  protected readonly copy = COPY.annotations;
  protected readonly colors = HIGHLIGHT_COLORS;

  protected readonly isArea = computed(() => (this.selection() as PendingArea | null)?.kind === 'area');
  protected readonly pos = computed(() => {
    const sel = this.selection();
    const r = sel && 'anchor' in sel ? sel.anchor : (sel as PendingSelection | null)?.rect;
    if (!r) return { left: 0, top: 0 };
    const vw = typeof innerWidth === 'number' ? innerWidth : 1024;
    const vh = typeof innerHeight === 'number' ? innerHeight : 768;
    const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    return placeToolbar({ rect: r, touch, vw, vh });
  });
}
