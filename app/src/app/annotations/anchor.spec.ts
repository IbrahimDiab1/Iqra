import type { Annotation, Rect, TextAnchor } from '../core/models';
import type { TextItem } from '../reader/text';
import {
  anchorsOverlap,
  buildAnchor,
  compareCaret,
  hasDetail,
  hitTest,
  locateQuote,
  quoteOf,
  rectsFromItems,
  unionAnchor,
} from './anchor';

const A: TextItem = { str: 'Hello world', transform: [12, 0, 0, 12, 100, 700], width: 110, height: 12 };
const B: TextItem = { str: 'second line', transform: [12, 0, 0, 12, 100, 680], width: 100, height: 12, hasEOL: true };
const SIZE = { widthPt: 600, heightPt: 800 };

function ann(partial: Partial<Annotation> & Pick<Annotation, 'type'>): Annotation {
  return {
    id: crypto.randomUUID(),
    bookId: 'b1',
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    deviceId: 'd1',
    ...partial,
  };
}

function anchorAt(page: number, startItem: number, startOffset: number, endItem: number, endOffset: number): TextAnchor {
  return {
    page,
    start: { item: startItem, offset: startOffset },
    end: { item: endItem, offset: endOffset },
    rects: [],
    quote: '',
  };
}

describe('compareCaret', () => {
  it('orders by item, then offset', () => {
    expect(compareCaret({ item: 0, offset: 5 }, { item: 1, offset: 0 })).toBeLessThan(0);
    expect(compareCaret({ item: 1, offset: 2 }, { item: 1, offset: 2 })).toBe(0);
    expect(compareCaret({ item: 1, offset: 3 }, { item: 1, offset: 2 })).toBeGreaterThan(0);
  });
});

describe('quoteOf', () => {
  it('joins pieces across two items', () => {
    expect(quoteOf([A, B], { item: 0, offset: 6 }, { item: 1, offset: 6 })).toBe('world second');
  });

  it('collapses whitespace and trims', () => {
    expect(quoteOf([{ ...A, str: '  a   b  ' }], { item: 0, offset: 0 }, { item: 0, offset: 9 })).toBe('a b');
  });
});

describe('locateQuote', () => {
  it('finds the second occurrence with nth=1', () => {
    const items: TextItem[] = [
      { ...A, str: 'a b' },
      { ...B, str: 'a b' },
    ];
    expect(locateQuote(items, 'a b', 0)).toEqual({
      start: { item: 0, offset: 0 },
      end: { item: 0, offset: 3 },
    });
    expect(locateQuote(items, 'a b', 1)).toEqual({
      start: { item: 1, offset: 0 },
      end: { item: 1, offset: 3 },
    });
    expect(locateQuote(items, 'a b', 2)).toBeNull();
  });

  it('ignores whitespace differences and returns null when absent', () => {
    const plain = locateQuote([A, B], 'Hello world');
    expect(locateQuote([A, B], 'Hello   world')).toEqual(plain);
    expect(plain).toEqual({ start: { item: 0, offset: 0 }, end: { item: 0, offset: 11 } });
    expect(locateQuote([A, B], 'missing text')).toBeNull();
  });

  it('matches across item boundaries', () => {
    expect(locateQuote([A, B], 'world second')).toEqual({
      start: { item: 0, offset: 6 },
      end: { item: 1, offset: 6 },
    });
  });

  it('keeps exact characters: case and marks must match', () => {
    expect(locateQuote([A], 'hello')).toBeNull();
  });
});

describe('rectsFromItems', () => {
  it('gives one rect for a full item', () => {
    const rects = rectsFromItems([A], { item: 0, offset: 0 }, { item: 0, offset: 11 }, SIZE);
    expect(rects).toHaveLength(1);
    expect(rects[0].x).toBeCloseTo(100 / 600);
    expect(rects[0].y).toBeCloseTo((800 - (700 + 12)) / 800);
    expect(rects[0].w).toBeCloseTo(110 / 600);
    expect(rects[0].h).toBeCloseTo(12 / 800);
  });

  it('takes the fraction of the width for half an item', () => {
    const [rect] = rectsFromItems([A], { item: 0, offset: 0 }, { item: 0, offset: 5 }, SIZE);
    expect(rect.x).toBeCloseTo(100 / 600);
    expect(rect.w).toBeCloseTo((110 * (5 / 11)) / 600);
  });

  it('measures Arabic from the right edge', () => {
    const arabic: TextItem = { str: 'مرحبا بالعالم', transform: [12, 0, 0, 12, 100, 700], width: 130, height: 12 };
    const [rect] = rectsFromItems([arabic], { item: 0, offset: 0 }, { item: 0, offset: 5 }, SIZE);
    expect(rect.x).toBeCloseTo((100 + 130 * (1 - 5 / 13)) / 600);
    expect(rect.w).toBeCloseTo((130 * (5 / 13)) / 600);
  });

  it('gives one rect per touched item across items', () => {
    const rects = rectsFromItems([A, B], { item: 0, offset: 6 }, { item: 1, offset: 6 }, SIZE);
    expect(rects).toHaveLength(2);
  });
});

