import { describe, expect, it, vi } from 'vitest';
import type { PageRenderer } from './pdf-session';
import { SearchService, type SearchHit } from './search.service';

function renderer(pages: string[]) {
  const pageText = vi.fn(async (p: number) => pages[p - 1]);
  const r = { numPages: pages.length, pageText } as unknown as PageRenderer;
  return { r, pageText };
}

const PAGES = ['The origin of species', 'nothing', '', 'Species and origin'];

async function run(pages: string[], query: string, o: { max?: number; abortAfterHits?: number } = {}) {
  const { r, pageText } = renderer(pages);
  const ctl = new AbortController();
  const hits: SearchHit[] = [];
  const progress: [number, number][] = [];
  const result = await new SearchService().search(r, query, {
    max: o.max,
    signal: ctl.signal,
    onProgress: (d, t) => progress.push([d, t]),
    onHit: (h) => {
      hits.push(h);
      if (o.abortAfterHits && hits.length >= o.abortAfterHits) ctl.abort();
    },
  });
  return { hits, progress, result, pageText };
}

describe('SearchService', () => {
  it('finds hits across pages, skipping a page with no text', async () => {
    const { hits, progress, result } = await run(PAGES, 'species');
    expect(hits.map((h) => h.page)).toEqual([1, 4]);
    expect(hits[0].match.toLowerCase()).toBe('species');
    expect(hits[0].before).toContain('origin of');
    expect(progress[progress.length - 1]).toEqual([4, 4]);
    expect(result.capped).toBe(false);
  });

  it('ignores a query shorter than two characters', async () => {
    const { hits, pageText } = await run(PAGES, 'x');
    expect(hits).toEqual([]);
    expect(pageText).not.toHaveBeenCalled();
  });

  it('stops at max and reports capped', async () => {
    const { hits, result } = await run(PAGES, 'species', { max: 1 });
    expect(hits).toHaveLength(1);
    expect(result.capped).toBe(true);
  });

  it('stops reading pages once aborted', async () => {
    const { pageText } = await run(PAGES, 'species', { abortAfterHits: 1 });
    expect(pageText).toHaveBeenCalledTimes(1);
  });

  it('finds Arabic text regardless of diacritics', async () => {
    const { hits } = await run(['قال مُحَمَّد اليوم'], 'محمد');
    expect(hits).toHaveLength(1);
    expect(hits[0].match).toBe('مُحَمَّد');
  });

  it('skips a page whose text fails to load', async () => {
    const { r } = renderer(PAGES);
    r.pageText = vi.fn(async (p: number) => {
      if (p === 1) throw new Error('boom');
      return PAGES[p - 1];
    });
    const hits: SearchHit[] = [];
    await new SearchService().search(r, 'species', { signal: new AbortController().signal, onProgress: () => undefined, onHit: (h) => hits.push(h) });
    expect(hits.map((h) => h.page)).toEqual([4]);
  });
});
