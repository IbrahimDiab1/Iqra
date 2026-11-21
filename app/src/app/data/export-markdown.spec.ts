import { describe, expect, it } from 'vitest';
import type { Annotation, Book } from '../core/models';
import { bookMarkdown, exportNotes, exportReview, reviewMarkdown, safeFileName } from './export-markdown';

function book(id: string, title: string, extra: Partial<Book> = {}): Book {
  return {
    id, deviceId: 'dev', updatedAt: 1, title, author: 'Frank Herbert', driveFileId: 'd', fileName: `${id}.pdf`, sizeBytes: 1,
    sha256: id, pageCount: 100, outline: [], language: 'en', direction: 'ltr', addedAt: 1, status: 'reading',
    categoryIds: [], tags: [], progressMode: 'last-page', pageMode: 'swipe', lastPageReached: 0, ...extra,
  };
}

function ann(id: string, bookId: string, type: Annotation['type'], extra: Partial<Annotation> = {}): Annotation {
  return { id, deviceId: 'dev', updatedAt: 1, bookId, type, tags: [], createdAt: 1, ...extra };
}

const anchor = (page: number, quote: string) => ({
  page, quote, start: { item: 0, offset: 0 }, end: { item: 0, offset: quote.length }, rects: [],
});

const decode = (b: Uint8Array) => new TextDecoder().decode(b);

describe('safeFileName', () => {
  it('turns forbidden characters into spaces, collapses and trims', () => {
    expect(safeFileName('a/b:c?', new Set())).toBe('a b c.md');
    expect(safeFileName('x\\y*z"w<v>u|t', new Set())).toBe('x y z w v u t.md');
    expect(safeFileName('a\u0000b\u001fc', new Set())).toBe('a b c.md');
  });

  it('trims leading and trailing dots and spaces', () => {
    expect(safeFileName('  ..Dune.. ', new Set())).toBe('Dune.md');
  });

  it('numbers duplicate titles', () => {
    const used = new Set<string>();
    expect(safeFileName('Dune', used)).toBe('Dune.md');
    expect(safeFileName('Dune', used)).toBe('Dune (2).md');
    expect(safeFileName('Dune', used)).toBe('Dune (3).md');
  });

  it('treats names that differ only by case as duplicates', () => {
    const used = new Set<string>();
    safeFileName('Dune', used);
    expect(safeFileName('DUNE', used)).toBe('DUNE (2).md');
  });

  it('truncates long titles to 80 characters before .md', () => {
    const name = safeFileName('x'.repeat(200), new Set());
    expect(name).toBe('x'.repeat(80) + '.md');
  });

  it('uses Untitled for empty or all-forbidden titles', () => {
    expect(safeFileName('', new Set())).toBe('Untitled.md');
    expect(safeFileName(' ?:* ', new Set())).toBe('Untitled.md');
    const used = new Set<string>();
    safeFileName('', used);
    expect(safeFileName('', used)).toBe('Untitled (2).md');
  });

  it('keeps Arabic titles', () => {
    expect(safeFileName('كتاب: الفقه', new Set())).toBe('كتاب الفقه.md');
  });
});

