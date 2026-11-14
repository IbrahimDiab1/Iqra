import { Component, inject } from '@angular/core';
import { COPY } from './copy';
import { ToastService } from './toast.service';

@Component({
  selector: 'f-toast',
  template: `
    @if (toast.current(); as t) {
      <div class="toast" role="status" aria-live="polite">
        <span dir="auto">{{ t.message }}</span>
        @if (t.undo) {
          <button type="button" (click)="toast.undo()">{{ undoLabel }}</button>
        }
      </div>
    }
  `,
  styles: `
    :host { display: contents; }
    .toast {
      position: fixed;
      left: 50%;
      bottom: 82px;
      transform: translateX(-50%);
      z-index: 40;
      display: flex;
      align-items: center;
      gap: 10px;
      max-width: calc(100% - 32px);
      padding: 10px 10px 10px 16px;
      border-radius: var(--radius-control);
      background: var(--tool-bg);
      color: var(--tool-fg);
      font-size: 13.5px;
      white-space: nowrap;
      box-shadow: var(--shadow);
      animation: toast-in var(--motion-toast) ease-out;
    }
    .toast span {
      overflow: hidden;
      text-overflow: ellipsis;
      padding-right: 6px;
    }
    .toast button {
      flex: none;
      min-width: 40px;
      min-height: 40px;
      padding: 4px 8px;
      border: 0;
      border-radius: 8px;
      background: none;
      color: var(--undo);
      font-weight: 600;
    }
    @keyframes toast-in {
      from { opacity: 0; transform: translate(-50%, 6px); }
      to { opacity: 1; transform: translate(-50%, 0); }
    }
    @media (prefers-reduced-motion: reduce) {
      .toast { animation: none; }
    }
  `,
})
export class ToastComponent {
  protected readonly toast = inject(ToastService);
  protected readonly undoLabel = COPY.common.undo;
}
