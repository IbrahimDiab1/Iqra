import { Component } from '@angular/core';
import { COPY } from '../ui/copy';

@Component({
  selector: 'f-coming-soon-page',
  template: `<section class="page"><p>{{ text }}</p></section>`,
  styles: `
    .page { display: grid; place-items: center; min-height: 100%; padding: 24px var(--gutter); }
    p { margin: 0; color: var(--muted); font-size: 15px; }
  `,
})
export class ComingSoonPage {
  protected readonly text = COPY.placeholder.soon;
}
