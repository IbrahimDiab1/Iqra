import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { Annotation, Rect } from '../core/models';
import { hasDetail } from '../annotations/anchor';

interface Mark {
  key: string;
  id: string;
  kind: 'fill' | 'underline';
  color: string;
  rect: Rect;
  dot: boolean;
}

/** Draws every text and area rect of a page's annotations, positioned in percent so zoom never matters. */
@Component({
  selector: 'iqra-highlight-layer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (m of marks(); track m.key) {
      <div
        [class]="m.kind"
        [class.flash]="m.id === flashId()"
        [attr.data-id]="m.id"
        [style.left.%]="m.rect.x * 100"
        [style.top.%]="m.rect.y * 100"
        [style.width.%]="m.rect.w * 100"
        [style.height.%]="m.rect.h * 100"
        [style.background]="m.kind === 'fill' ? m.color : null"
      >
        @if (m.dot) {
          <span class="dot"></span>
        }
      </div>
    }
  `,
  styles: `
    :host { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
    .fill, .underline { position: absolute; }
    .fill { mix-blend-mode: multiply; }
    :host-context([data-rt='night']) .fill { mix-blend-mode: normal; }
    .underline { border-bottom: 2px solid var(--accent); box-sizing: border-box; }
    .dot { position: absolute; right: -3px; top: -3px; width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
    .flash { animation: flash 900ms ease-out; }
    @keyframes flash { 0%, 60% { outline: 2px solid var(--accent); outline-offset: 1px; } 100% { outline: 2px solid transparent; } }
    @media (prefers-reduced-motion: reduce) { .flash { animation: none; outline: 2px solid var(--accent); } }
  `,
})
export class HighlightLayerComponent {
  readonly annotations = input<Annotation[]>([]);
  readonly flashId = input<string | null>(null);

  protected readonly marks = computed<Mark[]>(() => {
    const out: Mark[] = [];
    for (const a of this.annotations()) {
      const rects =
        a.type === 'area' ? (a.rect ? [a.rect] : []) : a.type === 'highlight' || a.type === 'note' ? (a.text?.rects ?? []) : [];
      const kind = a.type === 'note' ? 'underline' : 'fill';
      const color = `var(--hl-${a.color ?? 'yellow'})`;
      const detail = hasDetail(a);
      rects.forEach((rect, i) => {
        out.push({ key: `${a.id}:${i}`, id: a.id, kind, color, rect, dot: detail && i === rects.length - 1 });
      });
    }
    return out;
  });
}
