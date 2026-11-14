import { Component, inject, input } from '@angular/core';
import { FilesService } from '../../books/files.service';
import { COPY } from '../../ui/copy';
import { BookCoverComponent } from './book-cover.component';
import { bookLine, type BookView } from './book-card.component';

/** The most recently opened book in progress, with a Resume button. */
@Component({
  selector: 'iqra-continue-card',
  imports: [BookCoverComponent],
  template: `
    <section class="continue">
      <iqra-book-cover class="cover" [book]="view().book" />
      <div class="body">
        <p class="eyebrow">{{ copy.continue }}</p>
        <h2 dir="auto">{{ view().book.title }}</h2>
        <p class="line">{{ line() }}</p>
        <div class="row">
          <button type="button" class="resume" (click)="files.openBook(view().book)">{{ copy.resume }}</button>
          <div class="bar" aria-hidden="true"><i [style.width.%]="percent()"></i></div>
        </div>
      </div>
    </section>
  `,
  styles: `
    :host { display: block; }
    .continue {
      display: grid;
      grid-template-columns: 76px minmax(0, 1fr);
      align-items: center;
      gap: 14px;
      margin: 0 18px 16px;
      padding: 14px;
      border-radius: var(--radius-card);
      background: var(--accent-soft);
    }
    .eyebrow {
      margin: 0;
      color: var(--accent);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    h2 {
      margin: 4px 0 2px;
      font-size: 17px;
      font-weight: 600;
      line-height: 1.25;
      text-wrap: balance;
    }
    h2:dir(rtl) { font-family: var(--ar); }
    .line {
      margin: 0 0 10px;
      color: var(--muted);
      font-size: 12.5px;
      font-variant-numeric: tabular-nums;
    }
    .row { display: flex; align-items: center; gap: 10px; }
    .resume {
      flex: none;
      padding: 8px 12px;
      border: 0;
      border-radius: var(--radius-control);
      background: var(--accent);
      color: var(--accent-fg);
      font-size: 13px;
      font-weight: 600;
      white-space: nowrap;
    }
    .bar {
      flex: 1;
      min-width: 0;
      height: 4px;
      border-radius: 4px;
      overflow: hidden;
      background: color-mix(in srgb, var(--fg) 12%, transparent);
    }
    .bar i { display: block; height: 100%; background: var(--accent); }
  `,
})
export class ContinueCardComponent {
  readonly view = input.required<BookView>();
  protected readonly files = inject(FilesService);
  protected readonly copy = COPY.library;

  protected line(): string {
    const v = this.view();
    return bookLine(v.book, v.progress, v.downloaded);
  }

  protected percent(): number {
    return Math.max(2, Math.round(this.view().progress * 100));
  }
}
