import { ChangeDetectionStrategy, Component, ElementRef, HostListener, OnDestroy, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import type { Book } from '../core/models';
import { COPY } from '../ui/copy';
import { icon, type IconName } from '../ui/icons';
import { CHROME_COPY } from './chrome-copy';

/** The toolbar buttons; each reports a plain press. */
export type ToolbarAction =
  | 'contents' | 'search' | 'bookmark' | 'mark' | 'area' | 'mode' | 'settings' | 'zoomOut' | 'zoomIn' | 'undo' | 'redo' | 'fullscreen';

/** How long the toolbar stays after the last touch, the mouse leaving, or focus and holds ending. */
export const TOOLBAR_HIDE_MS = 3000;
/** A mouse this close to the bottom edge of the window shows the toolbar. */
export const TOOLBAR_NEAR_PX = 96;

interface Item {
  id: ToolbarAction;
  label: string;
  icon: IconName;
  shortcut?: string;
  /** Shown as a toggle (`aria-pressed`) when set. */
  pressed?: boolean;
  /** Not available: really disabled (`disabled`). */
  off?: boolean;
  /** Looks and reads as unavailable but still takes the press, so it can explain itself (`aria-disabled`). */
  soft?: boolean;
  /** A divider is drawn before the first item of a new group. */
  group: number;
}

/**
 * The reader's one toolbar: a horizontal pill centred at the bottom of the page. It hides itself to give the page
 * the whole screen: a mouse near the bottom edge or a tap on the page brings it back; it hides 3 s after the mouse
 * leaves or the last touch. It never hides while focus is inside it or while the page `hold`s it (a menu is open,
 * the area tool is on).
 */
@Component({
  selector: 'iqra-reader-toolbar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="tools"
      role="toolbar"
      aria-orientation="horizontal"
      [class.away]="!shown()"
      [attr.aria-label]="chrome.toolbar"
      (keydown)="onKeydown()"
      (pointerdown)="reveal()"
      (focusin)="onFocusIn()"
      (focusout)="onFocusOut($event)"
    >
      @for (it of items(); track it.id; let i = $index) {
        @if (i > 0 && items()[i - 1].group !== it.group) {
          <hr aria-hidden="true" />
        }
        <button
          type="button"
          class="tb"
          [class.on]="it.pressed"
          [class.soft]="it.soft"
          [attr.data-tool]="it.id"
          [attr.aria-label]="it.label"
          [attr.data-shortcut]="it.shortcut ?? null"
          [attr.aria-pressed]="it.pressed ?? null"
          [attr.aria-disabled]="it.soft ? 'true' : null"
          [disabled]="it.off"
          (click)="action.emit(it.id)"
        >
          <span class="glyph" [innerHTML]="glyph(it.icon)"></span>
        </button>
      }
    </div>
  `,
  styles: `
    /* The host is a click-through strip along the bottom; only the pill takes the pointer. */
    :host {
      position: absolute; inset-inline: 0; bottom: 0; z-index: 19; display: flex; justify-content: center;
      padding: 0 8px calc(10px + env(safe-area-inset-bottom, 0px)); pointer-events: none;
    }
    /* A docked drawer (wide screens, no scrim) must not hide buttons; the modal drawer on narrow screens stays above. */
    @media (min-width: 900px) { :host { z-index: 22; } }
    .tools {
      display: flex; align-items: center; justify-content: safe center; gap: 2px; max-width: 100%; padding: 4px 6px; box-sizing: border-box;
      overflow-x: auto; scrollbar-width: none; pointer-events: auto;
      border: 1px solid color-mix(in srgb, var(--ink) 12%, transparent); border-radius: 999px;
      background: color-mix(in srgb, var(--paper) 96%, transparent); color: var(--ink); box-shadow: var(--shadow);
      transition: transform 200ms cubic-bezier(.2, .8, .2, 1), opacity 200ms;
    }
    .tools::-webkit-scrollbar { display: none; }
    /* Hidden, it slides off the bottom edge but stays in the tab order: focusing a button shows it again. */
    .tools.away { transform: translateY(calc(100% + 24px)); opacity: 0; pointer-events: none; }
    @media (prefers-reduced-motion: reduce) { .tools { transition: none; } }
    hr { flex: none; width: 0; height: 24px; margin: 0 4px; border: 0; border-inline-start: 1px solid color-mix(in srgb, var(--ink) 14%, transparent); }
    .tb { position: relative; display: inline-grid; place-items: center; flex: none; width: 40px; height: 40px; padding: 0; border: 0; border-radius: 50%; background: none; color: inherit; cursor: pointer; }
    .tb:hover:not(:disabled):not(.soft) { background: color-mix(in srgb, var(--ink) 8%, transparent); }
    .tb:disabled, .tb.soft { opacity: 0.38; cursor: default; }
    .tb.on { background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent); }
    .tb:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .glyph { display: grid; place-items: center; pointer-events: none; }
  `,
})
export class ReaderToolbarComponent implements OnDestroy {
  readonly view = input<'page' | 'reflow'>('page');
  readonly tool = input<'none' | 'area'>('none');
  readonly bookmarked = input(false);
  /** Only decides whether Mark page read is available; the mode itself is set in the reading settings. */
  readonly progressMode = input<Book['progressMode']>('last-page');
  readonly pageMarked = input(false);
  readonly canUndo = input(false);
  readonly canRedo = input(false);
  readonly canZoomIn = input(true);
  readonly canZoomOut = input(true);
  readonly fullscreen = input(false);
  /** The page needs the toolbar to stay: a menu is open, or the area tool is on. */
  readonly hold = input(false);

  readonly action = output<ToolbarAction>();

  protected readonly chrome = CHROME_COPY;
  protected readonly shown = signal(true);
  private readonly focusInside = signal(false);
  private mouseNear = false;
  /** The last input was a key (so a focus change is keyboard focus). */
  private keyboardLast = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly sanitizer = inject(DomSanitizer);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly glyphs = new Map<IconName, SafeHtml>();

  protected readonly items = computed<Item[]>(() => {
    const marked = this.progressMode() === 'marked';
    const bookmarked = this.bookmarked();
    const pageMarked = this.pageMarked();
    const reflow = this.view() === 'reflow';
    const a = COPY.annotations;
    const r = COPY.reader;
    return [
      { id: 'contents', label: CHROME_COPY.contentsNotes, icon: 'list', shortcut: 'C', group: 0 },
      { id: 'search', label: r.search, icon: 'search', shortcut: '/', group: 0 },
      { id: 'bookmark', label: bookmarked ? a.removeBookmark : a.addBookmark, icon: bookmarked ? 'bookmarkFill' : 'bookmark', shortcut: 'B', pressed: bookmarked, group: 1 },
      {
        id: 'mark',
        label: !marked ? CHROME_COPY.markDisabled : pageMarked ? CHROME_COPY.unmarkPageRead : CHROME_COPY.markPageRead,
        icon: pageMarked ? 'checkCircleFill' : 'checkCircle',
        shortcut: 'M',
        pressed: marked ? pageMarked : undefined,
        soft: !marked,
        group: 1,
      },
      { id: 'area', label: a.area, icon: 'areaSelect', shortcut: 'A', pressed: this.tool() === 'area', off: reflow, group: 1 },
      { id: 'mode', label: reflow ? r.pageView : r.readingMode, icon: reflow ? 'pageview' : 'bookOpen', shortcut: 'R', group: 2 },
      { id: 'settings', label: r.settings, icon: 'textSettings', group: 2 },
      { id: 'zoomOut', label: CHROME_COPY.zoomOut, icon: 'zoomOut', off: !this.canZoomOut(), group: 3 },
      { id: 'zoomIn', label: CHROME_COPY.zoomIn, icon: 'zoomIn', off: !this.canZoomIn(), group: 3 },
      { id: 'undo', label: CHROME_COPY.undo, icon: 'undo', shortcut: 'Ctrl+Z', off: !this.canUndo(), group: 4 },
      { id: 'redo', label: CHROME_COPY.redo, icon: 'redo', shortcut: 'Ctrl+Shift+Z', off: !this.canRedo(), group: 4 },
      { id: 'fullscreen', label: this.fullscreen() ? CHROME_COPY.exitFullScreen : CHROME_COPY.fullScreen, icon: 'fullscreen', shortcut: 'F', pressed: this.fullscreen(), group: 4 },
    ];
  });

  constructor() {
    // Focus inside it, or a hold from the page, keeps it up; when that ends the 3 s start again.
    effect(() => {
      const keep = this.hold() || this.focusInside();
      untracked(() => {
        if (keep) {
          clearTimeout(this.timer);
          this.timer = undefined;
          this.shown.set(true);
        } else {
          this.schedule();
        }
      });
    });
  }

  ngOnDestroy(): void {
    clearTimeout(this.timer);
  }

  /** Shows the toolbar and starts the 3 s over (a tap on the page, a press or key inside it). */
  reveal(): void {
    this.shown.set(true);
    this.schedule();
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!this.hold() && !this.focusInside() && !this.mouseNear) this.shown.set(false);
    }, TOOLBAR_HIDE_MS);
  }

  /** Keyboard focus keeps the toolbar up; the focus a mouse or touch press leaves on a button does not. */
  protected onFocusIn(): void {
    if (this.keyboardLast) this.focusInside.set(true);
  }

  @HostListener('document:keydown')
  protected onAnyKey(): void {
    this.keyboardLast = true;
  }

  @HostListener('document:pointerdown')
  protected onAnyPointer(): void {
    this.keyboardLast = false;
  }

  protected onFocusOut(e: FocusEvent): void {
    if (!this.host.nativeElement.contains(e.relatedTarget as Node | null)) this.focusInside.set(false);
  }

  /** A mouse near the bottom edge (the toolbar lies inside that zone) shows it and keeps it. */
  @HostListener('document:pointermove', ['$event'])
  protected onPointerMove(e: PointerEvent): void {
    if (e.pointerType === 'touch') return;
    const near = e.clientY >= window.innerHeight - TOOLBAR_NEAR_PX;
    if (near) {
      this.mouseNear = true;
      this.shown.set(true);
      clearTimeout(this.timer);
      this.timer = undefined;
    } else if (this.mouseNear) {
      this.mouseNear = false;
      this.schedule();
    }
  }

  /** The mouse leaving the window counts as leaving the bottom edge. */
  @HostListener('document:mouseout', ['$event'])
  protected onMouseOut(e: MouseEvent): void {
    if (e.relatedTarget === null && this.mouseNear) {
      this.mouseNear = false;
      this.schedule();
    }
  }

  protected glyph(name: IconName): SafeHtml {
    let html = this.glyphs.get(name);
    if (!html) this.glyphs.set(name, (html = this.sanitizer.bypassSecurityTrustHtml(icon(name, 22))));
    return html;
  }

  /**
   * A key pressed inside the toolbar restarts the 3 s. The arrow keys stay the page's own (a button that was just
   * clicked has focus, and Left/Right must still turn the page); Tab moves between the buttons.
   */
  protected onKeydown(): void {
    this.reveal();
  }
}
