import { ChangeDetectionStrategy, Component, ElementRef, HostListener, Injector, afterNextRender, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { icon } from '../ui/icons';
import { CHROME_COPY } from './chrome-copy';

/** From this width the drawer docks beside the page without a scrim or a focus trap. */
export const DRAWER_DOCK_MIN_WIDTH = 900;
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
let nextId = 0;

/**
 * A panel that slides in from the right, to the left of the reader toolbar and below the header, so both
 * stay usable. Wide screens dock a 380 px panel over the page edge; narrow ones add a scrim and trap focus.
 */
@Component({
  selector: 'iqra-drawer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="scrim" [class.open]="open() && narrow()" (click)="closed.emit()"></div>
    <aside
      #panel
      class="panel"
      role="dialog"
      [attr.aria-modal]="narrow() ? 'true' : null"
      [attr.aria-labelledby]="titleId"
      [attr.aria-hidden]="open() ? null : 'true'"
      [attr.inert]="open() ? null : ''"
      [class.open]="open()"
    >
      <header class="head">
        <h3 [id]="titleId">{{ title() }}</h3>
        <button type="button" class="close" [attr.aria-label]="chrome.closePanel" data-shortcut="Esc" (click)="closed.emit()">
          <span [innerHTML]="closeIcon"></span>
        </button>
      </header>
      <div class="body"><ng-content /></div>
    </aside>
  `,
  styles: `
    :host { display: contents; }
    .scrim { position: absolute; top: var(--reader-header-h, 52px); bottom: 0; left: 0; right: var(--reader-toolbar-w, 52px); z-index: 20; background: color-mix(in srgb, #000 36%, transparent); opacity: 0; pointer-events: none; transition: opacity 220ms; }
    .scrim.open { opacity: 1; pointer-events: auto; }
    .panel {
      position: absolute; top: var(--reader-header-h, 52px); bottom: 0; right: var(--reader-toolbar-w, 52px); z-index: 21;
      display: flex; flex-direction: column; box-sizing: border-box;
      width: min(88vw, 420px, calc(100vw - var(--reader-toolbar-w, 52px)));
      background: var(--surface); color: var(--fg); border-inline-start: 1px solid var(--line); box-shadow: var(--shadow);
      transform: translateX(105%); visibility: hidden; transition: transform 220ms cubic-bezier(.2, .8, .2, 1), visibility 220ms;
    }
    .panel.open { transform: none; visibility: visible; }
    @media (min-width: 900px) { .panel { width: 380px; } }
    .head { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 6px 6px 8px var(--gutter); }
    .head h3 { margin: 0; font-size: 17px; font-weight: 600; }
    .close { display: grid; place-items: center; width: 40px; height: 40px; flex: none; padding: 0; border: 0; border-radius: var(--radius-control); background: none; color: inherit; cursor: pointer; }
    .close:hover { background: color-mix(in srgb, currentColor 8%, transparent); }
    .close:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .body { flex: 1; min-height: 0; overflow-y: auto; padding: 0 var(--gutter) 16px; }
    @media (prefers-reduced-motion: reduce) { .scrim, .panel { transition: none; } }
  `,
})
export class DrawerComponent {
  readonly open = input(false);
  readonly title = input('');
  readonly closed = output<void>();

  protected readonly chrome = CHROME_COPY;
  protected readonly titleId = `drawer-title-${nextId++}`;
  protected readonly closeIcon = inject(DomSanitizer).bypassSecurityTrustHtml(icon('x', 20));
  protected readonly narrow = signal(window.innerWidth < DRAWER_DOCK_MIN_WIDTH);

  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');
  private readonly injector = inject(Injector);
  private opener: HTMLElement | null = null;

  constructor() {
    effect(() => {
      const open = this.open();
      untracked(() => {
        if (open) {
          this.opener = document.activeElement as HTMLElement | null;
          afterNextRender(() => this.focusFirst(), { injector: this.injector });
        } else if (this.opener) {
          // Give focus back to what opened the drawer, unless the user has already gone elsewhere.
          const el = this.opener;
          this.opener = null;
          const active = document.activeElement;
          if (el.isConnected && (!active || active === document.body || this.panel().nativeElement.contains(active))) el.focus();
        }
      });
    });
  }

  @HostListener('document:keydown.escape', ['$event'])
  protected onEscape(e: Event): void {
    if (!this.open() || e.defaultPrevented) return;
    this.closed.emit();
    e.preventDefault();
  }

  @HostListener('window:resize')
  protected onResize(): void {
    this.narrow.set(window.innerWidth < DRAWER_DOCK_MIN_WIDTH);
  }

  /** Narrow screens keep Tab inside the drawer while it is open. */
  @HostListener('document:keydown', ['$event'])
  protected onTab(ev: KeyboardEvent): void {
    if (ev.key !== 'Tab' || !this.open() || !this.narrow()) return;
    const items = Array.from(this.panel().nativeElement.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.closest('[hidden], [inert]'));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement as HTMLElement | null;
    const inside = !!active && this.panel().nativeElement.contains(active);
    if (ev.shiftKey && (active === first || !inside)) {
      last.focus();
      ev.preventDefault();
    } else if (!ev.shiftKey && (active === last || !inside)) {
      first.focus();
      ev.preventDefault();
    }
  }

  private focusFirst(): void {
    const body = this.panel().nativeElement.querySelector('.body');
    body?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  }
}
