import { describe, expect, it } from 'vitest';
import type { Annotation, SummaryScope } from '../core/models';
import { COPY } from '../ui/copy';
import { findSummary, scopeLabel } from './summary-scope';

function summary(id: string, scope: SummaryScope, deleted = false): Annotation {
  return { id, bookId: 'b', type: 'summary', scope, tags: [], createdAt: 1, updatedAt: 1, deviceId: 'd', ...(deleted ? { deleted: true } : {}) };
}

describe('scopeLabel', () => {
  it('names the book, the chapter, and a page span', () => {
    expect(scopeLabel({ kind: 'book' })).toBe(COPY.annotations.bookSummary);
    expect(scopeLabel({ kind: 'outline', nodeKey: '0', title: 'Intro', fromPage: 1, toPage: 9 })).toBe('Intro');
    expect(scopeLabel({ kind: 'pages', fromPage: 3, toPage: 8 })).toBe('p. 3–8');
  });
});

describe('findSummary', () => {
  const book = summary('book', { kind: 'book' });
  const ch0 = summary('ch0', { kind: 'outline', nodeKey: '0', title: 'Intro', fromPage: 1, toPage: 9 });
  const ch1 = summary('ch1', { kind: 'outline', nodeKey: '1', title: 'Two', fromPage: 10, toPage: 20 });
  const range = summary('range', { kind: 'pages', fromPage: 3, toPage: 8 });
  const all = [book, ch0, ch1, range];

  it('matches by scope identity', () => {
    expect(findSummary(all, { kind: 'book' })?.id).toBe('book');
    expect(findSummary(all, { kind: 'outline', nodeKey: '1', title: 'Two', fromPage: 10, toPage: 20 })?.id).toBe('ch1');
    expect(findSummary(all, { kind: 'pages', fromPage: 3, toPage: 8 })?.id).toBe('range');
    expect(findSummary(all, { kind: 'pages', fromPage: 3, toPage: 9 })).toBeUndefined();
    expect(findSummary(all, { kind: 'outline', nodeKey: '5', title: 'x', fromPage: 1, toPage: 2 })).toBeUndefined();
  });

  it('ignores deleted summaries and other annotation types', () => {
    expect(findSummary([summary('gone', { kind: 'book' }, true)], { kind: 'book' })).toBeUndefined();
    expect(findSummary([{ ...book, type: 'side-note' }], { kind: 'book' })).toBeUndefined();
  });
});
