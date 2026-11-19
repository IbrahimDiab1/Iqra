import { ChangeDetectionStrategy, Component, ElementRef, HostListener, Injector, afterNextRender, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { HIGHLIGHT_COLORS, type HighlightColor } from '../annotations/annotation.service';
import { COPY } from '../ui/copy';
import { CHROME_COPY } from './chrome-copy';
import { clampMenu, type ContextActionId, type ContextMenuItem, type ContextMenuModel } from './context-menu';

/**
 * The right-click / long-press / Shift+F10 menu. Opens at a viewport point, is clamped into the viewport, takes focus,
 * moves with the arrow keys and closes on Esc, a press elsewhere, Tab, scrolling or resizing.
 * The page decides what the items do; this only shows them and reports the choice.
 */
@Component({
  selector: 'iqra-context-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (at(); as p) {
      <div
        #menu
        class="menu"
        role="menu"
        tabindex="-1"
        [attr.aria-label]="chrome.pageActions"
        [style.left.px]="pos().left"
        [style.top.px]="pos().top"
        (keydown)="onKeydown($event)"
        (mousedown)="$event.preventDefault()"
        (pointerdown)="$event.stopPropagation()"
        (contextmenu)="$event.preventDefault()"
      >
        @if (model().colors) {
          <div class="dots" role="group" [attr.aria-label]="copy.highlight">
            @for (c of colors; track c) {
              <button type="button" role="menuitem" class="dot" [attr.aria-label]="copy.colors[c]" [style.--c]="'var(--hl-' + c + ')'" (click)="color.emit(c)"></button>
            }
          </div>
        }
        @for (it of model().items; track it.id; let i = $index) {
          @if (i > 0 && model().items[i - 1].group !== it.group) {
            <hr role="separator" />
          }
          <button
            type="button"
            role="menuitem"
            class="item"
            [attr.data-action]="it.id"
            [disabled]="it.disabled === 'off'"
            [attr.aria-disabled]="it.disabled === 'soft' ? 'true' : null"
            [class.soft]="it.disabled === 'soft'"
            [attr.title]="it.hint ?? null"
            (click)="choose(it)"
          >
            <span class="lbl" dir="auto">{{ it.label }}</span>
            @if (it.shortcut) {
              <kbd>{{ it.shortcut }}</kbd>
            }
          </button>
        }
      </div>
    }
  `,
  styles: `
    :host { display: contents; }
    .menu { position: fixed; z-index: 45; display: grid; min-width: 240px; max-width: min(320px, calc(100vw - 16px)); padding: 6px; border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--surface); color: var(--fg); box-shadow: var(--shadow); }
    .menu:focus { outline: none; }
    .dots { display: flex; gap: 2px; padding-bottom: 4px; }
    .dot { position: relative; width: 40px; height: 40px; padding: 0; border: 0; border-radius: var(--radius-control); background: none; cursor: pointer; }
    .dot::after { content: ''; position: absolute; inset: 8px; border-radius: 50%; background: var(--c); box-shadow: inset 0 0 0 1px var(--line); }
    .dot:hover { background: var(--surface-2); }
    .item { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 40px; padding: 0 12px; border: 0; border-radius: 8px; background: none; color: inherit; font: 14px var(--ui); text-align: start; cursor: pointer; }
    .item:hover:not(:disabled):not(.soft), .item:focus-visible { background: var(--surface-2); }
    .item:disabled, .item.soft { opacity: 0.45; cursor: default; }
    .lbl { min-width: 0; }
    kbd { flex: none; color: var(--muted); font: 12px var(--ui); }
    hr { width: 100%; margin: 4px 0; border: 0; border-top: 1px solid var(--line); }
    .dot:focus-visible, .item:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  `,
})
export class ContextMenuComponent {
  /** Viewport point to open at; null keeps the menu closed. */
  readonly at = input<{ x: number; y: number; keyboard?: boolean } | null>(null);
  readonly model = input.required<ContextMenuModel>();
  readonly pick = output<ContextActionId>();
  readonly color = output<HighlightColor>();
  readonly closed = output<void>();

  protected readonly chrome = CHROME_COPY;
  protected readonly copy = COPY.annotations;
  protected readonly colors = HIGHLIGHT_COLORS;
  protected readonly pos = signal({ left: 0, top: 0 });

  private readonly menu = viewChild<ElementRef<HTMLElement>>('menu');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private opener: HTMLElement | null = null;

  constructor() {
    effect(() => {
      const p = this.at();
      untracked(() => {
        if (!p) return;
        this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        this.pos.set(clampMenu({ x: p.x, y: p.y, w: 240, h: 320, vw: innerWidth, vh: innerHeight }));
        afterNextRender(() => this.placeAndFocus(p), { injector: this.injector });
      });
    });
  }

  private placeAndFocus(p: { x: number; y: number; keyboard?: boolean }): void {
    const el = this.menu()?.nativeElement;
    if (!el) return;
    const box = el.getBoundingClientRect();
    this.pos.set(clampMenu({ x: p.x, y: p.y, w: box.width, h: box.height, vw: innerWidth, vh: innerHeight }));
    // Opened with the keyboard the first item has focus; with the pointer the menu itself does, so no ring shows until an arrow key.
    (p.keyboard ? this.buttons()[0] : el)?.focus({ preventScroll: true });
  }

  private buttons(): HTMLButtonElement[] {
    return Array.from(this.menu()?.nativeElement.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
  }

  protected choose(it: ContextMenuItem): void {
    this.pick.emit(it.id);
  }

  protected onKeydown(e: KeyboardEvent): void {
    const list = this.buttons();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowDown': next = at < 0 ? 0 : (at + 1) % list.length; break;
      case 'ArrowUp': next = at < 0 ? list.length - 1 : (at - 1 + list.length) % list.length; break;
      case 'Home': next = 0; break;
      case 'End': next = list.length - 1; break;
      case 'Escape':
        e.preventDefault();
        this.close();
        break;
      case 'Tab':
        this.close(false);
        break;
      default:
        break;
    }
    if (next !== null) {
      e.preventDefault();
      list[next]?.focus();
    }
    // The menu owns the keyboard while it is open; the reader's own shortcuts must not fire behind it.
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Tab') e.stopPropagation();
  }

  /** Closes and hands focus back to where it was when the menu opened. */
  private close(restore = true): void {
    this.closed.emit();
    if (restore) this.opener?.focus?.({ preventScroll: true });
  }

  @HostListener('document:pointerdown', ['$event'])
  protected onOutside(e: Event): void {
    if (this.at() && !this.host.nativeElement.contains(e.target as Node)) this.closed.emit();
  }

  @HostListener('window:resize')
  @HostListener('window:blur')
  protected onViewportChange(): void {
    if (this.at()) this.closed.emit();
  }

  @HostListener('document:wheel')
  protected onWheel(): void {
    if (this.at()) this.closed.emit();
  }
}
