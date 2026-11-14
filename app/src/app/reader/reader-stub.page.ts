import { Component, DestroyRef, ElementRef, inject, signal, viewChild } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import { CLOCK } from '../core/clock';
import { DB } from '../core/db';
import { Repo } from '../core/repo';
import type { Book } from '../core/models';
import { loadPdfjs } from '../books/import/pdf-meta';
import { DRIVE_ADAPTER } from '../sync/drive-adapter';
import { icon } from '../ui/icons';
import { COPY } from '../ui/copy';

/**
 * Minimal reader: renders page 1 of a book. Local books come from db.pdfFiles;
 * `?source=drive` streams the PDF from Drive. Plan 2 replaces this page.
 */
@Component({
  imports: [RouterLink],
  selector: 'f-reader-stub-page',
  template: `
    <section class="page">
      <a class="back" routerLink="/library"><span [innerHTML]="backIcon"></span>{{ copy.back }}</a>
      @if (state() === 'loading') {
        <p class="status">{{ copy.loading }}</p>
      } @else if (state() === 'error') {
        <p class="status">{{ copy.failed }}</p>
      } @else {
        <p class="count">{{ pageLabel() }}</p>
      }
      <div #stage class="stage">
        <canvas #canvas [hidden]="state() !== 'ready'"></canvas>
      </div>
    </section>
  `,
  styles: `
    .page { display: grid; gap: 12px; padding: 16px var(--gutter); }
    .back { justify-self: start; display: inline-flex; align-items: center; gap: 4px; min-width: 40px; min-height: 40px; padding: 0 8px 0 4px; color: var(--accent); font-size: 15px; text-decoration: none; }
    .status, .count { margin: 0; color: var(--muted); font-size: 15px; }
    .stage { width: 100%; }
    canvas { display: block; max-width: 100%; box-shadow: 0 1px 4px rgb(0 0 0 / 0.2); }
  `,
})
export class ReaderStubPage {
  protected readonly copy = COPY.reader;
  protected readonly backIcon = inject(DomSanitizer).bypassSecurityTrustHtml(icon('back', 22));
  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly pageLabel = signal('');

  private readonly route = inject(ActivatedRoute);
  private readonly db = inject(DB);
  private readonly repo = inject(Repo);
  private readonly clock = inject(CLOCK);
  private readonly drive = inject(DRIVE_ADAPTER);
  private readonly stage = viewChild.required<ElementRef<HTMLElement>>('stage');
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private task?: PDFDocumentLoadingTask;

  constructor() {
    inject(DestroyRef).onDestroy(() => void this.task?.destroy());
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const bookId = this.route.snapshot.paramMap.get('bookId') ?? '';
      const streaming = this.route.snapshot.queryParamMap.get('source') === 'drive';
      const book = await this.db.books.get(bookId);
      if (!book || book.deleted) throw new Error('book not found');

      const pdfjs = await loadPdfjs();
      if (streaming) {
        const { url, httpHeaders } = this.drive.mediaRequest(book.driveFileId);
        this.task = pdfjs.getDocument({ url, httpHeaders, rangeChunkSize: 65536, disableAutoFetch: true });
      } else {
        const file = await this.db.pdfFiles.get(bookId);
        if (!file) throw new Error('pdf not on this device');
        const data = new Uint8Array(await file.blob.arrayBuffer());
        this.task = pdfjs.getDocument({ data });
      }

      const doc = await this.task.promise;
      await this.renderFirstPage(doc);
      this.pageLabel.set(this.copy.pageOf(doc.numPages));
      await this.markOpened(book);
      this.state.set('ready');
    } catch {
      this.state.set('error');
    }
  }

  /** Draws page 1 at the width of the stage. */
  private async renderFirstPage(doc: PDFDocumentProxy): Promise<void> {
    const page = await doc.getPage(1);
    const cssWidth = this.stage().nativeElement.clientWidth;
    const base = page.getViewport({ scale: 1 });
    const dpr = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: (cssWidth / base.width) * dpr });

    const canvas = this.canvas().nativeElement;
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${(cssWidth * base.height) / base.width}px`;

    const canvasContext = canvas.getContext('2d');
    if (!canvasContext) throw new Error('no canvas context');
    await page.render({ canvas, canvasContext, viewport }).promise;
  }

  private async markOpened(book: Book): Promise<void> {
    const status = book.status === 'to-read' ? 'reading' : book.status;
    await this.repo.put<Book>('books', { ...book, status, lastOpenedAt: this.clock.now() });
  }
}
