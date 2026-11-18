import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import { loadPdfjs } from '../books/import/pdf-meta';
import { alignSpans } from './text-layer';
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
  /**
   * Fills `container` with one transparent span per non-empty text item, each tagged `data-item="<index in textItems(page)>"`.
   * Rejects with an AbortError-named error when aborted.
   */
  renderTextLayer(page: number, container: HTMLElement, cssWidthPx: number, signal: AbortSignal): Promise<void>;
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

type CanvasFactory = () => HTMLCanvasElement;
let makeCanvas: CanvasFactory = () => document.createElement('canvas');

/** Replaces the offscreen canvas factory in tests; call with undefined to restore it. */
export function setCanvasFactoryForTests(fn: CanvasFactory | undefined): void {
  makeCanvas = fn ?? (() => document.createElement('canvas'));
}

/**
 * pdf.js 6.5 reports HTTP failures as ResponseException (`missing` for a 404), and a worker-side
 * FormatError can arrive wrapped as UnknownErrorException. A local blob cannot fail by network.
 */
function failureReason(err: unknown, kind: PdfSource['kind']): OpenFailure {
  const e = err as { name?: unknown; missing?: unknown } | null;
  if (e?.name === 'PasswordException') return 'password';
  if (e?.name === 'InvalidPDFException' || e?.name === 'FormatError') return 'corrupt';
  if (e?.name === 'ResponseException' && e.missing === true) return 'corrupt';
  return kind === 'local' ? 'corrupt' : 'network';
}

function abortError(): Error {
  const e = new Error('Render aborted');
  e.name = 'AbortError';
  return e;
}

export class PdfSession implements PageRenderer {
  private readonly sizes = new Map<number, Promise<PageSize>>();
  private readonly texts = new Map<number, string>();
  private destroyed = false;

  private constructor(
    private readonly doc: PDFDocumentProxy,
    private readonly task: PDFDocumentLoadingTask,
  ) {
    this.numPages = doc.numPages;
  }

  readonly numPages: number;

  static async open(src: PdfSource): Promise<PdfSession> {
    const { getDocument } = await loader();
    let task: PDFDocumentLoadingTask | undefined;
    try {
      task =
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
      void task?.destroy();
      throw new ReaderOpenError(failureReason(err, src.kind));
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
    try {
      await this.drawPage(p, canvas, cssWidthPx, signal);
    } finally {
      // Releases the page's operator list and decoded images; a no-op while another render of it is running.
      p.cleanup();
    }
  }

  private async drawPage(
    p: Awaited<ReturnType<PDFDocumentProxy['getPage']>>,
    canvas: HTMLCanvasElement,
    cssWidthPx: number,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted) throw abortError();
    const base = p.getViewport({ scale: 1 });
    const cssScale = cssWidthPx / base.width;
    const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    const scale = canvasScale(cssScale, base.width, base.height, dpr);
    const viewport = p.getViewport({ scale });
    // Draw offscreen: assigning canvas.width/height clears the bitmap, and the old one must stay visible meanwhile.
    const work = makeCanvas();
    work.width = Math.max(1, Math.floor(viewport.width));
    work.height = Math.max(1, Math.floor(viewport.height));
    const canvasContext = work.getContext('2d');
    if (!canvasContext) throw new Error('Canvas is not available');
    const task = p.render({ canvasContext, viewport } as unknown as Parameters<typeof p.render>[0]);
    const onAbort = () => task.cancel();
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      try {
        await task.promise;
      } catch (err) {
        if (signal.aborted || this.destroyed) throw abortError();
        throw err;
      }
      if (signal.aborted) throw abortError();
      const target = canvas.getContext('2d');
      if (!target) throw new Error('Canvas is not available');
      // Resize and draw in the same task so the visible canvas never shows a blank frame.
      if (canvas.width !== work.width || canvas.height !== work.height) {
        canvas.width = work.width;
        canvas.height = work.height;
      } else {
        target.clearRect(0, 0, work.width, work.height);
      }
      target.drawImage(work, 0, 0);
    } finally {
      signal.removeEventListener('abort', onAbort);
      work.width = 0;
      work.height = 0;
    }
  }

  async renderTextLayer(page: number, container: HTMLElement, cssWidthPx: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw abortError();
    const { TextLayer } = await loader();
    const p = await this.doc.getPage(page);
    try {
      const base = p.getViewport({ scale: 1 });
      const viewport = p.getViewport({ scale: cssWidthPx / base.width });
      const items = await this.textItems(page);
      if (signal.aborted) throw abortError();
      container.replaceChildren();
      // pdf.js's own viewer sets this on the layer; the text-layer CSS (page-view.component.ts) sizes the fonts from it.
      container.style.setProperty('--total-scale-factor', String(viewport.scale));
      const layer = new TextLayer({ textContentSource: p.streamTextContent(), container, viewport });
      const onAbort = () => layer.cancel();
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        await layer.render();
      } catch (err) {
        if (signal.aborted || this.destroyed) throw abortError();
        throw err;
      } finally {
        signal.removeEventListener('abort', onAbort);
      }
      if (signal.aborted) throw abortError();
      alignSpans(items, layer.textDivs);
    } finally {
      p.cleanup();
    }
  }

  async textItems(page: number): Promise<TextItem[]> {
    const p = await this.doc.getPage(page);
    let content;
    try {
      content = await p.getTextContent();
    } finally {
      p.cleanup();
    }
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
    this.destroyed = true;
    // pdf.js exposes teardown on the loading task: it also stops the worker's network requests.
    void this.task.destroy();
  }
}