describe('anchorsOverlap', () => {
  it('is true for touching ranges', () => {
    expect(anchorsOverlap(anchorAt(1, 0, 0, 0, 5), anchorAt(1, 0, 5, 0, 9))).toBe(true);
  });

  it('is false across pages and when disjoint', () => {
    expect(anchorsOverlap(anchorAt(1, 0, 0, 0, 5), anchorAt(2, 0, 0, 0, 5))).toBe(false);
    expect(anchorsOverlap(anchorAt(1, 0, 0, 0, 5), anchorAt(1, 0, 6, 0, 9))).toBe(false);
  });
});

describe('unionAnchor', () => {
  it('spans the min start to the max end and rebuilds the quote', () => {
    const a = buildAnchor([A, B], 3, { item: 0, offset: 0 }, { item: 0, offset: 5 }, SIZE);
    const b = buildAnchor([A, B], 3, { item: 0, offset: 6 }, { item: 1, offset: 6 }, SIZE);
    const u = unionAnchor(a, b, [A, B], SIZE);
    expect(u.page).toBe(3);
    expect(u.start).toEqual({ item: 0, offset: 0 });
    expect(u.end).toEqual({ item: 1, offset: 6 });
    expect(u.quote).toBe('Hello world second');
    expect(u.rects).toHaveLength(2);
  });
});

describe('hitTest', () => {
  const rectA: Rect = { x: 0.1, y: 0.1, w: 0.2, h: 0.05 };
  const rectB: Rect = { x: 0.1, y: 0.1, w: 0.2, h: 0.05 };

  it('picks the newest of two overlapping highlights', () => {
    const older = ann({
      type: 'highlight',
      page: 1,
      color: 'yellow',
      createdAt: 10,
      text: { page: 1, start: { item: 0, offset: 0 }, end: { item: 0, offset: 1 }, rects: [rectA], quote: 'a' },
    });
    const newer = ann({
      type: 'highlight',
      page: 1,
      color: 'pink',
      createdAt: 20,
      text: { page: 1, start: { item: 0, offset: 0 }, end: { item: 0, offset: 1 }, rects: [rectB], quote: 'a' },
    });
    expect(hitTest([older, newer], 1, 0.15, 0.12)).toBe(newer);
    expect(hitTest([newer, older], 1, 0.15, 0.12)).toBe(newer);
  });

  it('returns an area annotation for a point inside its rect', () => {
    const area = ann({ type: 'area', page: 2, color: 'blue', rect: { x: 0.5, y: 0.5, w: 0.3, h: 0.2 } });
    expect(hitTest([area], 2, 0.6, 0.6)).toBe(area);
  });

  it('returns null outside every rect or on another page', () => {
    const area = ann({ type: 'area', page: 2, color: 'blue', rect: { x: 0.5, y: 0.5, w: 0.3, h: 0.2 } });
    expect(hitTest([area], 2, 0.1, 0.1)).toBeNull();
    expect(hitTest([area], 3, 0.6, 0.6)).toBeNull();
  });
});

describe('hasDetail', () => {
  it('is false for an empty body and no tags', () => {
    expect(hasDetail(ann({ type: 'note', body: '', tags: [] }))).toBe(false);
    expect(hasDetail(ann({ type: 'note', tags: [] }))).toBe(false);
  });

  it('is true when a body or a tag is set', () => {
    expect(hasDetail(ann({ type: 'note', body: 'x', tags: [] }))).toBe(true);
    expect(hasDetail(ann({ type: 'note', body: '', tags: ['t'] }))).toBe(true);
  });
});
