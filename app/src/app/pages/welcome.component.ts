import { Component } from '@angular/core';
import { COPY } from '../ui/copy';

@Component({
  selector: 'f-welcome-page',
  template: `
    <section class="page">
      <h1>{{ copy.title }}</h1>
      <p>{{ copy.body }}</p>
      <button type="button" class="cta">{{ copy.cta }}</button>
      <p class="hint">{{ copy.offline }}</p>
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
    .hint { font-size: 13px; }
  `,
})
export class WelcomePage {
  protected readonly copy = COPY.welcome;
}
