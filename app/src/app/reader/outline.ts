import type { OutlineNode } from '../core/models';

/** The outline in reading order, with each node's depth (top level = 0). */
export function flattenOutline(nodes: OutlineNode[]): { node: OutlineNode; depth: number }[] {
  const out: { node: OutlineNode; depth: number }[] = [];
  const walk = (list: OutlineNode[], depth: number) => {
    for (const node of list) {
      out.push({ node, depth });
      walk(node.children, depth + 1);
    }
  };
  walk(nodes, 0);
  return out;
}

interface Layout {
  flat: { node: OutlineNode; depth: number }[];
  /** For each flat index, the index of the next node at the same or a shallower depth (or -1). */
  next: number[];
  index: Map<string, number>;
}
const layouts = new WeakMap<OutlineNode[], Layout>();

/** The flattened outline with each node's range end, computed once per outline array. */
function layoutOf(outline: OutlineNode[]): Layout {
  let l = layouts.get(outline);
  if (l) return l;
  const flat = flattenOutline(outline);
  const next: number[] = new Array(flat.length).fill(-1);
  const lastAt: number[] = [];
  for (let i = flat.length - 1; i >= 0; i--) {
    const d = flat[i].depth;
    let best = -1;
    for (let k = 0; k <= d; k++) {
      const j = lastAt[k];
      if (j !== undefined && (best < 0 || j < best)) best = j;
    }
    next[i] = best;
    lastAt[d] = i;
    lastAt.length = d + 1;
  }
  l = { flat, next, index: new Map(flat.map((e, i) => [e.node.key, i])) };
  layouts.set(outline, l);
  return l;
}

/**
 * The pages a node covers: from its own page to the page before the next node at the same or a higher
 * level (a shallower depth), or to the last page when there is none.
 */
export function nodeRange(outline: OutlineNode[], key: string, pageCount: number): { fromPage: number; toPage: number } {
  const l = layoutOf(outline);
  const at = l.index.get(key);
  if (at === undefined) return { fromPage: 1, toPage: pageCount };
  const { node } = l.flat[at];
  const n = l.next[at];
  const toPage = n >= 0 ? Math.max(node.page, l.flat[n].node.page - 1) : Math.max(node.page, pageCount);
  return { fromPage: node.page, toPage };
}

/** The deepest node whose range contains `page`; later nodes win ties. Null before the first node. */
export function chapterAt(outline: OutlineNode[], page: number): OutlineNode | null {
  const l = layoutOf(outline);
  let best = -1;
  for (let i = 0; i < l.flat.length; i++) {
    const from = l.flat[i].node.page;
    const n = l.next[i];
    const to = n >= 0 ? Math.max(from, l.flat[n].node.page - 1) : Number.POSITIVE_INFINITY;
    if (page < from || page > to) continue;
    if (best < 0 || l.flat[i].depth >= l.flat[best].depth) best = i;
  }
  return best >= 0 ? l.flat[best].node : null;
}

const tops = new WeakMap<OutlineNode[], OutlineNode[]>();
function topLevel(nodes: OutlineNode[]): OutlineNode[] {
  let t = tops.get(nodes);
  if (!t) tops.set(nodes, (t = nodes.map((n) => ({ ...n, children: [] }))));
  return t;
}

/** The title of the top-level chapter that contains `page`. */
export function chapterTitleAt(nodes: OutlineNode[], page: number): string | null {
  return chapterAt(topLevel(nodes), page)?.title ?? null;
}

/** The deepest section under the top-level chapter at `page`; null when the chapter itself is the deepest node. */
export function sectionTitleAt(nodes: OutlineNode[], page: number): string | null {
  const deepest = chapterAt(nodes, page);
  const top = chapterAt(topLevel(nodes), page);
  return deepest && top && deepest.key !== top.key ? deepest.title : null;
}
