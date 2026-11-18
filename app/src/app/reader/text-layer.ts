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
