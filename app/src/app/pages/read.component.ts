import { Component } from '@angular/core';
import { COPY } from '../ui/copy';

/** Stub for the reader. The real reader replaces this in a later task. */
@Component({
  selector: 'f-read-page',
  template: `<section class="page"><p>{{ text }}</p></section>`,
  styles: `
    .page { display: grid; place-items: center; min-height: 100%; padding: 24px var(--gutter); }
    p { margin: 0; color: var(--muted); font-size: 15px; }
  `,
})
export class ReadPage {
  protected readonly text = COPY.placeholder.soon;
}
