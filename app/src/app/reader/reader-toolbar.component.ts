import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, inject, input, output, signal } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import type { Book } from '../core/models';
import { COPY } from '../ui/copy';
import { icon, type IconName } from '../ui/icons';
import { CHROME_COPY } from './chrome-copy';

/** The toolbar buttons that report a plain press; the progress-mode popover has its own output. */
export type ToolbarAction = 'contents' | 'search' | 'bookmark' | 'mark' | 'area' | 'mode' | 'settings' | 'undo' | 'redo' | 'fullscreen';

interface Item {
  id: ToolbarAction | 'progress';
  label: string;
  icon: IconName;
  shortcut?: string;
  /** Shown as a toggle (`aria-pressed`) when set. */
  pressed?: boolean;
  /** Not available: really disabled (`disabled`). */
  off?: boolean;
  /** Looks and reads as unavailable but still takes the press, so it can explain itself (`aria-disabled`). */
  soft?: boolean;
  badge?: number;
  /** A divider is drawn before the first item of a new group. */
  group: number;
}

/** The one vertical toolbar fixed at the reader's right edge. */
@Component({
  selector: 'iqra-reader-toolbar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="tools" role="toolbar" aria-orientation="vertical" [attr.aria-label]="chrome.toolbar" (keydown)="onKeydown($event)">
      @for (it of items(); track it.id; let i = $index) {
        @if (i > 0 && items()[i - 1].group !== it.group) {
          <hr aria-hidden="true" />
        }
        <button
          type="button"
          class="tb"
          [class.on]="it.pressed || (it.id === 'progress' && popOpen())"
          [class.soft]="it.soft"
          [attr.data-tool]="it.id"
          [attr.aria-label]="it.label"
          [attr.data-shortcut]="it.shortcut ?? null"
          [attr.aria-pressed]="it.pressed ?? null"
          [attr.aria-disabled]="it.soft ? 'true' : null"
          [attr.aria-haspopup]="it.id === 'progress' ? 'true' : null"
          [attr.aria-expanded]="it.id === 'progress' ? popOpen() : null"
          [disabled]="it.off"
          (click)="press(it, $event)"
        >
          <span class="glyph" [innerHTML]="glyph(it.icon)"></span>
          @if (it.badge) {
            <span class="badge" aria-hidden="true">{{ it.badge }}</span>
          }
        </button>
      }
    </div>
    @if (popOpen()) {
      <div class="pop" role="menu" [attr.aria-label]="chrome.progressMode" [style.top.px]="popTop()">
        @for (o of modes; track o.mode) {
          <button type="button" role="menuitemradio" [attr.aria-checked]="progressMode() === o.mode" (click)="choose(o.mode)">
            <span class="dot" aria-hidden="true"></span>{{ o.label }}
          </button>
        }
      </div>
    }
  `,
  styles: `
    :host { display: flex; width: 52px; box-sizing: border-box; border-inline-start: 1px solid color-mix(in srgb, var(--ink) 10%, transparent); background: color-mix(in srgb, var(--paper) 96%, transparent); }
    .tools { display: flex; flex-direction: column; align-items: center; justify-content: safe center; gap: 2px; width: 100%; padding: 8px 0; overflow-y: auto; scrollbar-width: none; }
    .tools::-webkit-scrollbar { display: none; }
    hr { width: 24px; height: 0; margin: 4px 0; border: 0; border-top: 1px solid color-mix(in srgb, var(--ink) 14%, transparent); }
    .tb { position: relative; display: inline-grid; place-items: center; flex: none; width: 40px; height: 40px; padding: 0; border: 0; border-radius: var(--radius-control); background: none; color: inherit; cursor: pointer; }
    .tb:hover:not(:disabled):not(.soft) { background: color-mix(in srgb, var(--ink) 8%, transparent); }
    .tb:disabled, .tb.soft { opacity: 0.38; cursor: default; }
    .tb.on { background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent); }
    .tb:focus-visible, .pop button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .glyph { display: grid; place-items: center; pointer-events: none; }
    .badge { position: absolute; top: 1px; inset-inline-end: 0; min-width: 16px; padding: 0 4px; border-radius: 999px; background: var(--accent); color: var(--accent-fg); font: 600 10px/16px var(--ui); text-align: center; }
    .pop { position: fixed; z-index: 40; inset-inline-end: 60px; display: grid; min-width: 210px; padding: 6px; border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--surface); color: var(--fg); box-shadow: var(--shadow); }
    .pop button { display: flex; align-items: center; gap: 10px; min-height: 40px; padding: 0 12px; border: 0; border-radius: 8px; background: none; color: inherit; font: 14px var(--ui); text-align: start; cursor: pointer; }
    .pop button:hover { background: var(--surface-2); }
    .dot { flex: none; width: 14px; height: 14px; border: 2px solid var(--muted); border-radius: 50%; box-sizing: border-box; }
    .pop [aria-checked='true'] .dot { border-color: var(--accent); background: radial-gradient(var(--accent) 0 40%, transparent 45%); }
  `,
})
export class ReaderToolbarComponent {
  readonly view = input<'page' | 'reflow'>('page');
  readonly tool = input<'none' | 'area'>('none');
  readonly bookmarked = input(false);
  readonly progressMode = input<Book['progressMode']>('last-page');
  readonly pageMarked = input(false);
  readonly canUndo = input(false);
  readonly canRedo = input(false);
  readonly fullscreen = input(false);
  /** Notes, highlights, areas and side notes on this page. */
  readonly noteCount = input(0);

  readonly action = output<ToolbarAction>();
  readonly progressModeChange = output<Book['progressMode']>();

  protected readonly chrome = CHROME_COPY;
  protected readonly modes: { mode: Book['progressMode']; label: string }[] = [
    { mode: 'last-page', label: CHROME_COPY.trackByLast },
    { mode: 'marked', label: CHROME_COPY.trackByMarked },
  ];
  protected readonly popOpen = signal(false);
  protected readonly popTop = signal(0);
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
      { id: 'contents', label: CHROME_COPY.contentsNotes, icon: 'list', shortcut: 'C', badge: this.noteCount(), group: 0 },
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
      { id: 'mode', label: reflow ? r.pageView : r.readingMode, icon: reflow ? 'pageview' : 'reflow', shortcut: 'R', group: 2 },
      { id: 'settings', label: r.settings, icon: 'type', group: 2 },
      { id: 'progress', label: CHROME_COPY.progressMode, icon: 'progress', group: 2 },
      { id: 'undo', label: CHROME_COPY.undo, icon: 'undo', shortcut: 'Ctrl+Z', off: !this.canUndo(), group: 3 },
      { id: 'redo', label: CHROME_COPY.redo, icon: 'redo', shortcut: 'Ctrl+Shift+Z', off: !this.canRedo(), group: 3 },
      { id: 'fullscreen', label: this.fullscreen() ? CHROME_COPY.exitFullScreen : CHROME_COPY.fullScreen, icon: 'fullscreen', shortcut: 'F', pressed: this.fullscreen(), group: 3 },
    ];
  });

  protected glyph(name: IconName): SafeHtml {
    let html = this.glyphs.get(name);
    if (!html) this.glyphs.set(name, (html = this.sanitizer.bypassSecurityTrustHtml(icon(name, 22))));
    return html;
  }

  protected press(it: Item, e: Event): void {
    if (it.id === 'progress') {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      this.popTop.set(Math.max(8, r.top - 4));
      this.popOpen.update((o) => !o);
      return;
    }
    this.popOpen.set(false);
    this.action.emit(it.id);
  }

  protected choose(mode: Book['progressMode']): void {
    this.popOpen.set(false);
    if (mode !== this.progressMode()) this.progressModeChange.emit(mode);
    this.host.nativeElement.querySelector<HTMLElement>('[data-tool="progress"]')?.focus();
  }

  /** Up/Down/Home/End move between the buttons that can be pressed. */
  protected onKeydown(e: KeyboardEvent): void {
    const keys = ['ArrowUp', 'ArrowDown', 'Home', 'End'];
    if (!keys.includes(e.key) || e.ctrlKey || e.metaKey || e.altKey) return;
    const buttons = Array.from(this.host.nativeElement.querySelectorAll<HTMLButtonElement>('.tools .tb:not(:disabled)'));
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : e.key === 'ArrowDown' ? Math.min(buttons.length - 1, at + 1) : Math.max(0, at - 1);
    buttons[next]?.focus();
    e.preventDefault();
  }

  @HostListener('document:pointerdown', ['$event'])
  protected onOutside(e: Event): void {
    if (this.popOpen() && !this.host.nativeElement.contains(e.target as Node)) this.popOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.popOpen()) this.popOpen.set(false);
  }
}
