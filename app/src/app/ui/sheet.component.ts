import {
  Component,
  ElementRef,
  HostListener,
  Injector,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { COPY } from './copy';
import { icon } from './icons';

const DIALOG_MIN_WIDTH = 720;
let nextId = 0;
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

@Component({
  selector: 'f-sheet',
  template: `
    <div class="scrim" [class.open]="open()" (click)="closed.emit()"></div>
    <div
      #panel
      class="panel"
      role="dialog"
      aria-modal="true"
      [attr.aria-labelledby]="titleId"
      [attr.aria-hidden]="open() ? null : 'true'"
      [attr.inert]="open() ? null : ''"
      [class.open]="open()"
      [class.tall]="tall()"
      [class.dialog]="wide()"
    >
      <div class="grab" aria-hidden="true"></div>
      <header class="head">
        <h3 [id]="titleId">{{ title() }}</h3>
        <button type="button" class="close" [attr.aria-label]="closeLabel" (click)="closed.emit()">
          <span [innerHTML]="closeIcon"></span>
        </button>
      </header>
      <div class="body">
        <ng-content />
      </div>
      <footer class="foot">
        <ng-content select="[sheet-foot]" />
      </footer>
    </div>
  `,
  styles: `
    .scrim, .panel { transition-duration: var(--motion-sheet); }
    .scrim {
      position: fixed;
      inset: 0;
      z-index: 30;
      background: color-mix(in srgb, #000 36%, transparent);
      opacity: 0;
      pointer-events: none;
      transition-property: opacity;
    }
    .scrim.open { opacity: 1; pointer-events: auto; }

    .panel {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 31;
      display: flex;
      flex-direction: column;
      max-height: 90vh;
      background: var(--surface);
      color: var(--fg);
      border-radius: var(--radius-sheet) var(--radius-sheet) 0 0;
      padding-bottom: env(safe-area-inset-bottom, 0px);
      transform: translateY(100%);
      visibility: hidden;
      transition-property: transform, visibility;
    }
    .panel.open { transform: none; visibility: visible; }
    .panel.tall { height: 86vh; }

    .panel.dialog {
      top: 50%;
      bottom: auto;
      left: 50%;
      right: auto;
      width: min(480px, calc(100vw - 32px));
      max-height: 80vh;
      border-radius: var(--radius-card);
      box-shadow: var(--shadow);
      transform: translate(-50%, -50%) scale(0.98);
      opacity: 0;
      transition-property: transform, opacity, visibility;
    }
    .panel.dialog.open { transform: translate(-50%, -50%); opacity: 1; }
    .panel.dialog .grab { display: none; }

    .grab {
      width: 38px;
      height: 4px;
      margin: 8px auto 2px;
      border-radius: 4px;
      background: var(--line);
      flex: none;
    }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      padding: 6px 10px 10px var(--gutter);
    }
    .head h3 { margin: 0; font-size: 17px; font-weight: 600; }
    .close {
      display: grid;
      place-items: center;
      width: 40px;
      height: 40px;
      flex: none;
      border: 0;
      border-radius: var(--radius-control);
      background: none;
    }
    .close:hover { background: color-mix(in srgb, currentColor 8%, transparent); }
    .body {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 0 var(--gutter) 16px;
    }
    .foot {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 10px 14px 14px;
      border-top: 1px solid var(--line);
    }
    .foot:empty { display: none; }
  `,
})
export class SheetComponent {
  readonly open = input(false);
  readonly title = input('');
  readonly tall = input(false);
  readonly closed = output<void>();

  protected readonly titleId = `sheet-title-${nextId++}`;
  protected readonly closeLabel = COPY.common.close;
  protected readonly closeIcon: SafeHtml;
  protected readonly wide = signal(window.innerWidth >= DIALOG_MIN_WIDTH);

  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');
  private readonly injector = inject(Injector);

  constructor() {
    // Icon markup is a static constant from icons.ts, so bypassing the sanitizer is safe.
    this.closeIcon = inject(DomSanitizer).bypassSecurityTrustHtml(icon('x', 20));

    effect(() => {
      if (this.open()) {
        afterNextRender(() => this.focusFirstInBody(), { injector: this.injector });
      }
    });
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.open()) this.closed.emit();
  }

  @HostListener('window:resize')
  protected onResize(): void {
    this.wide.set(window.innerWidth >= DIALOG_MIN_WIDTH);
  }

  private focusFirstInBody(): void {
    const body = this.panel().nativeElement.querySelector('.body');
    body?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  }
}
