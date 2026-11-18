import { Injectable, OnDestroy, signal } from '@angular/core';
import { compareCaret, quoteOf, type Caret } from '../annotations/anchor';
import type { TextItem } from './text';

export interface PendingSelection {
  page: number;
  start: Caret;
  end: Caret;
  quote: string;
  /** Viewport rect of the selection, for placing the toolbar. */
  rect: DOMRect;
  source: 'page' | 'reflow';
}

const DEBOUNCE_MS = 150;

interface Opts {
  items: (page: number) => Promise<TextItem[]>;
}

/** The text layer a node sits in, or null. */
function layerOf(node: Node | null): HTMLElement | null {
  const el = node instanceof Element ? node : (node?.parentElement ?? null);
  return el?.closest<HTMLElement>('.text-layer') ?? null;
}

/** The caret (item index + character offset) for a DOM boundary point inside a text layer. */
function caretOf(layer: HTMLElement, container: Node, offset: number, edge: 'start' | 'end'): Caret | null {
  let span: HTMLElement | null;
  const at = offset;
  if (container === layer || (container instanceof Element && !container.closest('[data-item]'))) {
    // A boundary between the layer's children: it sits before the child at `offset` (start) or after the one before it (end).
    const child = container.childNodes[edge === 'start' ? offset : offset - 1];
    span =
      child instanceof Element ? (child.closest<HTMLElement>('[data-item]') ?? child.querySelector<HTMLElement>('[data-item]')) : null;
    if (!span) return null;
    const item = Number(span.dataset['item']);
    return { item, offset: edge === 'start' ? 0 : (span.textContent ?? '').length };
  }
  span = (container instanceof Element ? container : container.parentElement)?.closest<HTMLElement>('[data-item]') ?? null;
  if (!span) return null;
  const range = document.createRange();
  range.selectNodeContents(span);
  range.setEnd(container, at);
  return { item: Number(span.dataset['item']), offset: range.toString().length };
}

/**
 * Tracks the browser's text selection inside the reader and turns it into a PendingSelection.
 * Provided by the reader page, not root.
 */
@Injectable()
export class SelectionService implements OnDestroy {
  private readonly _pending = signal<PendingSelection | null>(null);
  private readonly _active = signal(false);
  readonly pending = this._pending.asReadonly();
  /** A non-collapsed selection exists inside the reader. */
  readonly active = this._active.asReadonly();

  private opts: Opts | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private token = 0;
  private readonly listener = () => this.onChange();

  attach(opts: Opts): void {
    this.opts = opts;
    document.removeEventListener('selectionchange', this.listener);
    document.addEventListener('selectionchange', this.listener);
  }

  clear(): void {
    clearTimeout(this.timer);
    this.token++;
    window.getSelection()?.removeAllRanges();
    this._pending.set(null);
    this._active.set(false);
  }

  ngOnDestroy(): void {
    document.removeEventListener('selectionchange', this.listener);
    clearTimeout(this.timer);
    this.token++;
  }

  private onChange(): void {
    const sel = window.getSelection();
    const live = !!sel && !sel.isCollapsed && sel.rangeCount > 0;
    const range = live ? sel.getRangeAt(0) : null;
    // Gestures check `active` straight away; only the (async) anchor is debounced.
    this._active.set(!!range && (!!layerOf(range.startContainer) || !!layerOf(range.endContainer)));
    clearTimeout(this.timer);
    const token = ++this.token;
    if (!range || !this._active()) {
      this._pending.set(null);
      return;
    }
    this.timer = setTimeout(() => void this.publish(range, token), DEBOUNCE_MS);
  }

  private async publish(range: Range, token: number): Promise<void> {
    const layer = layerOf(range.startContainer);
    if (!this.opts || !layer || layer !== layerOf(range.endContainer)) {
      this._pending.set(null);
      return;
    }
    let start = caretOf(layer, range.startContainer, range.startOffset, 'start');
    let end = caretOf(layer, range.endContainer, range.endOffset, 'end');
    const page = Number(layer.dataset['page']);
    if (!start || !end || !Number.isFinite(page)) {
      this._pending.set(null);
      return;
    }
    if (compareCaret(start, end) > 0) [start, end] = [end, start];
    let items: TextItem[];
    try {
      items = await this.opts.items(page);
    } catch {
      return;
    }
    if (token !== this.token) return;
    const quote = quoteOf(items, start, end);
    if (quote === '') {
      this._pending.set(null);
      return;
    }
    const rect =
      typeof range.getBoundingClientRect === 'function'
        ? range.getBoundingClientRect()
        : ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 } as DOMRect);
    this._pending.set({ page, start, end, quote, rect, source: 'page' });
  }
}

/**
 * Selects the word at a viewport point inside a text layer (a tap on text).
 * Uses Selection.modify where the browser has it, else expands to whitespace boundaries.
 */
export function selectWordAt(x: number, y: number): void {
  const sel = window.getSelection();
  if (!sel) return;
  let node: Node | null = null;
  let offset = 0;
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y);
    if (p) [node, offset] = [p.offsetNode, p.offset];
  } else if (doc.caretRangeFromPoint) {
    const r = doc.caretRangeFromPoint(x, y);
    if (r) [node, offset] = [r.startContainer, r.startOffset];
  }
  if (!node || node.nodeType !== Node.TEXT_NODE || !layerOf(node)) return;
  sel.collapse(node, offset);
  const modify = (sel as Selection & { modify?: (a: string, d: string, g: string) => void }).modify;
  if (typeof modify === 'function') {
    sel.modify('move', 'backward', 'word');
    sel.modify('extend', 'forward', 'word');
    if (sel.toString().trim() !== '') return;
  }
  const text = node.textContent ?? '';
  let from = offset;
  let to = offset;
  while (from > 0 && !/\s/.test(text[from - 1])) from--;
  while (to < text.length && !/\s/.test(text[to])) to++;
  if (to > from) sel.setBaseAndExtent(node, from, node, to);
}
