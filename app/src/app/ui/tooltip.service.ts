import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

const SHOW_DELAY_MS = 350;
const GAP_PX = 8;
const EDGE_PX = 8;
/** Elements this close to the right edge get their label on their left (the reader's toolbar). */
const SIDE_ZONE_PX = 96;
const TOOLTIP_ID = 'iqra-tooltip';
/** Buttons and links whose name is only an `aria-label`. */
const TARGET = 'button[aria-label], a[aria-label], [role="button"][aria-label]';

/**
 * Hover and keyboard-focus labels for every icon-only button, app-wide. One listener set on the document,
 * one `role="tooltip"` element; nothing to import per component. A label is shown only for a target with no
 * visible text of its own, never for a touch pointer, and it names the shortcut from `data-shortcut`.
 */
@Injectable({ providedIn: 'root' })
export class TooltipService {
  private readonly doc = inject(DOCUMENT);
  private tip: HTMLElement | null = null;
  private target: HTMLElement | null = null;
  /** The element whose label is waiting out the delay. */
  private pending: HTMLElement | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private installed: (() => void) | null = null;

  /** Starts listening; calling it again does nothing. Returns the function that stops it. */
  install(): () => void {
    if (this.installed) return this.installed;
    const doc = this.doc;
    const on = (type: string, fn: (e: Event) => void, capture = false) => {
      doc.addEventListener(type, fn, { capture, passive: true });
      return () => doc.removeEventListener(type, fn, { capture });
    };
    const stops = [
      on('pointerover', (e) => this.hover(e as PointerEvent)),
      on('pointerout', (e) => this.leave(e as PointerEvent)),
      on('focusin', (e) => this.focus(e)),
      on('focusout', () => this.hide()),
      on('pointerdown', () => this.hide(), true),
      on('click', () => this.hide(), true),
      on('scroll', () => this.hide(), true),
      on('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Escape') this.hide();
      }, true),
    ];
    this.installed = () => {
      stops.forEach((stop) => stop());
      this.hide();
      this.installed = null;
    };
    return this.installed;
  }

  private hover(e: PointerEvent): void {
    if (e.pointerType === 'touch') return;
    const el = this.targetOf(e.target);
    if (!el) return this.hide();
    if (el === this.target || el === this.pending) return;
    this.schedule(el);
  }

  private leave(e: PointerEvent): void {
    if (e.pointerType === 'touch') return;
    const to = e.relatedTarget as Node | null;
    if (this.target && to && this.target.contains(to)) return;
    if (this.target || this.pending) this.hide();
  }

  private focus(e: Event): void {
    const el = this.targetOf(e.target);
    // Only keyboard focus: a tap or click that focuses a button is not :focus-visible.
    if (!el || !el.matches(':focus-visible')) return;
    this.schedule(el);
  }

  private targetOf(node: EventTarget | null): HTMLElement | null {
    const el = (node as Element | null)?.closest?.(TARGET) as HTMLElement | null | undefined;
    if (!el || !el.getAttribute('aria-label')) return null;
    // A button with visible text already says what it is.
    if ((el.textContent ?? '').trim() !== '') return null;
    return el;
  }

  private schedule(el: HTMLElement): void {
    this.hide();
    this.pending = el;
    this.timer = setTimeout(() => this.show(el), SHOW_DELAY_MS);
  }

  private show(el: HTMLElement): void {
    this.timer = undefined;
    this.pending = null;
    const label = el.getAttribute('aria-label');
    if (!label || !el.isConnected) return;
    const tip = this.ensureTip();
    tip.replaceChildren(this.doc.createTextNode(label));
    const shortcut = el.getAttribute('data-shortcut');
    if (shortcut) {
      const kbd = this.doc.createElement('kbd');
      kbd.textContent = shortcut;
      kbd.style.cssText = 'margin-inline-start:8px;padding:0 5px;border:1px solid var(--tool-line);border-radius:5px;font:inherit;font-size:11px;opacity:.85';
      tip.append(kbd);
    }
    tip.style.visibility = 'hidden';
    tip.style.display = 'block';
    this.place(tip, el);
    tip.style.visibility = 'visible';
    el.setAttribute('aria-describedby', TOOLTIP_ID);
    this.target = el;
  }

  private place(tip: HTMLElement, el: HTMLElement): void {
    const view = this.doc.defaultView!;
    const r = el.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    let left: number;
    let top: number;
    if (r.right > view.innerWidth - SIDE_ZONE_PX) {
      left = r.left - GAP_PX - t.width;
      top = r.top + (r.height - t.height) / 2;
    } else {
      left = r.left + (r.width - t.width) / 2;
      top = r.bottom + GAP_PX;
      if (top + t.height > view.innerHeight - EDGE_PX) top = r.top - GAP_PX - t.height;
    }
    left = Math.max(EDGE_PX, Math.min(left, view.innerWidth - t.width - EDGE_PX));
    top = Math.max(EDGE_PX, Math.min(top, view.innerHeight - t.height - EDGE_PX));
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
  }

  private hide(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = null;
    if (this.target?.getAttribute('aria-describedby') === TOOLTIP_ID) this.target.removeAttribute('aria-describedby');
    this.target = null;
    if (this.tip) this.tip.style.display = 'none';
  }

  private ensureTip(): HTMLElement {
    if (this.tip?.isConnected) return this.tip;
    const tip = this.doc.createElement('div');
    tip.id = TOOLTIP_ID;
    tip.setAttribute('role', 'tooltip');
    tip.style.cssText =
      'position:fixed;z-index:200;display:none;max-width:260px;padding:5px 9px;border-radius:8px;' +
      'background:var(--tool-bg);color:var(--tool-fg);font:500 12.5px/1.35 var(--ui);pointer-events:none;' +
      'box-shadow:0 4px 14px rgb(0 0 0 / .25);white-space:nowrap';
    this.doc.body.append(tip);
    this.tip = tip;
    return tip;
  }
}
