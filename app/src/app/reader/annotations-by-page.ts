import type { Annotation } from '../core/models';

/** Annotations grouped by page, so each page view gets a stable array until its own annotations change. */
export function annotationsByPage(anns: Annotation[]): Map<number, Annotation[]> {
  const map = new Map<number, Annotation[]>();
  for (const a of anns) {
    const page = a.type === 'highlight' || a.type === 'note' ? a.text?.page : a.type === 'area' ? a.page : undefined;
    if (page === undefined) continue;
    const list = map.get(page);
    if (list) list.push(a);
    else map.set(page, [a]);
  }
  return map;
}
