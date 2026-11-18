import { Component, inject, input } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { FilesService } from '../../books/files.service';
import { BookDetailsService } from '../../books/details/book-details.service';
import { statusLine } from '../../books/library/library-query';
import type { Book } from '../../core/models';
import { COPY } from '../../ui/copy';
import { icon } from '../../ui/icons';
import { BookCoverComponent } from './book-cover.component';

/** What a card needs to know about its book. Built by the library page. */
export interface BookView {
  book: Book;
  /** 0..1 */
  progress: number;
  downloaded: boolean;
  /** Upload fraction 0..1 while this book's PDF is going to Drive, otherwise null. */
  uploading: number | null;
}

/** The status line under a title. A book uploaded on another device has no local file to read yet. */
export function bookLine(book: Book, progress: number, downloaded: boolean): string {
  if (!downloaded && book.driveFileId === '') return COPY.library.uploadingElsewhere;
  return statusLine(book, progress);
}

const LONG_PRESS_MS = 480;
const LONG_PRESS_SLOP_PX = 8;
const RING_RADIUS = 8;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/**
 * A book in the grid. Tap opens it. A long press or a right-click opens its details.
 * A long press that opened the details does not also open the book on release.
 */
@Component({
  selector: 'iqra-book-card',
  imports: [BookCoverComponent],
  template: `
    <button
      type="button"
      class="book"
      (click)="onClick($event)"
      (pointerdown)="onPointerDown($event)"
      (pointermove)="onPointerMove($event)"
      (pointerup)="cancelPress()"
      (pointerleave)="cancelPress()"
      (pointercancel)="cancelPress()"
      (contextmenu)="onContextMenu($event)"
    >
      <span class="cover">
        <iqra-book-cover [book]="view().book" />
        @if (view().uploading !== null) {
          <svg class="ring" width="22" height="22" viewBox="0 0 22 22" role="img" [attr.aria-label]="uploadLabel()">
            <circle class="ring-track" cx="11" cy="11" r="8" />
            <circle
              class="ring-arc"
              cx="11"
              cy="11"
              r="8"
              [attr.stroke-dasharray]="ringLength"
              [attr.stroke-dashoffset]="ringOffset()"
            />
          </svg>
        } @else if (!view().downloaded) {
          <span class="cloud" role="img" [attr.aria-label]="notDownloaded" [innerHTML]="cloudIcon"></span>
        }
      </span>
      <span class="bt" dir="auto">{{ view().book.title }}</span>
      <span class="bs">{{ line() }}</span>
      @if (showBar()) {
        <span class="bar" aria-hidden="true"><i [style.width.%]="barPercent()"></i></span>
      }
    </button>
  `,
  styles: `
    :host { display: block; }
    .book {
      display: block;
      width: 100%;
      padding: 0;
      border: 0;
      background: none;
      color: inherit;
      text-align: start;
      -webkit-touch-callout: none;
      user-select: none;
    }
    .book:focus-visible { border-radius: 8px; }
    .cover { position: relative; display: block; }
    .cloud, .ring {
      position: absolute;
      top: 6px;
      inset-inline-end: 6px;
      display: grid;
      place-items: center;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: var(--surface);
      color: var(--fg);
      box-shadow: 0 1px 3px color-mix(in srgb, var(--fg) 25%, transparent);
    }
    .ring { transform: rotate(-90deg); }
    .ring circle { fill: none; stroke-width: 3; }
    .ring-track { stroke: var(--line); }
    .ring-arc { stroke: var(--accent); stroke-linecap: round; transition: stroke-dashoffset 200ms linear; }
    .bt {
      display: -webkit-box;
      margin-top: 8px;
      overflow: hidden;
      font-size: 12.5px;
      font-weight: 600;
      line-height: 1.25;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
    .bt:dir(rtl) { font-family: var(--ar); }
    .bs {
      display: block;
      margin-top: 3px;
      color: var(--muted);
      font-size: 11.5px;
      font-variant-numeric: tabular-nums;
    }
    .bar {
      display: block;
      height: 3px;
      margin-top: 6px;
      border-radius: 3px;
      overflow: hidden;
      background: color-mix(in srgb, var(--fg) 12%, transparent);
    }
    .bar i { display: block; height: 100%; background: var(--accent); }
  `,
})
export class BookCardComponent {
  readonly view = input.required<BookView>();

  private readonly files = inject(FilesService);
  private readonly details = inject(BookDetailsService);
  private readonly sanitizer = inject(DomSanitizer);

  protected readonly cloudIcon: SafeHtml = this.sanitizer.bypassSecurityTrustHtml(icon('cloud', 14));
  protected readonly notDownloaded = COPY.library.notDownloaded;

  private pressTimer: ReturnType<typeof setTimeout> | undefined;
  private pressOrigin: { x: number; y: number } | null = null;
  /** Set when a long press opened the details, so the release does not also open the book. */
  private suppressClick = false;

  protected line(): string {
    const v = this.view();
    return bookLine(v.book, v.progress, v.downloaded);
  }

  protected showBar(): boolean {
    const status = this.view().book.status;
    return status === 'reading' || status === 'paused';
  }

  protected barPercent(): number {
    return Math.max(2, Math.round(this.view().progress * 100));
  }

  protected uploadLabel(): string {
    return COPY.import.uploading(Math.round((this.view().uploading ?? 0) * 100));
  }

  protected readonly ringLength = RING_LENGTH;

  protected ringOffset(): number {
    return RING_LENGTH * (1 - (this.view().uploading ?? 0));
  }

  protected onClick(e: MouseEvent): void {
    if (this.suppressClick) {
      this.suppressClick = false;
      // A pointer click right after a long press is the release. A keyboard click (detail 0) is a real tap.
      if (e.detail !== 0) return;
    }
    this.files.openBook(this.view().book);
  }

  protected onPointerDown(e: PointerEvent): void {
    this.suppressClick = false;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.cancelPress();
    this.pressOrigin = { x: e.clientX, y: e.clientY };
    const id = this.view().book.id;
    this.pressTimer = setTimeout(() => {
      this.pressTimer = undefined;
      this.pressOrigin = null;
      this.suppressClick = true;
      this.details.open(id);
    }, LONG_PRESS_MS);
  }

  protected onPointerMove(e: PointerEvent): void {
    if (!this.pressOrigin) return;
    const dx = e.clientX - this.pressOrigin.x;
    const dy = e.clientY - this.pressOrigin.y;
    if (Math.hypot(dx, dy) > LONG_PRESS_SLOP_PX) this.cancelPress();
  }

  /**
   * Right-click, or the context menu that Android sends after a long press. A long press has
   * already opened the details, so the menu event only has to be swallowed.
   */
  protected onContextMenu(e: Event): void {
    e.preventDefault();
    const alreadyOpen = this.suppressClick;
    this.cancelPress();
    if (alreadyOpen) return;
    this.suppressClick = true;
    this.details.open(this.view().book.id);
  }

  protected cancelPress(): void {
    if (this.pressTimer !== undefined) clearTimeout(this.pressTimer);
    this.pressTimer = undefined;
    this.pressOrigin = null;
  }
}
