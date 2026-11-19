import type { OutlineNode } from '../core/models';
import { chapterAt, chapterTitleAt, flattenOutline, nodeRange, sectionTitleAt } from './outline';

function node(key: string, title: string, page: number, children: OutlineNode[] = []): OutlineNode {
  return { key, title, page, children };
}

const outline: OutlineNode[] = [
  node('0', 'Intro', 1),
  node('1', 'Chapter One', 20, [node('1.0', 'Section A', 22), node('1.1', 'Section B', 30)]),
  node('2', 'Chapter Two', 50),
];

describe('flattenOutline', () => {
  it('returns nodes depth-first with depth numbers, top level at 0', () => {
    const flat = flattenOutline(outline).map((e) => [e.node.key, e.depth]);
    expect(flat).toEqual([
      ['0', 0],
      ['1', 0],
      ['1.0', 1],
      ['1.1', 1],
      ['2', 0],
    ]);
  });

  it('returns an empty list for an empty outline', () => {
    expect(flattenOutline([])).toEqual([]);
  });
});

describe('chapterTitleAt', () => {
  it('returns the top-level node with the greatest page not after the given page', () => {
    expect(chapterTitleAt(outline, 19)).toBe('Intro');
    expect(chapterTitleAt(outline, 20)).toBe('Chapter One');
    expect(chapterTitleAt(outline, 60)).toBe('Chapter Two');
  });

  it('returns null before the first node', () => {
    expect(chapterTitleAt(outline, 0)).toBeNull();
    expect(chapterTitleAt([], 5)).toBeNull();
  });
});

describe('nodeRange and chapterAt', () => {
  const o: OutlineNode[] = [node('0', 'One', 1, [node('0.0', 'One A', 3)]), node('1', 'Two', 10)];

  it('a node runs to the page before the next node at its level or higher, else to the end', () => {
    expect(nodeRange(o, '0', 20)).toEqual({ fromPage: 1, toPage: 9 });
    expect(nodeRange(o, '0.0', 20)).toEqual({ fromPage: 3, toPage: 9 });
    expect(nodeRange(o, '1', 20)).toEqual({ fromPage: 10, toPage: 20 });
  });

  it('chapterAt finds the deepest node containing the page', () => {
    expect(chapterAt(o, 5)?.key).toBe('0.0');
    expect(chapterAt(o, 2)?.key).toBe('0');
    expect(chapterAt(o, 12)?.key).toBe('1');
    expect(chapterAt([], 1)).toBeNull();
  });
});

describe('sectionTitleAt', () => {
  const o: OutlineNode[] = [node('0', 'One', 1, [node('0.0', 'One A', 3, [node('0.0.0', 'One A i', 4)])]), node('1', 'Two', 10)];

  it('is the deepest section under the top-level chapter', () => {
    expect(sectionTitleAt(o, 4)).toBe('One A i');
    expect(sectionTitleAt(o, 3)).toBe('One A');
  });

  it('is null when the chapter itself is the deepest node, or before the first node', () => {
    expect(sectionTitleAt(o, 2)).toBeNull();
    expect(sectionTitleAt(o, 12)).toBeNull();
    expect(sectionTitleAt(o, 0)).toBeNull();
  });
});
