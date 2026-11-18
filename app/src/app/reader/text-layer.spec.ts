import { alignSpans } from './text-layer';

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
