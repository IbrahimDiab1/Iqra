import type { Annotation, SummaryScope } from '../core/models';
import { COPY } from '../ui/copy';

/** A short name for what a summary covers: the book, a chapter title, or its page span. */
export function scopeLabel(scope: SummaryScope): string {
  if (scope.kind === 'book') return COPY.annotations.bookSummary;
  if (scope.kind === 'outline') return scope.title;
  return COPY.annotations.pageRange(scope.fromPage, scope.toPage);
}

/** The live summary that covers exactly this scope, if there is one. */
export function findSummary(anns: Annotation[], scope: SummaryScope): Annotation | undefined {
  return anns.find((a) => {
    const s = a.scope;
    if (a.deleted || a.type !== 'summary' || !s || s.kind !== scope.kind) return false;
    if (s.kind === 'outline' && scope.kind === 'outline') return s.nodeKey === scope.nodeKey;
    if (s.kind === 'pages' && scope.kind === 'pages') return s.fromPage === scope.fromPage && s.toPage === scope.toPage;
    return true;
  });
}
