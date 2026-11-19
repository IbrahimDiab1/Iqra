import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { AnnotationService } from '../annotations/annotation.service';
import type { Annotation, Book } from '../core/models';
import { COPY } from '../ui/copy';
import { icon } from '../ui/icons';
import { ToastService } from '../ui/toast.service';
import type { Place } from './jump-history';
import { chapterAt } from './outline';

/** The Bookmarks tab of the book panel. */
@Component({
  selector: 'iqra-bookmarks-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
  @if (bookmarks().length === 0) {
    <p class="note">{{ ann.noBookmarks }}</p>
  } @else {
    <ul class="list">
      @for (b of bookmarks(); track b.a.id) {
        <li class="item">
          <button type="button" class="row bm" (click)="go(b.page)">
            <span class="num">{{ ann.pageShort(b.page) }}</span>
            <span class="title" dir="auto">{{ b.chapter }}</span>
          </button>
          <button type="button" class="tool" [attr.aria-label]="ann.removeBookmark" (click)="removeBookmark(b.a)" [innerHTML]="icons.trash"></button>
        </li>
      }
    </ul>
  }
  `,
  styles: `
    button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .note { margin: 12px 2px; color: var(--muted); font-size: 14px; }
    .list { list-style: none; margin: 0; padding: 0; }
    .item { display: flex; align-items: center; border-bottom: 1px solid var(--line); }
    .row { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; min-height: 44px; padding-block: 6px; padding-inline-end: 6px; border: 0; background: none; color: var(--fg); font: 15px var(--ui); text-align: start; cursor: pointer; }
    .row .title { flex: 1; min-width: 0; }
    .row .num { flex: none; color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; }
    .tool { flex: none; display: inline-grid; place-items: center; width: 40px; height: 40px; border: 0; border-radius: var(--radius-control); background: none; color: var(--muted); cursor: pointer; }
  `,
})
export class BookmarksTabComponent {
  readonly book = input.required<Book>();
  /** This book's live annotations. */
  readonly annotations = input<Annotation[]>([]);
  readonly jump = output<Place>();
  /** A bookmark was chosen: the panel closes. */
  readonly done = output<void>();

  protected readonly ann = COPY.annotations;
  private readonly sanitizer = inject(DomSanitizer);
  protected readonly icons = { trash: this.sanitizer.bypassSecurityTrustHtml(icon('trash', 18)) };
  private readonly service = inject(AnnotationService);
  private readonly toast = inject(ToastService);

  protected readonly bookmarks = computed(() =>
    this.annotations()
      .filter((a) => !a.deleted && a.type === 'bookmark' && a.page !== undefined)
      .map((a) => ({ a, page: a.page!, chapter: chapterAt(this.book().outline, a.page!)?.title ?? '' }))
      .sort((x, y) => x.page - y.page || x.a.createdAt - y.a.createdAt),
  );

  protected go(page: number): void {
    this.jump.emit({ page, offset: 0 });
    this.done.emit();
  }

  protected async removeBookmark(a: Annotation): Promise<void> {
    try {
      const rec = await this.service.remove(a.id);
      if (rec) this.toast.show(this.ann.deleted, { undo: () => void this.service.restore(rec) });
    } catch (err) {
      console.warn('Could not remove the bookmark', err);
      this.toast.show(this.ann.saveFailed);
    }
  }
}