describe('bookMarkdown', () => {
  it('writes a highlight with its note and tags exactly', () => {
    const b = book('b1', 'Dune');
    const a = ann('a1', 'b1', 'highlight', { page: 5, color: 'yellow', text: anchor(5, 'Fear is the mind-killer.'), body: 'Litany against fear', tags: ['fear', 'litany'] });
    expect(bookMarkdown(b, [a])).toBe(
      '# Dune\n\n*Frank Herbert*\n\n## Highlights and notes\n\n### Page 5\n\n> Fear is the mind-killer.\n\nLitany against fear\n\n#fear #litany\n',
    );
  });

  it('keeps multi-line quotes inside the blockquote and writes Arabic as is', () => {
    const b = book('b1', 'كتاب', { author: '' });
    const a = ann('a1', 'b1', 'highlight', { page: 2, text: anchor(2, 'سطر أول\n\nسطر ثان') });
    expect(bookMarkdown(b, [a])).toBe('# كتاب\n\n## Highlights and notes\n\n### Page 2\n\n> سطر أول\n>\n> سطر ثان\n');
  });

  it('groups by page ascending and renders side notes and areas', () => {
    const b = book('b1', 'Dune');
    const list = [
      ann('a2', 'b1', 'side-note', { page: 9, body: 'Remember this', createdAt: 2 }),
      ann('a1', 'b1', 'area', { page: 3, rect: { x: 0, y: 0, w: 1, h: 1 }, body: 'A map' }),
      ann('a3', 'b1', 'note', { page: 9, text: anchor(9, 'quoted'), body: 'underlined', createdAt: 1 }),
    ];
    const md = bookMarkdown(b, list);
    expect(md.indexOf('### Page 3')).toBeLessThan(md.indexOf('### Page 9'));
    expect(md).toContain('*Area highlight on p. 3*\n\nA map');
    expect(md).toContain('**Side note (p. 9)** Remember this');
    expect(md.indexOf('> quoted')).toBeLessThan(md.indexOf('**Side note (p. 9)**'));
  });

  it('writes summaries with their scope label', () => {
    const b = book('b1', 'Dune');
    const list = [
      ann('s1', 'b1', 'summary', { scope: { kind: 'book' }, body: 'Whole book' }),
      ann('s2', 'b1', 'summary', { scope: { kind: 'outline', nodeKey: '1', title: 'Chapter One', fromPage: 1, toPage: 9 }, body: 'Ch1' }),
      ann('s3', 'b1', 'summary', { scope: { kind: 'pages', fromPage: 4, toPage: 8 }, body: 'Pages' }),
    ];
    const md = bookMarkdown(b, list);
    expect(md).toContain('## Summaries');
    expect(md).toContain('### Book\n\nWhole book');
    expect(md).toContain('### Chapter One\n\nCh1');
    expect(md).toContain('### p. 4–8\n\nPages');
    expect(md).not.toContain('## Highlights and notes');
  });

  it('lists bookmarks with their chapter, and can leave them out', () => {
    const b = book('b1', 'Dune', {
      outline: [
        { key: '0', title: 'Part 1', page: 1, children: [{ key: '0.0', title: 'Ch 1', page: 3, children: [] }] },
        { key: '1', title: 'Part 2', page: 50, children: [] },
      ],
    });
    const list = [ann('k1', 'b1', 'bookmark', { page: 4 }), ann('k2', 'b1', 'bookmark', { page: 60 })];
    const md = bookMarkdown(b, list);
    expect(md).toContain('## Bookmarks\n\n- p. 4 · Ch 1\n- p. 60 · Part 2\n');
    expect(bookMarkdown(b, list, false)).not.toContain('Bookmarks');
    expect(bookMarkdown(book('b2', 'X'), [ann('k3', 'b2', 'bookmark', { page: 1 })])).toContain('- p. 1\n');
  });

  it('excludes deleted records and other books', () => {
    const b = book('b1', 'Dune');
    const list = [
      ann('a1', 'b1', 'highlight', { page: 1, text: anchor(1, 'kept') }),
      ann('a2', 'b1', 'highlight', { page: 2, text: anchor(2, 'gone'), deleted: true }),
      ann('a3', 'other', 'highlight', { page: 3, text: anchor(3, 'elsewhere') }),
    ];
    const md = bookMarkdown(b, list);
    expect(md).toContain('kept');
    expect(md).not.toContain('gone');
    expect(md).not.toContain('elsewhere');
  });
});

describe('exportNotes', () => {
  it('exports only books with a non-bookmark annotation, sorted by title, with unique names', () => {
    const books = [book('b1', 'Zebra'), book('b2', 'Alpha'), book('b3', 'Alpha'), book('b4', 'Only bookmarks'), book('b5', 'No notes'), book('b6', 'Deleted', { deleted: true })];
    const anns = [
      ann('a1', 'b1', 'highlight', { page: 1, text: anchor(1, 'z') }),
      ann('a2', 'b2', 'highlight', { page: 1, text: anchor(1, 'a') }),
      ann('a3', 'b3', 'summary', { scope: { kind: 'book' }, body: 'S' }),
      ann('a4', 'b4', 'bookmark', { page: 1 }),
      ann('a5', 'b6', 'highlight', { page: 1, text: anchor(1, 'd') }),
      ann('a6', 'b1', 'highlight', { page: 2, text: anchor(2, 'dead'), deleted: true }),
    ];
    const files = exportNotes(books, anns);
    expect(files.map((f) => f.name)).toEqual(['Alpha.md', 'Alpha (2).md', 'Zebra.md']);
    expect(decode(files[2].data)).toContain('> z');
    expect(decode(files[2].data)).not.toContain('dead');
    expect(new Set(files.map((f) => f.name.toLowerCase())).size).toBe(files.length);
  });

  it('returns nothing when there are no notes', () => {
    expect(exportNotes([book('b1', 'A')], [])).toEqual([]);
  });
});

describe('review export', () => {
  const book = { id: 'b1', title: 'Dune', deleted: false } as never;
  const item = (o: object) => ({ id: 'r', text: 'serendipity', translation: 'صدفة', page: 4, createdAt: 1, context: 'A happy serendipity.', ...o }) as never;
  it('lists live items by book with page, translation and context', () => {
    const md = reviewMarkdown([book], [item({ bookId: 'b1' }), item({ id: 's', bookId: 'b1', text: 'gone', deleted: true })]);
    expect(md).toContain('# Review');
    expect(md).toContain('## Dune');
    expect(md).toContain('- **serendipity** — صدفة (p. 4)');
    expect(md).toContain('> A happy serendipity.');
    expect(md).not.toContain('gone');
  });
  it('is null when nothing is saved', () => {
    expect(exportReview([book], [])).toBeNull();
    expect(exportReview([book], [item({ bookId: 'b1', deleted: true })])).toBeNull();
    expect(exportReview([book], [item({ bookId: 'b1' })])?.name).toBe('Review.md');
  });
});
