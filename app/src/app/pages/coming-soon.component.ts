import { Component, inject } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { COPY } from '../ui/copy';
import { icon, type IconName } from '../ui/icons';

/** Route data for a placeholder page. */
export interface ComingSoonData {
  icon: IconName;
  title: string;
  text: string;
  next: string;
}

@Component({
  selector: 'f-coming-soon-page',
  template: `
    <section class="page">
      <span class="well" [innerHTML]="svg"></span>
      <h1>{{ data.title }}</h1>
      <p class="text">{{ data.text }}</p>
      <span class="pill">{{ soon }}</span>
      <p class="next">{{ data.next }}</p>
    </section>
  `,
  styles: `
    .page { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; min-height: 100%; padding: 24px var(--gutter); text-align: center; }
    .well { display: grid; place-items: center; width: 64px; height: 64px; border-radius: 50%; background: var(--accent-soft); color: var(--accent); }
    h1 { margin: 8px 0 0; font-family: var(--book); font-size: 28px; font-weight: 600; }
    p { margin: 0; }
    .text { max-width: 38ch; color: var(--muted); font-size: 15px; line-height: 1.5; }
    .pill { padding: 4px 12px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-size: 12px; font-weight: 600; }
    .next { color: var(--muted); font-size: 13px; }
  `,
})
export class ComingSoonPage {
  protected readonly data = inject(ActivatedRoute).snapshot.data as ComingSoonData;
  protected readonly soon = COPY.placeholder.soon;
  protected readonly svg: SafeHtml = inject(DomSanitizer).bypassSecurityTrustHtml(icon(this.data.icon, 30));
}
