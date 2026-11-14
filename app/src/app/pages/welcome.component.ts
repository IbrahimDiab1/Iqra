import { Component, HostListener, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthApi } from '../auth/auth.service';
import { SyncEngine } from '../sync/sync-engine';
import { DRIVE_ADAPTER } from '../sync/drive-adapter';
import { COPY } from '../ui/copy';

@Component({
  selector: 'f-welcome-page',
  template: `
    <section class="page">
      <h1>{{ copy.title }}</h1>
      <p>{{ copy.body }}</p>
      <button type="button" class="cta" [disabled]="!online() || busy()" (click)="continueWithGoogle()">
        {{ copy.cta }}
      </button>
      @if (!online()) {
        <p class="hint">{{ copy.offline }}</p>
      }
    </section>
  `,
  styles: `
    .page {
      min-height: 100%;
      padding: 48px var(--gutter);
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 16px;
    }
    h1 { margin: 0; font-size: 28px; font-weight: 600; line-height: 1.2; }
    p { margin: 0; color: var(--muted); }
    .cta {
      align-self: stretch;
      padding: 12px 16px;
      border: 0;
      border-radius: var(--radius-control);
      background: var(--accent);
      color: var(--accent-fg);
      font-weight: 600;
    }
    .cta:disabled { opacity: 0.5; }
    .hint { font-size: 13px; }
  `,
})
export class WelcomePage {
  private readonly auth = inject(AuthApi);
  private readonly drive = inject(DRIVE_ADAPTER);
  private readonly router = inject(Router);
  private readonly sync = inject(SyncEngine);

  protected readonly copy = COPY.welcome;
  protected readonly online = signal(navigator.onLine);
  protected readonly busy = signal(false);

  @HostListener('window:online')
  protected setOnline(): void {
    this.online.set(true);
  }

  @HostListener('window:offline')
  protected setOffline(): void {
    this.online.set(false);
  }

  protected async continueWithGoogle(): Promise<void> {
    this.busy.set(true);
    try {
      await this.auth.signIn();
    } catch {
      // Popup closed or sign-in failed: stay here so the user can try again.
      this.busy.set(false);
      return;
    }
    this.sync.start();
    try {
      await this.drive.ensureBooksFolder();
      await navigator.storage?.persist?.();
    } catch {
      // Left for the sync engine to retry; the library still opens.
    }
    await this.sync.syncNow();
    await this.router.navigateByUrl('/library');
  }
}
