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

/** The title of the top-level chapter that contains `page`: the node with the greatest page not after it. */
export function chapterTitleAt(nodes: OutlineNode[], page: number): string | null {
  let best: OutlineNode | null = null;
  for (const node of nodes) {
    if (node.page <= page && (best === null || node.page > best.page)) best = node;
  }
  return best?.title ?? null;
}
