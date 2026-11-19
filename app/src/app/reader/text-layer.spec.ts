import { alignSpans, applyReadingOrder } from './text-layer';

function span(text: string): HTMLElement {
  const s = document.createElement('span');
  s.textContent = text;
  return s;
}

describe('alignSpans', () => {
  it('tags spans with the index of their non-empty item when only those have spans', () => {
    const spans = [span('A'), span('B')];
    const out = alignSpans([{ str: 'A' }, { str: '' }, { str: 'B' }], spans);
    expect(out).toBe(spans);
    expect(spans.map((s) => s.dataset['item'])).toEqual(['0', '2']);
  });

  it('indexes straight through when pdf.js gave one div per item, empty ones included', () => {
    const spans = [span('A'), span(''), span('B')];
    alignSpans([{ str: 'A' }, { str: '' }, { str: 'B' }], spans);
    expect(spans.map((s) => s.dataset['item'])).toEqual(['0', '1', '2']);
  });

  it('tags by order and never throws when the counts match neither way', () => {
    const spans = [span('A'), span('B'), span('C'), span('D')];
    expect(() => alignSpans([{ str: 'A' }, { str: '' }, { str: 'B' }], spans)).not.toThrow();
    expect(spans.map((s) => s.dataset['item'])).toEqual(['0', '2', undefined, undefined]);
    const few = [span('A')];
    alignSpans([{ str: 'A' }, { str: 'B' }], few);
    expect(few[0].dataset['item']).toBe('0');
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
