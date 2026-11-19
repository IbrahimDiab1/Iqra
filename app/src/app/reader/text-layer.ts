/**
 * Tags each pdf.js text-layer span with `data-item`, the index of the text item it shows.
 *
 * pdf.js's `TextLayer.textDivs` holds one element per text item, including the empty items it emits
 * for line ends; those are never attached to the DOM. So when the counts agree the nth div is item n.
 * When they do not (another pdf.js build), fall back to one span per non-empty item, in order.
 * A mismatch tags what it can and never throws.
 */
export function alignSpans(items: { str: string }[], spans: HTMLElement[]): HTMLElement[] {
  if (spans.length === items.length) {
    spans.forEach((span, i) => (span.dataset['item'] = String(i)));
    return spans;
  }
  let s = 0;
  for (let i = 0; i < items.length && s < spans.length; i++) {
    if (items[i].str === '') continue;
    spans[s++].dataset['item'] = String(i);
  }
  return spans;
}

/**
 * Puts a text layer's spans in reading order: `order[new] = old` over the pdf.js item indexes `alignSpans` tagged.
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
