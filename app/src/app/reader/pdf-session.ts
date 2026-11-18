import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import { loadPdfjs } from '../books/import/pdf-meta';
import { pageTextOf, type TextItem } from './text';
import { canvasScale } from './zoom';

export interface PageSize {
  widthPt: number;
  heightPt: number;
}

/** What reader components depend on; tests provide a fake. */
export interface PageRenderer {
  readonly numPages: number;
  pageSize(page: number): Promise<PageSize>;
  /** Sets the canvas pixel size and draws the page. Rejects with an AbortError-named error when aborted. */
  renderPage(page: number, canvas: HTMLCanvasElement, cssWidthPx: number, signal: AbortSignal): Promise<void>;
  textItems(page: number): Promise<TextItem[]>;
  pageText(page: number): Promise<string>;
}

export type OpenFailure = 'corrupt' | 'password' | 'network';

export class ReaderOpenError extends Error {
  constructor(readonly reason: OpenFailure) {
    super(`PDF could not be opened: ${reason}`);
    this.name = 'ReaderOpenError';
  }
}

export type PdfSource =
  | { kind: 'local'; blob: Blob }
  | { kind: 'drive'; url: string; httpHeaders: Record<string, string> };

type PdfjsModule = typeof import('pdfjs-dist');
let loader: () => Promise<PdfjsModule> = loadPdfjs;

/** Replaces the pdf.js loader in tests; call with undefined to restore it. */
export function setPdfjsLoaderForTests(fn: (() => Promise<PdfjsModule>) | undefined): void {
  loader = fn ?? loadPdfjs;
}

const TEXT_CACHE_PAGES = 200;
const CORRUPT_NAMES = new Set(['InvalidPDFException', 'FormatError', 'MissingPDFException']);

function failureReason(err: unknown): OpenFailure {
  const name = (err as { name?: unknown } | null)?.name;
  if (name === 'PasswordException') return 'password';
  if (typeof name === 'string' && CORRUPT_NAMES.has(name)) return 'corrupt';
  return 'network';
}

function abortError(): Error {
  const e = new Error('Render aborted');
  e.name = 'AbortError';
  return e;
}

export class PdfSession implements PageRenderer {
  private readonly sizes = new Map<number, Promise<PageSize>>();
  private readonly texts = new Map<number, string>();

  private constructor(
    private readonly doc: PDFDocumentProxy,
    private readonly task: PDFDocumentLoadingTask,
  ) {
    this.numPages = doc.numPages;
  }

  readonly numPages: number;

  static async open(src: PdfSource): Promise<PdfSession> {
    const { getDocument } = await loader();
    try {
      const task =
        src.kind === 'local'
          ? getDocument({ data: new Uint8Array(await src.blob.arrayBuffer()) })
          : getDocument({
              url: src.url,
              httpHeaders: src.httpHeaders,
              rangeChunkSize: 65536,
              disableAutoFetch: true,
            });
      return new PdfSession(await task.promise, task);
    } catch (err) {
      throw new ReaderOpenError(failureReason(err));
    }
  }

  pageSize(page: number): Promise<PageSize> {
    let size = this.sizes.get(page);
    if (!size) {
      size = this.doc.getPage(page).then((p) => {
        const v = p.getViewport({ scale: 1 });
        return { widthPt: v.width, heightPt: v.height };
      });
      size.catch(() => this.sizes.delete(page));
      this.sizes.set(page, size);
    }
    return size;
  }

  async renderPage(page: number, canvas: HTMLCanvasElement, cssWidthPx: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw abortError();
    const p = await this.doc.getPage(page);
    if (signal.aborted) throw abortError();
    const base = p.getViewport({ scale: 1 });
    const cssScale = cssWidthPx / base.width;
    const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    const scale = canvasScale(cssScale, base.width, base.height, dpr);
    const viewport = p.getViewport({ scale });
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const canvasContext = canvas.getContext('2d');
    if (!canvasContext) throw new Error('Canvas is not available');
    const task = p.render({ canvasContext, viewport } as unknown as Parameters<typeof p.render>[0]);
    const onAbort = () => task.cancel();
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      await task.promise;
    } catch (err) {
      if (signal.aborted) throw abortError();
      throw err;
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }

  async textItems(page: number): Promise<TextItem[]> {
    const p = await this.doc.getPage(page);
    const content = await p.getTextContent();
    return content.items.filter((i): i is typeof i & TextItem => 'str' in i) as unknown as TextItem[];
  }

  async pageText(page: number): Promise<string> {
    const cached = this.texts.get(page);
    if (cached !== undefined) return cached;
    const text = pageTextOf(await this.textItems(page));
    this.texts.set(page, text);
    if (this.texts.size > TEXT_CACHE_PAGES) {
      this.texts.delete(this.texts.keys().next().value as number);
    }
    return text;
  }

  destroy(): void {
    // pdf.js exposes teardown on the loading task: it also stops the worker's network requests.
    void this.task.destroy();
  }
}
