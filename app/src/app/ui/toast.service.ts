import { Injectable, signal } from '@angular/core';

/** A second button beside Undo. */
export interface ToastExtra {
  label: string;
  run: () => void;
}

export interface ToastState {
  message: string;
  undo?: () => void;
  actionLabel?: string;
  extra?: ToastExtra;
}

export interface ToastOptions {
  undo?: () => void;
  /** Text of the action button; defaults to Undo. */
  actionLabel?: string;
  /** A second action next to Undo; the toast closes when it is pressed. */
  extra?: ToastExtra;
  durationMs?: number;
}

const DEFAULT_DURATION_MS = 4000;

@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly state = signal<ToastState | null>(null);
  private timer: ReturnType<typeof setTimeout> | undefined;

  /** The visible toast, or null. Only one toast is shown at a time. */
  readonly current = this.state.asReadonly();

  show(message: string, opts: ToastOptions = {}): void {
    clearTimeout(this.timer);
    this.state.set({ message, undo: opts.undo, actionLabel: opts.actionLabel, extra: opts.extra });
    this.timer = setTimeout(() => this.dismiss(), opts.durationMs ?? DEFAULT_DURATION_MS);
  }

  undo(): void {
    const toast = this.state();
    this.dismiss();
    toast?.undo?.();
  }

  runExtra(): void {
    const toast = this.state();
    this.dismiss();
    toast?.extra?.run();
  }

  dismiss(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.state.set(null);
  }
}
