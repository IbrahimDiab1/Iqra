import type { Annotation, Book, OutlineNode } from '../core/models';

const MAX_NAME = 80;
const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;

/**
 * A file name for a book title: forbidden characters become spaces, runs of spaces collapse,
 * leading and trailing dots and spaces go, and the result is cut to 80 characters. An empty
 * result becomes "Untitled". A name already in `used` (compared ignoring case, since some file
 * systems do) gets " (2)", " (3)" and so on. `used` is updated. Always ends with ".md".
 */
export function safeFileName(title: string, used: Set<string>): string {
  const clean = (s: string) => s.replace(FORBIDDEN, ' ').replace(/\s+/g, ' ').replace(/^[\s.]+|[\s.]+$/g, '');
  let base = clean(title);
  base = clean(Array.from(base).slice(0, MAX_NAME).join(''));
  if (base === '') base = 'Untitled';
  let name = `${base}.md`;
  for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} (${n}).md`;
  used.add(name.toLowerCase());
  return name;
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
const quote = (s: string) => s.split(/\r?\n/).map((l) => (l === '' ? '>' : `> ${l}`)).join('\n');
const tagLine = (tags: string[]) => tags.map((t) => `#${t}`).join(' ');

/** The outline node whose chapter holds `page`: the last node in reading order that starts on or before it. */
function chapterAt(outline: OutlineNode[], page: number): string | null {
  let found: string | null = null;
  const walk = (nodes: OutlineNode[]) => {
    for (const n of nodes) {
      if (n.page <= page) found = n.title;
      walk(n.children);
    }
  };
  walk(outline);
  return found;
}

function scopeLabel(a: Annotation): string {
  const s = a.scope;
  if (!s || s.kind === 'book') return 'Book';
  return s.kind === 'outline' ? oneLine(s.title) || 'Chapter' : `p. ${s.fromPage}–${s.toPage}`;
}

/** One block of Markdown for a highlight, note, area or side note. */
function noteBlock(a: Annotation): string {
  const parts: string[] = [];
  const body = a.body?.trim() ?? '';
  if (a.type === 'side-note') {
    parts.push(`**Side note (p. ${a.page})** ${body}`);
  } else if (a.type === 'area') {
    parts.push(`*Area highlight on p. ${a.page}*`);
    if (body) parts.push(body);
  } else {
    if (a.text?.quote) parts.push(quote(a.text.quote));
    if (body) parts.push(body);
  }
  if (a.tags.length > 0) parts.push(tagLine(a.tags));
  return parts.join('\n\n');
}

/**
 * The Markdown notes for one book: highlights, notes, areas and side notes grouped by page,
 * then summaries, then bookmarks (unless `bookmarks` is false). Deleted records and records of
 * other books are left out. Arabic text is written as is.
 */
export function bookMarkdown(book: Book, anns: Annotation[], bookmarks = true): string {
  const live = anns.filter((a) => a.bookId === book.id && !a.deleted);
  const byTime = (a: Annotation, b: Annotation) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1);
  const sections: string[] = [`# ${oneLine(book.title)}`];
  if (book.author.trim()) sections.push(`*${oneLine(book.author)}*`);

  const notes = live.filter((a) => a.type !== 'summary' && a.type !== 'bookmark').sort((a, b) => (a.page ?? 0) - (b.page ?? 0) || byTime(a, b));
  if (notes.length > 0) {
    sections.push('## Highlights and notes');
    let page: number | undefined;
    for (const a of notes) {
      if (a.page !== page) {
        page = a.page;
        sections.push(`### Page ${page}`);
      }
      sections.push(noteBlock(a));
    }
  }

  const summaries = live.filter((a) => a.type === 'summary').sort(byTime);
  if (summaries.length > 0) {
    sections.push('## Summaries');
    for (const a of summaries) {
      sections.push(`### ${scopeLabel(a)}`);
      const body = [a.body?.trim() ?? '', a.tags.length > 0 ? tagLine(a.tags) : ''].filter(Boolean).join('\n\n');
      if (body) sections.push(body);
    }
  }

  const marks = bookmarks ? live.filter((a) => a.type === 'bookmark').sort((a, b) => (a.page ?? 0) - (b.page ?? 0)) : [];
  if (marks.length > 0) {
    sections.push('## Bookmarks');
    sections.push(
      marks
        .map((a) => {
          const chapter = chapterAt(book.outline, a.page ?? 0);
          return chapter ? `- p. ${a.page} · ${oneLine(chapter)}` : `- p. ${a.page}`;
        })
        .join('\n'),
    );
  }
  return sections.join('\n\n') + '\n';
}

/** One Markdown file per live book that has at least one live annotation other than a bookmark, sorted by title. */
export function exportNotes(books: Book[], anns: Annotation[]): { name: string; data: Uint8Array }[] {
  const withNotes = new Set(anns.filter((a) => !a.deleted && a.type !== 'bookmark').map((a) => a.bookId));
  const chosen = books
    .filter((b) => !b.deleted && withNotes.has(b.id))
    .sort((a, b) => a.title.localeCompare(b.title) || (a.id < b.id ? -1 : 1));
  const used = new Set<string>();
  const enc = new TextEncoder();
  return chosen.map((b) => ({ name: safeFileName(b.title, used), data: enc.encode(bookMarkdown(b, anns)) }));
}
