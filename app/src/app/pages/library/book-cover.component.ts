import { Component, computed, inject, input } from '@angular/core';
import type { Book } from '../../core/models';
import { CoverCache } from '../../books/cover-cache';

/** A book cover: the cached image, or a teal block with the title until one is available. */
@Component({
  selector: 'iqra-book-cover',
  template: `
    @if (url(); as src) {
      <img class="img" [src]="src" alt="" />
    } @else {
      <span class="placeholder" dir="auto">{{ book().title }}</span>
    }
  `,
  styles: `
    :host { display: block; position: relative; }
    .img, .placeholder {
      display: block;
      width: 100%;
      aspect-ratio: 2 / 3;
      border-radius: 4px 8px 8px 4px;
      box-shadow: inset 4px 0 0 color-mix(in srgb, var(--fg) 16%, transparent), 0 3px 10px color-mix(in srgb, var(--fg) 14%, transparent);
    }
    .img { object-fit: cover; background: var(--surface-2); }
    .placeholder {
      display: flex;
      align-items: flex-start;
      padding: 10px 9px;
      overflow: hidden;
      background: var(--accent);
      color: var(--accent-fg);
      font-family: var(--book);
      font-size: 12px;
      font-weight: 600;
      line-height: 1.18;
      overflow-wrap: anywhere;
    }
    .placeholder:dir(rtl) { font-family: var(--ar); font-size: 14px; }
  `,
})
export class BookCoverComponent {
  readonly book = input.required<Book>();
  private readonly covers = inject(CoverCache);
  protected readonly url = computed(() => this.covers.get(this.book())());
}
