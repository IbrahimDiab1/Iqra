import { Component, inject, input } from '@angular/core';
import { FilesService } from '../../books/files.service';
import { BookCoverComponent } from './book-cover.component';
import type { BookView } from './book-card.component';
import { TOP_COPY } from './top-copy';

/** A recently read book in the Continue reading row: cover, title and progress. Tap opens it. */
@Component({
  selector: 'iqra-recent-card',
  imports: [BookCoverComponent],
  template: `
    <button type="button" class="card" [attr.aria-label]="label()" (click)="files.openBook(view().book)">
      <iqra-book-cover [book]="view().book" />
      <span class="t" dir="auto">{{ view().book.title }}</span>
      <span class="p">{{ percent() }}%</span>
      <span class="bar" aria-hidden="true"><i [style.width.%]="percent()"></i></span>
    </button>
  `,
  styles: `
    :host { display: block; }
    .card { display: block; width: 100%; padding: 0; border: 0; background: none; color: inherit; text-align: start; cursor: pointer; }
    .t {
      display: -webkit-box;
      margin-top: 7px;
      overflow: hidden;
      font-size: 12.5px;
      font-weight: 600;
      line-height: 1.25;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
    .t:dir(rtl) { font-family: var(--ar); }
    .p { display: block; margin-top: 2px; color: var(--muted); font-size: 11.5px; font-variant-numeric: tabular-nums; }
    .bar { display: block; height: 3px; margin-top: 4px; border-radius: 3px; overflow: hidden; background: color-mix(in srgb, var(--fg) 12%, transparent); }
    .bar i { display: block; height: 100%; background: var(--accent); }
  `,
})
export class RecentCardComponent {
  readonly view = input.required<BookView>();
  protected readonly files = inject(FilesService);

  protected percent(): number {
    return Math.round(this.view().progress * 100);
  }

  protected label(): string {
    return `${TOP_COPY.openBook(this.view().book.title)}, ${TOP_COPY.percentRead(this.percent())}`;
  }
}
