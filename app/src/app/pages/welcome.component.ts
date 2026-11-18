import { Component, HostListener, inject, signal } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { AuthApi } from '../auth/auth.service';
import { SyncEngine } from '../sync/sync-engine';
import { DRIVE_ADAPTER } from '../sync/drive-adapter';
import { COPY } from '../ui/copy';
import { icon, type IconName } from '../ui/icons';

@Component({
  selector: 'f-welcome-page',
  template: `
    <main class="page">
      <div class="brand">
        <img class="mark" src="favicon.svg" alt="" width="38" height="24" />
        <span class="name">Iqra</span>
      </div>

      <div class="top">
        <div class="hero">
          <p class="ar-word" lang="ar" dir="rtl"><span class="word">اقرأ</span></p>
          <p class="meaning">{{ copy.meaning }}</p>
          <h1>{{ copy.title }}</h1>
          <p class="sub">{{ copy.body }}</p>

          <button
            type="button"
            class="cta"
            [disabled]="!online() || busy()"
            [attr.aria-busy]="busy()"
            (click)="continueWithGoogle()"
          >
            @if (busy()) {
              <span class="spin" aria-hidden="true"></span>
              {{ copy.busy }}
            } @else {
              <span class="g" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 48 48">
                  <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/>
                  <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/>
                  <path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6z"/>
                  <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/>
                </svg>
              </span>
              {{ copy.cta }}
            }
          </button>

          <p class="trust"><span [innerHTML]="lockIcon"></span>{{ copy.trust }}</p>

          <div class="status" role="status" aria-live="polite">
            @if (!online()) {
              <p class="msg">{{ copy.offline }}</p>
            } @else if (failed()) {
              <p class="msg">{{ copy.cancelled }}</p>
            }
          </div>

          <details class="warn">
            <summary>{{ copy.warningTitle }}<span [innerHTML]="chevIcon"></span></summary>
            <p>{{ copy.warningBody }}</p>
          </details>
        </div>

        <div class="stage" aria-hidden="true">
          <div class="glow"></div>
          <div class="paper">
            <p class="bar">On the Origin of Species · p. 11</p>
            <p class="text" lang="en">
              These facts seemed to me to throw some light on the origin of species—that
              <mark class="hl">mystery of mysteries</mark><i class="dot"></i>, as it has been called by one of our greatest philosophers.
            </p>
          </div>
          <div class="note">
            <p>{{ copy.previewNote }}</p>
            <span class="tag">#big-question</span>
          </div>
        </div>
      </div>

      <ul class="features">
        @for (f of features; track f.title) {
          <li>
            <span class="well" [innerHTML]="f.svg"></span>
            <div>
              <h2>{{ f.title }}</h2>
              <p>{{ f.text }}</p>
            </div>
          </li>
        }
      </ul>

      <footer>
        {{ copy.footer }}
        <a href="privacy.html">{{ copy.privacy }}</a>
        <a href="terms.html">{{ copy.terms }}</a>
        <a href="https://github.com/IbrahimDiab1/Iqra" target="_blank" rel="noopener noreferrer">{{ copy.source }}</a>
      </footer>
    </main>
  `,
  styles: `
    :host { display: block; }
    .page { min-height: 100dvh; max-width: 1080px; margin: 0 auto; padding: 20px var(--gutter) 28px; display: flex; flex-direction: column; gap: 32px; }
    p, h1, h2 { margin: 0; }
    .brand { display: flex; align-items: center; gap: 10px; }
    .mark { width: 38px; height: auto; display: block; }
    .name { font-weight: 600; font-size: 17px; letter-spacing: -0.01em; }
    .top { display: grid; gap: 40px; flex: 1; align-content: start; }
    .hero { display: flex; flex-direction: column; align-items: flex-start; min-width: 0; }

    .ar-word { font-family: var(--display-ar); font-size: clamp(72px, 22vw, 144px); line-height: 1.1; color: var(--fg); font-weight: 700; }
    .word { position: relative; display: inline-block; padding: 0 0.12em; isolation: isolate; }
    .word::before {
      content: ''; position: absolute; z-index: -1; inset: 36% 0 12%; border-radius: 0.14em;
      background: var(--hl-yellow); transform: rotate(-1.5deg); transform-origin: left center;
      animation: sweep 700ms 250ms ease-out backwards;
    }
    @keyframes sweep { from { transform: rotate(-1.5deg) scaleX(0); } }
    .meaning { margin-top: 6px; color: var(--muted); font-size: 14px; }
    h1 { margin-top: 28px; font-family: var(--book); font-size: clamp(28px, 7vw, 44px); font-weight: 600; line-height: 1.15; letter-spacing: -0.01em; text-wrap: balance; }
    .sub { margin-top: 14px; max-width: 46ch; color: var(--muted); font-size: 17px; line-height: 1.5; }

    .cta {
      display: inline-flex; align-items: center; justify-content: center; gap: 12px; align-self: stretch;
      height: 52px; margin-top: 28px; padding: 0 22px; border: 0; border-radius: var(--radius-control);
      background: var(--fg); color: var(--bg); font-size: 16px; font-weight: 600;
      box-shadow: 0 1px 2px rgba(0, 0, 0, .2); transition: transform 150ms, box-shadow 150ms;
    }
    .cta:hover:not(:disabled) { transform: translateY(-1px); box-shadow: var(--shadow); }
    .cta:active:not(:disabled) { transform: translateY(1px); box-shadow: none; }
    .cta:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
    .cta:disabled { opacity: 0.5; cursor: default; }
    .cta[aria-busy='true'] { cursor: progress; }
    .g { display: grid; place-items: center; flex: none; width: 20px; height: 20px; border-radius: 50%; background: #fff; }
    .spin { flex: none; width: 18px; height: 18px; border: 2px solid color-mix(in srgb, var(--bg) 35%, transparent); border-top-color: var(--bg); border-radius: 50%; animation: spin 800ms linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (min-width: 600px) { .cta { align-self: flex-start; min-width: 280px; } }

    .trust { display: flex; gap: 8px; align-items: flex-start; margin-top: 14px; max-width: 46ch; color: var(--muted); font-size: 13px; line-height: 1.45; }
    .trust span { margin-top: 1px; display: inline-flex; }
    .status:empty, .status { min-height: 0; }
    .msg { margin-top: 12px; padding: 10px 12px; border-radius: 10px; background: var(--accent-soft); color: var(--fg); font-size: 14px; max-width: 46ch; }
    .warn { margin-top: 18px; color: var(--muted); font-size: 14px; max-width: 46ch; }
    summary { display: inline-flex; align-items: center; gap: 4px; min-height: 40px; cursor: pointer; list-style: none; border-radius: 8px; }
    summary::-webkit-details-marker { display: none; }
    summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    summary span { display: inline-flex; transition: transform 150ms; }
    details[open] summary span { transform: rotate(180deg); }
    .warn p { padding: 0 0 8px; line-height: 1.5; }

    .stage { position: relative; display: grid; place-items: center; padding: 8px 0 64px; min-width: 0; animation: rise 500ms 450ms ease-out backwards; }
    @keyframes rise { from { opacity: 0; transform: translateY(12px); } }
    .glow { position: absolute; inset: 0; margin: auto; width: min(100%, 420px); aspect-ratio: 1; border-radius: 50%; background: radial-gradient(closest-side, color-mix(in srgb, var(--accent-soft) 40%, transparent) 55%, transparent); }
    .paper { position: relative; width: 100%; max-width: 360px; padding: 18px 20px 22px; border-radius: var(--radius-card); background: var(--surface); box-shadow: var(--shadow); border: 1px solid var(--line); }
    .bar { color: var(--muted); font-size: 12px; padding-bottom: 12px; margin-bottom: 12px; border-bottom: 1px solid var(--line); }
    .text { font-family: var(--book); font-size: 15px; line-height: 1.6; }
    .text + .text { margin-top: 8px; }
    .hl { background: var(--hl-yellow); color: inherit; border-radius: 3px; padding: 1px 0; }
    .dot { display: inline-block; width: 7px; height: 7px; margin: 0 4px 2px 3px; border-radius: 50%; background: var(--accent); }
    .note { position: absolute; right: 0; bottom: -4px; width: min(250px, 78%); padding: 12px 14px; border-radius: 14px; background: var(--tool-bg); color: var(--tool-fg); box-shadow: var(--shadow); font-size: 13px; line-height: 1.4; display: grid; gap: 8px; justify-items: start; }
    .tag { padding: 2px 9px; border-radius: 999px; background: color-mix(in srgb, var(--undo) 22%, transparent); color: var(--undo); font-size: 12px; font-weight: 600; }

    .features { list-style: none; margin: 0; padding: 0; display: grid; gap: 18px; }
    .features li { display: flex; gap: 14px; align-items: flex-start; }
    .well { display: grid; place-items: center; flex: none; width: 40px; height: 40px; border-radius: 50%; background: var(--accent-soft); color: var(--accent); }
    h2 { font-size: 15px; font-weight: 600; line-height: 1.3; }
    .features p { margin-top: 2px; color: var(--muted); font-size: 14px; line-height: 1.45; }
    footer { color: var(--muted); font-size: 13px; display: flex; flex-wrap: wrap; gap: 4px 12px; }
    footer a { color: var(--muted); text-underline-offset: 3px; display: inline-flex; align-items: center; min-height: 40px; }

    @media (min-width: 600px) { .features { grid-template-columns: 1fr 1fr; gap: 24px 32px; } }
    @media (min-width: 900px) {
      .page { padding-top: 28px; gap: 48px; }
      .top { grid-template-columns: 1.1fr 0.9fr; gap: 64px; align-items: center; align-content: center; }
      .paper { transform: rotate(1.5deg); }
      .stage { padding-bottom: 72px; } .note { right: -12px; }
    }
    @media (min-width: 1100px) { .features { grid-template-columns: repeat(4, 1fr); gap: 28px; } }
  `,
})
export class WelcomePage {
  private readonly auth = inject(AuthApi);
  private readonly drive = inject(DRIVE_ADAPTER);
  private readonly router = inject(Router);
  private readonly sync = inject(SyncEngine);

  private readonly sanitizer = inject(DomSanitizer);
  protected readonly copy = COPY.welcome;
  protected readonly lockIcon = this.svg('lock', 14);
  protected readonly chevIcon = this.svg('chevD', 16);
  protected readonly features = COPY.welcome.features.map((f) => ({ ...f, svg: this.svg(f.icon, 20) }));
  protected readonly failed = signal(false);
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
    this.failed.set(false);
    try {
      await this.auth.signIn();
    } catch {
      // Popup closed or sign-in failed: stay here so the user can try again.
      this.busy.set(false);
      this.failed.set(true);
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

  private svg(name: IconName, size: number): SafeHtml {
    // Icon markup comes from the static table in icons.ts, so bypassing the sanitizer is safe.
    return this.sanitizer.bypassSecurityTrustHtml(icon(name, size));
  }
}
