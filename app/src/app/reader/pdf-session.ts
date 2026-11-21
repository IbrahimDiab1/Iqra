import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import { loadPdfjs, pdfjsAssetOptions } from '../books/import/pdf-meta';
import { toReadingOrder, type DirectionChoice } from './arabic-text';
import { signal } from '@angular/core';
import { applyReadingOrder, tagSpans, textLayerSource, type PdfTextContent } from './text-layer';
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
  /**
   * The reader's own text direction for the book ('rtl' or 'ltr'; undefined is Auto). Reading with it overrides what is detected;
   * a page view reads it, so a change redraws the text layer in the new order.
   */
  readonly orderChoice?: () => DirectionChoice;
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
/** Pages whose extracted text items stay in memory: the pages around the reader plus the ones being searched. */
const ITEMS_CACHE_PAGES = 32;
/** After this many page renders, and again once the reader has been idle this long, pdf.js is told to drop what it caches. */
const CLEANUP_EVERY_RENDERS = 8;
const CLEANUP_IDLE_MS = 2500;

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
  /** Per page: items in pdf.js order and in reading order, computed once (selection and highlights ask on every change). */
  private readonly raws = new Map<number, Promise<PdfTextContent>>();
  private readonly ordered = new Map<number, Promise<TextItem[]>>();
  private readonly choice = signal<DirectionChoice>(undefined);
  readonly orderChoice = this.choice.asReadonly();
  private destroyed = false;
  private active = 0;
  private rendersSinceCleanup = 0;
  private cleanupTimer: ReturnType<typeof setTimeout> | undefined;
  private cleaning: Promise<void> | undefined;

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
          ? getDocument({ data: new Uint8Array(await src.blob.arrayBuffer()), ...pdfjsAssetOptions() })
          : getDocument({
              url: src.url,
              httpHeaders: src.httpHeaders,
              rangeChunkSize: 65536,
              disableAutoFetch: true,
              ...pdfjsAssetOptions(),
            });
      return new PdfSession(await task.promise, task);
    } catch (err) {
      void task?.destroy();
      throw new ReaderOpenError(failureReason(err, src.kind));
    }
  }

  /** Sets the reader's text direction choice (undefined = Auto). Orders and texts computed under the old choice are dropped. */
  setDirectionChoice(choice: DirectionChoice): void {
    if (this.choice() === choice) return;
    this.ordered.clear();
    this.texts.clear();
    this.choice.set(choice);
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
    this.active++;
    try {
      await this.cleaning;
      const p = await this.doc.getPage(page);
      try {
        await this.drawPage(p, canvas, cssWidthPx, signal);
      } finally {
        // Releases the page's operator list and decoded images; a no-op while another render of it is running.
        p.cleanup();
      }
    } finally {
      this.active--;
      this.rendersSinceCleanup++;
      this.noteIdle();
    }
  }

  /**
   * page.cleanup() keeps what the document shares between pages: decoded fonts (a FontFace in this document and a parsed
   * font in the worker, one per page for books that embed a subset per page), glyph caches and filters. They grow with
   * every page read, so release them in a run of renders and when reading pauses. Never while a render is running.
   */
  private noteIdle(): void {
    clearTimeout(this.cleanupTimer);
    this.cleanupTimer = undefined;
    if (this.destroyed || this.active > 0 || this.rendersSinceCleanup === 0) return;
    if (this.rendersSinceCleanup >= CLEANUP_EVERY_RENDERS) {
      this.cleanDocument();
    } else {
      this.cleanupTimer = setTimeout(() => this.noteIdle2(), CLEANUP_IDLE_MS);
    }
  }

  private noteIdle2(): void {
    this.cleanupTimer = undefined;
    if (!this.destroyed && this.active === 0 && this.rendersSinceCleanup > 0) this.cleanDocument();
  }

  private cleanDocument(): void {
    this.rendersSinceCleanup = 0;
    const done = Promise.resolve()
      .then(() => this.doc.cleanup(false))
      .catch(() => undefined) // a render started meanwhile: pdf.js refuses; the next run tries again
      .then(() => {
        if (this.cleaning === done) this.cleaning = undefined;
      });
    this.cleaning = done;
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
    this.active++;
    try {
      await this.cleaning;
      await this.layText(TextLayer, page, container, cssWidthPx, signal);
    } finally {
      this.active--;
      this.noteIdle();
    }
  }

  private async layText(
    TextLayer: PdfjsModule['TextLayer'],
    page: number,
    container: HTMLElement,
    cssWidthPx: number,
    signal: AbortSignal,
  ): Promise<void> {
    const p = await this.doc.getPage(page);
    try {
      const base = p.getViewport({ scale: 1 });
      const viewport = p.getViewport({ scale: cssWidthPx / base.width });
      // The same extraction the selection and search use: the page's text is read once, not once more for the layer.
      const content = await this.rawContent(page);
      if (signal.aborted) throw abortError();
      // Gaps between words (a space item each) are left out: they hold no letters, are invisible, and are half the spans of a page.
      const source = textLayerSource(content);
      container.replaceChildren();
      // pdf.js's own viewer sets this on the layer; the text-layer CSS (page-view.component.ts) sizes the fonts from it.
      container.style.setProperty('--total-scale-factor', String(viewport.scale));
      const layer = new TextLayer({ textContentSource: source.content as unknown as ConstructorParameters<PdfjsModule['TextLayer']>[0]['textContentSource'], container, viewport });
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
      // Spans are tagged with pdf.js's item index first, then moved to reading order along with `textItems`.
      tagSpans(layer.textDivs, source.kept);
      applyReadingOrder(container, layer.textDivs, toReadingOrder(content.items, this.choice()).order);
    } finally {
      p.cleanup();
    }
  }

  /** The page's text items in reading order: a right-to-left line the PDF draws left to right is reversed. */
  textItems(page: number): Promise<TextItem[]> {
    let items = this.ordered.get(page);
    if (!items) {
      items = this.rawTextItems(page).then((raw) => toReadingOrder(raw, this.choice()).items);
      items.catch(() => this.ordered.delete(page));
      this.ordered.set(page, items);
      this.trim(this.ordered);
    }
    return items;
  }

  /** The items in the order pdf.js produced them (the order its text-layer spans are in). */
  private rawTextItems(page: number): Promise<TextItem[]> {
    return this.rawContent(page).then((c) => c.items);
  }

  /** The page's text content as pdf.js produced it, read once and kept for the pages near the reader. */
  private rawContent(page: number): Promise<PdfTextContent> {
    let raw = this.raws.get(page);
    if (!raw) {
      raw = this.extractContent(page);
      raw.catch(() => this.raws.delete(page));
      this.raws.set(page, raw);
      while (this.raws.size > ITEMS_CACHE_PAGES) this.raws.delete(this.raws.keys().next().value as number);
    }
    return raw;
  }

  /** Keeps the most recently asked-for pages: the oldest entry goes when there are too many. */
  private trim(cache: Map<number, Promise<TextItem[]>>): void {
    while (cache.size > ITEMS_CACHE_PAGES) cache.delete(cache.keys().next().value as number);
  }

  private async extractContent(page: number): Promise<PdfTextContent> {
    const p = await this.doc.getPage(page);
    let content;
    try {
      content = await p.getTextContent();
    } finally {
      p.cleanup();
    }
    // Marked-content markers are dropped: the layer is a flat run of spans, and only text items carry a string.
    const items = content.items.filter((i): i is typeof i & TextItem => 'str' in i) as unknown as TextItem[];
    return { items, styles: content.styles as PdfTextContent['styles'], lang: content.lang };
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
    clearTimeout(this.cleanupTimer);
    this.raws.clear();
    this.ordered.clear();
    this.texts.clear();
    // pdf.js exposes teardown on the loading task: it also stops the worker's network requests.
    void this.task.destroy();
  }
}
