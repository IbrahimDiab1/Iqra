import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import type { Book, OutlineNode } from '../../core/models';

/** A PDF that cannot be opened: password-protected, invalid, or with no pages. */
export class UnreadablePdfError extends Error {
  constructor(message = 'PDF is unreadable') {
    super(message);
    this.name = 'UnreadablePdfError';
  }
}

/** One entry of a pdf.js outline (bookmarks). `dest` is a named string or an explicit destination array. */
export interface PdfOutlineItem {
  title: string;
  dest: unknown;
  items: PdfOutlineItem[];
}

export interface PdfMeta {
  pageCount: number;
  /** The document's info title, trimmed; '' when absent. Pass through cleanTitle. */
  title: string;
  author: string;
  outline: OutlineNode[];
  language: Book['language'];
}

const UNTITLED = 'untitled';
const WORD_PREFIX = /^Microsoft Word - /;
const TITLE_EXTENSION = /\.(doc|docx|pdf)$/i;
const ARABIC_LETTER = /[؀-ۿ]/;
const LATIN_LETTER = /\p{Script=Latin}/u;
const LETTER = /\p{L}/gu;

/** The title to show for a book: the PDF's info title when it is usable, otherwise the file name. */
export function cleanTitle(infoTitle: string | undefined, fileName: string): string {
  const info = (infoTitle ?? '').trim().replace(WORD_PREFIX, '').trim();
  if (info !== '' && info.toLowerCase() !== UNTITLED && !TITLE_EXTENSION.test(info)) {
    return info;
  }
  return fileName
    .replace(/\.pdf$/i, '')
    .replace(/[_-]/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

/** 'ar' when Arabic letters are 30% or more of all letters, 'en' when Latin letters are 50% or more, else 'other'. */
export function detectLanguage(text: string): Book['language'] {
  let letters = 0;
  let arabic = 0;
  let latin = 0;
  for (const ch of text.match(LETTER) ?? []) {
    letters++;
    if (ARABIC_LETTER.test(ch)) arabic++;
    else if (LATIN_LETTER.test(ch)) latin++;
  }
  if (letters === 0) return 'other';
  if (arabic / letters >= 0.3) return 'ar';
  if (latin / letters >= 0.5) return 'en';
  return 'other';
}

/**
 * Converts a pdf.js outline into OutlineNodes. Top-level keys are their index ("0", "1");
 * a child's key is its parent's key plus its 1-based position ("0.1", "0.2"), as the brief specifies.
 * Keys only need to be unique and stable; nothing depends on the exact scheme.
 * An item whose destination cannot be resolved takes the page of its parent.
 */
export async function mapOutline(
  items: PdfOutlineItem[],
  resolvePage: (dest: unknown) => Promise<number | null>,
  parentPage = 1,
  prefix = '',
): Promise<OutlineNode[]> {
  const nodes: OutlineNode[] = [];
  for (const [index, item] of items.entries()) {
    const key = prefix === '' ? `${index}` : `${prefix}.${index + 1}`;
    const page = (await resolvePage(item.dest)) ?? parentPage;
    const children = await mapOutline(item.items, resolvePage, page, key);
    nodes.push({ key, title: item.title, page, children });
  }
  return nodes;
}

let pdfjsReady: Promise<typeof import('pdfjs-dist')> | undefined;

/** Loads pdf.js on first use (keeps it out of the initial bundle) and sets its worker once. */
function loadPdfjs(): Promise<typeof import('pdfjs-dist')> {
  pdfjsReady ??= import('pdfjs-dist').then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = 'assets/pdf.worker.min.mjs';
    return pdfjs;
  });
  return pdfjsReady;
}

/**
 * Starts loading a PDF with pdf.js. Await `task.promise`, and call `task.destroy()` when done.
 */
export async function openPdf(blob: Blob): Promise<PDFDocumentLoadingTask> {
  const { getDocument } = await loadPdfjs();
  const data = new Uint8Array(await blob.arrayBuffer());
  return getDocument({ data });
}

/** Reads page count, info title and author, outline and language from a PDF. Throws UnreadablePdfError. */
export async function readPdfMeta(blob: Blob): Promise<PdfMeta> {
  const task = await openPdf(blob);
  try {
    const doc = await task.promise;
    const pageCount = doc.numPages;
    if (pageCount === 0) throw new UnreadablePdfError('PDF has no pages');

    const { info } = await doc.getMetadata();
    const meta = info as { Title?: unknown; Author?: unknown };
    const title = typeof meta.Title === 'string' ? meta.Title.trim() : '';
    const author = typeof meta.Author === 'string' ? meta.Author.trim() : '';

    const rawOutline = (await doc.getOutline()) ?? [];
    const outline = await mapOutline(rawOutline as PdfOutlineItem[], (dest) => resolveDest(doc, dest));

    let sample = '';
    for (let n = 1; n <= Math.min(5, pageCount); n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      for (const item of content.items) {
        if ('str' in item) sample += item.str + ' ';
      }
    }

    return { pageCount, title, author, outline, language: detectLanguage(sample) };
  } catch (err) {
    if (err instanceof UnreadablePdfError) throw err;
    throw new UnreadablePdfError();
  } finally {
    await task.destroy();
  }
}

async function resolveDest(doc: PDFDocumentProxy, dest: unknown): Promise<number | null> {
  try {
    const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(explicit) || explicit.length === 0) return null;
    return (await doc.getPageIndex(explicit[0])) + 1;
  } catch {
    return null;
  }
}
