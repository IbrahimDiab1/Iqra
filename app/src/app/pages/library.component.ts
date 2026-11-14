import { Component } from '@angular/core';
import { SyncStatusComponent } from '../sync/sync-status.component';
import { COPY } from '../ui/copy';

@Component({
  imports: [SyncStatusComponent],
  selector: 'f-library-page',
  template: `
    <section class="page">
      <h1>{{ copy.title }}</h1>
      <iqra-sync-status />
      <p>{{ copy.emptyAll }}</p>
    </section>
  `,
  styles: `
    .page { padding: 24px var(--gutter); }
    h1 { margin: 0 0 12px; font-size: 22px; font-weight: 600; }
    p { margin: 0; color: var(--muted); }
  `,
})
export class LibraryPage {
  protected readonly copy = COPY.library;
}
