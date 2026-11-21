import { applyReadingOrder, selectedLayerText, tagSpans, textLayerSource } from './text-layer';

function span(text: string): HTMLElement {
  const s = document.createElement('span');
  s.textContent = text;
  return s;
}

describe('textLayerSource', () => {
  const item = (str: string, extra: object = {}) => ({ str, transform: [1, 0, 0, 1, 0, 0], width: 1, height: 1, fontName: 'f', dir: 'rtl', ...extra });

  it('leaves out the space-only items and says which items it kept', () => {
    const content = { items: [item('كلمة'), item(' '), item('أخرى'), item('  '), item('ثالثة')], styles: {}, lang: null };
    const out = textLayerSource(content);
    expect(out.content.items.map((i) => i.str)).toEqual(['كلمة', 'أخرى', 'ثالثة']);
    expect(out.kept).toEqual([0, 2, 4]);
  });

  it('keeps an item that only ends a line (it carries the line break) and every item with letters', () => {
    const content = { items: [item('a'), item(' ', { hasEOL: true }), item(''), item('', { hasEOL: true }), item('b')], styles: {}, lang: 'ar' };
    const out = textLayerSource(content);
    expect(out.kept).toEqual([0, 1, 2, 3, 4]);
    expect(out.content.lang).toBe('ar');
  });

  it('passes the styles along untouched', () => {
    const styles = { f: { fontFamily: 'sans-serif', ascent: 1, descent: 0, vertical: false } };
    expect(textLayerSource({ items: [item('x')], styles, lang: null }).content.styles).toBe(styles);
  });
});

describe('tagSpans', () => {
  it('tags each span with the pdf.js item index it shows', () => {
    const spans = [span('A'), span('B'), span('C')];
    tagSpans(spans, [0, 2, 5]);
    expect(spans.map((s) => s.dataset['item'])).toEqual(['0', '2', '5']);
  });

  it('never throws when there are more spans than kept items', () => {
    const spans = [span('A'), span('B')];
    expect(() => tagSpans(spans, [3])).not.toThrow();
    expect(spans.map((s) => s.dataset['item'])).toEqual(['3', undefined]);
  });
});

describe('applyReadingOrder', () => {
  /** A layer of spans tagged with their pdf.js item index, with a <br> after the span at `brAfter`. */
  function layer(texts: string[], brAfter: number[] = []) {
    const container = document.createElement('div');
    const spans = texts.map((t, i) => {
      const s = span(t);
      s.dataset['item'] = String(i);
      container.append(s);
      if (brAfter.includes(i)) container.append(document.createElement('br'));
      return s;
    });
    return { container, spans };
  }
  const shown = (c: HTMLElement) => Array.from(c.children).map((e) => (e.tagName === 'BR' ? '|' : `${e.textContent}#${(e as HTMLElement).dataset['item']}`));

  it('moves the spans of a reordered line into reading order and renumbers them', () => {
    const { container, spans } = layer(['w3', ' ', 'w2', ' ', 'w1'], [4]);
    applyReadingOrder(container, spans, [4, 3, 2, 1, 0]);
    expect(shown(container)).toEqual(['w1#0', ' #1', 'w2#2', ' #3', 'w3#4', '|']);
  });

  it('keeps each line break after its own line', () => {
    const { container, spans } = layer(['a', 'b', 'c', 'd'], [1, 3]);
    applyReadingOrder(container, spans, [1, 0, 3, 2]);
    expect(shown(container)).toEqual(['b#0', 'a#1', '|', 'd#2', 'c#3', '|']);
  });

  it('skips the empty items a layer has no span for', () => {
    const { container, spans } = layer(['x', 'y']);
    spans[0].dataset['item'] = '0';
    spans[1].dataset['item'] = '2';
    applyReadingOrder(container, spans, [2, 1, 0]);
    expect(shown(container)).toEqual(['y#0', 'x#2']);
  });

  it('does nothing for the identity order', () => {
    const { container, spans } = layer(['a', 'b'], [1]);
    const before = Array.from(container.children);
    applyReadingOrder(container, spans, [0, 1]);
    expect(Array.from(container.children)).toEqual(before);
    expect(shown(container)).toEqual(['a#0', 'b#1', '|']);
  });

  it('renumbers but leaves the DOM alone when the layer has wrapper elements', () => {
    const container = document.createElement('div');
    const wrap = document.createElement('div');
    const a = span('a');
    const b = span('b');
    a.dataset['item'] = '0';
    b.dataset['item'] = '1';
    wrap.append(a, b);
    container.append(wrap);
    applyReadingOrder(container, [a, b], [1, 0]);
    expect([a.dataset['item'], b.dataset['item']]).toEqual(['1', '0']);
    expect(Array.from(wrap.children)).toEqual([a, b]);
  });
});

describe('selectedLayerText', () => {
  function layer(words: string[]) {
    const root = document.createElement('div');
    words.forEach((w, i) => {
      const s = span(w);
      s.dataset['item'] = String(i * 2);
      root.append(s);
    });
    document.body.append(root);
    return root;
  }

  it('joins the selected words with one space, as the layer has no span for the gap', () => {
    const root = layer(['alpha', 'beta', 'gamma', 'delta']);
    const spans = root.querySelectorAll('span');
    const range = document.createRange();
    range.setStart(spans[0].firstChild!, 2);
    range.setEnd(spans[2].firstChild!, 3);
    expect(selectedLayerText(root, range)).toBe('pha beta gam');
    root.remove();
  });

  it('is empty for a collapsed selection', () => {
    const root = layer(['alpha', 'beta']);
    const range = document.createRange();
    range.setStart(root.querySelector('span')!.firstChild!, 1);
    range.collapse(true);
    expect(selectedLayerText(root, range)).toBe('');
    root.remove();
  });
});
