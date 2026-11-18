import type { OutlineNode } from '../core/models';
import { chapterTitleAt, flattenOutline } from './outline';

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
