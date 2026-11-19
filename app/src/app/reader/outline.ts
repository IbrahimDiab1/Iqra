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

/**
 * The pages a node covers: from its own page to the page before the next node at the same or a higher
 * level (a shallower depth), or to the last page when there is none.
 */
export function nodeRange(outline: OutlineNode[], key: string, pageCount: number): { fromPage: number; toPage: number } {
  const flat = flattenOutline(outline);
  const at = flat.findIndex((e) => e.node.key === key);
  if (at < 0) return { fromPage: 1, toPage: pageCount };
  const { node, depth } = flat[at];
  const next = flat.slice(at + 1).find((e) => e.depth <= depth);
  const toPage = next ? Math.max(node.page, next.node.page - 1) : Math.max(node.page, pageCount);
  return { fromPage: node.page, toPage };
}

/** The deepest node whose range contains `page`; later nodes win ties. Null before the first node. */
export function chapterAt(outline: OutlineNode[], page: number): OutlineNode | null {
  let best: { node: OutlineNode; depth: number } | null = null;
  for (const e of flattenOutline(outline)) {
    const { fromPage, toPage } = nodeRange(outline, e.node.key, Number.POSITIVE_INFINITY);
    if (page < fromPage || page > toPage) continue;
    if (best === null || e.depth >= best.depth) best = e;
  }
  return best?.node ?? null;
}

/** The title of the top-level chapter that contains `page`. */
export function chapterTitleAt(nodes: OutlineNode[], page: number): string | null {
  return chapterAt(nodes.map((n) => ({ ...n, children: [] })), page)?.title ?? null;
}
