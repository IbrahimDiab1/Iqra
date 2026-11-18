import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { compareCaret, locateQuote, quoteOf, type Caret } from '../annotations/anchor';
import { COPY } from '../ui/copy';
import { ToastService } from '../ui/toast.service';
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

/** The reading-mode article a node sits in, or null. */
function articleOf(node: Node | null): HTMLElement | null {
  const el = node instanceof Element ? node : (node?.parentElement ?? null);
  return el?.closest<HTMLElement>('.reflow-article') ?? null;
}

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * How many times the collapsed quote already occurs (non-overlapping, left to right) in the article's text
 * before the selection start: the `nth` for locateQuote. Null when the start is not inside a paragraph.
 */
function occurrencesBefore(article: HTMLElement, range: Range, quote: string): number | null {
  const paragraphs = Array.from(article.querySelectorAll('p'));
  const startEl = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
  const para = startEl?.closest('p');
  const index = para ? paragraphs.indexOf(para) : -1;
  if (!para || index < 0) return null;
  const head = document.createRange();
  head.setStart(para, 0);
  head.setEnd(range.startContainer, range.startOffset);
  const before = collapse([...paragraphs.slice(0, index).map((p) => p.textContent ?? ''), head.toString()].join(' '));
  let count = 0;
  for (let from = 0; ; count++) {
    const at = before.indexOf(quote, from);
    if (at < 0) return count;
    from = at + quote.length;
  }
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

  private readonly toast = inject(ToastService);
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
    const inside = (n: Node) => !!layerOf(n) || !!articleOf(n);
    this._active.set(!!range && (inside(range.startContainer) || inside(range.endContainer)));
    clearTimeout(this.timer);
    const token = ++this.token;
    if (!range || !this._active()) {
      this._pending.set(null);
      return;
    }
    this.timer = setTimeout(() => void this.publish(range, token), DEBOUNCE_MS);
  }

  private async publish(range: Range, token: number): Promise<void> {
    const article = articleOf(range.startContainer);
    if (article) {
      await this.publishReflow(range, token, article);
      return;
    }
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

  /** A selection in reading mode: the quote is the selected text, located in the page's items. */
  private async publishReflow(range: Range, token: number, article: HTMLElement): Promise<void> {
    const page = Number(article.dataset['page']);
    const quote = collapse(range.toString());
    if (!this.opts || article !== articleOf(range.endContainer) || !Number.isFinite(page) || quote === '') {
      this._pending.set(null);
      return;
    }
    let items: TextItem[];
    try {
      items = await this.opts.items(page);
    } catch {
      return;
    }
    if (token !== this.token) return;
    const nth = occurrencesBefore(article, range, quote);
    const found = nth === null ? null : locateQuote(items, quote, nth);
    if (!found) {
      this._pending.set(null);
      this.toast.show(COPY.annotations.cantAnchor);
      return;
    }
    const rect =
      typeof range.getBoundingClientRect === 'function'
        ? range.getBoundingClientRect()
        : ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 } as DOMRect);
    this._pending.set({ page, start: found.start, end: found.end, quote, rect, source: 'reflow' });
  }
}

/** The [start, end) of the word at `offset` in `text`: the word containing it, or the one ending exactly there. */
export function wordBounds(text: string, offset: number): [number, number] | null {
  const words: [number, number][] = [];
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    for (const seg of new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text)) {
      if (seg.isWordLike) words.push([seg.index, seg.index + seg.segment.length]);
    }
  } else {
    for (const m of text.matchAll(/\S+/g)) words.push([m.index, m.index + m[0].length]);
  }
  return words.find(([a, b]) => offset >= a && offset < b) ?? words.find(([, b]) => offset === b) ?? null;
}

/** Selects the word around `offset` in a text node of a text layer. */
export function selectWordIn(node: Node, offset: number): void {
  const sel = window.getSelection();
  if (!sel || node.nodeType !== Node.TEXT_NODE || !layerOf(node)) return;
  const bounds = wordBounds(node.textContent ?? '', offset);
  if (bounds) sel.setBaseAndExtent(node, bounds[0], node, bounds[1]);
}

/** Selects the word at a viewport point inside a text layer (a tap on text). */
export function selectWordAt(x: number, y: number): void {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (doc.caretPositionFromPoint) {
    const p = doc.caretPositionFromPoint(x, y);
    if (p) selectWordIn(p.offsetNode, p.offset);
  } else if (doc.caretRangeFromPoint) {
    const r = doc.caretRangeFromPoint(x, y);
    if (r) selectWordIn(r.startContainer, r.startOffset);
  }
}
