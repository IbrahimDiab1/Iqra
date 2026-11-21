import type { TextItem } from './text';

/** The pdf.js text content of a page as the reader keeps it: text items only, plus what the text layer needs to size them. */
export interface PdfTextContent {
  items: (TextItem & { fontName?: string; dir?: string })[];
  styles: Record<string, { fontFamily: string; ascent: number; descent: number; vertical: boolean }>;
  lang: string | null | undefined;
}

/**
 * What the text layer is built from. A dense Arabic page has a text item for every word *and* one for every space between
 * words; the spaces are invisible, hold no letters and are never the target of a selection, yet each costs a styled, absolutely
 * positioned span. They are left out, except one that ends a line (it carries the line break). `kept[k]` is the index in
 * `items` of the k-th item given to the layer, so spans can be tagged with the item they show.
 */
export function textLayerSource(content: PdfTextContent): { content: PdfTextContent; kept: number[] } {
  const items: PdfTextContent['items'] = [];
  const kept: number[] = [];
  content.items.forEach((it, i) => {
    if (it.str !== '' && it.str.trim() === '' && !it.hasEOL) return;
    items.push(it);
    kept.push(i);
  });
  return { content: { items, styles: content.styles, lang: content.lang }, kept };
}

/**
 * Tags each pdf.js text-layer span with `data-item`, the index of the text item it shows.
 *
 * pdf.js's `TextLayer.textDivs` holds one element per item it was given, including the empty items it emits
 * for line ends (those are never attached to the DOM): the nth div is the nth kept item.
 * A mismatch tags what it can and never throws.
 */
export function tagSpans(spans: HTMLElement[], kept: number[]): void {
  for (let k = 0; k < spans.length && k < kept.length; k++) spans[k].dataset['item'] = String(kept[k]);
}

/**
 * Puts a text layer's spans in reading order: `order[new] = old` over the pdf.js item indexes `tagSpans` tagged.
 * Spans are renumbered to their new index and moved within the layer; each line break (`<br>`) stays after its own
 * line. When the layer is not a flat run of spans and breaks, only the renumbering is done.
 */
export function applyReadingOrder(container: HTMLElement, spans: HTMLElement[], order: number[]): void {
  if (order.every((old, i) => old === i)) return;
  const newIndex = new Map<number, number>();
  order.forEach((old, i) => newIndex.set(old, i));
  for (const span of spans) {
    const old = Number(span.dataset['item']);
    const next = newIndex.get(old);
    if (Number.isFinite(old) && next !== undefined) span.dataset['item'] = String(next);
  }
  const slots: { span: HTMLElement; br: Element | null }[] = [];
  for (let child = container.firstElementChild; child; ) {
    if (!(child instanceof HTMLElement) || child.tagName !== 'SPAN' || child.dataset['item'] === undefined) return;
    const after = child.nextElementSibling;
    const br = after?.tagName === 'BR' ? after : null;
    slots.push({ span: child, br });
    child = (br ?? child).nextElementSibling;
  }
  const sorted = slots.map((s) => s.span).sort((a, b) => Number(a.dataset['item']) - Number(b.dataset['item']));
  container.replaceChildren(...sorted.flatMap((span, k) => (slots[k].br ? [span, slots[k].br!] : [span])));
}

/**
 * The text a selection covers in a text layer, with a space between words. The layer has no span for the space between two
 * words, so the browser's own copy would run them together; this joins the selected part of each word's span with one space.
 */
export function selectedLayerText(layer: HTMLElement, range: Range): string {
  const parts: string[] = [];
  for (const span of Array.from(layer.querySelectorAll<HTMLElement>('span[data-item]'))) {
    if (!range.intersectsNode(span)) continue;
    let text = span.textContent ?? '';
    const node = span.firstChild;
    if (node && node === range.endContainer) text = text.slice(0, range.endOffset);
    if (node && node === range.startContainer) text = text.slice(range.startOffset);
    if (text !== '') parts.push(text);
  }
  return parts.join(' ');
}
