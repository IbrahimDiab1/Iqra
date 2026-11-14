import {
  Component,
  ElementRef,
  afterEveryRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { FilesService } from '../../books/files.service';
import type { ID } from '../../core/models';
import { COPY } from '../../ui/copy';
import { icon } from '../../ui/icons';
import type { BookView } from './book-card.component';
import { BookCoverComponent } from './book-cover.component';

interface DragState {
  id: ID;
  pointerId: number;
  startY: number;
  /** Index of the dragged row when the drag began. */
  from: number;
  /** Index the row would land on if released now. */
  to: number;
  /** Row height in px. Rows have no gap, so this is the step between rows. */
  pitch: number;
  /** Ids in the order shown when the drag began. */
  base: ID[];
  /** How far the pointer has moved since the drag began, in px. The dragged row follows it. */
  offset: number;
}

function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * The Up next list. Drag a row by its handle, or focus a row and press Alt+ArrowUp or Alt+ArrowDown.
 * Each reorder emits the new visible order; the page saves it.
 */
@Component({
  selector: 'iqra-up-next',
  imports: [BookCoverComponent],
  template: `
    <section class="upnext">
      <h2 class="title">{{ copy.upNext }}</h2>
      <ol class="rows">
        @for (v of shown(); track v.book.id; let i = $index) {
          <li
            class="row"
            tabindex="0"
            [attr.data-id]="v.book.id"
            [class.dragging]="drag()?.id === v.book.id"
            [style.transform]="rowTransform(i)"
            (keydown)="onRowKey($event, i)"
          >
            <button type="button" class="open" (click)="files.openBook(v.book)">
              <iqra-book-cover class="thumb" [book]="v.book" />
              <span class="name" dir="auto">{{ v.book.title }}</span>
            </button>
            <button
              type="button"
              class="handle"
              tabindex="-1"
              [attr.aria-label]="copy.reorder"
              [innerHTML]="gripIcon"
              (pointerdown)="onHandleDown($event, i)"
              (pointermove)="onHandleMove($event)"
              (pointerup)="onHandleUp($event)"
              (pointercancel)="onHandleUp($event)"
            ></button>
          </li>
        }
      </ol>
    </section>
  `,
  styles: `
    :host { display: block; }
    .upnext { margin-bottom: 18px; }
    .title { margin: 6px 0 8px; font-size: 15px; font-weight: 600; }
    .rows { margin: 0; padding: 0; list-style: none; }
    .row {
      position: relative;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 4px;
      border-bottom: 1px solid var(--line);
      background: var(--bg);
      transition: transform 160ms ease;
    }
    .row:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
    .row.dragging {
      z-index: 1;
      border-bottom-color: transparent;
      border-radius: 12px;
      background: var(--surface);
      box-shadow: var(--shadow);
      transition: none;
    }
    .open {
      display: flex;
      flex: 1;
      align-items: center;
      gap: 12px;
      min-width: 0;
      padding: 0;
      border: 0;
      background: none;
      color: inherit;
      text-align: start;
    }
    .thumb { flex: none; width: 40px; }
    .name {
      min-width: 0;
      overflow: hidden;
      font-size: 14px;
      font-weight: 500;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .handle {
      display: grid;
      flex: none;
      place-items: center;
      width: 40px;
      height: 40px;
      border: 0;
      border-radius: 10px;
      background: none;
      color: var(--muted);
      touch-action: none;
      cursor: grab;
    }
    .handle:active { cursor: grabbing; }
  `,
})
export class UpNextComponent {
  /** The visible Up next books, in order. */
  readonly rows = input.required<BookView[]>();
  /** The new visible order of book ids after a reorder. */
  readonly reorder = output<ID[]>();

  protected readonly files = inject(FilesService);
  protected readonly copy = COPY.library;
  protected readonly gripIcon: SafeHtml;

  /** The order shown while a reorder is in flight. Cleared when the rows change. */
  private readonly preview = signal<ID[] | null>(null);
  protected readonly shown = computed<BookView[]>(() => {
    const order = this.preview();
    const rows = this.rows();
    if (!order) return rows;
    // Ids missing from the preview keep their place at the end.
    const rank = (id: ID) => (order.includes(id) ? order.indexOf(id) : Number.MAX_SAFE_INTEGER);
    return [...rows].sort((a, b) => rank(a.book.id) - rank(b.book.id));
  });
  protected readonly drag = signal<DragState | null>(null);
  private pendingFocus: ID | null = null;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    this.gripIcon = inject(DomSanitizer).bypassSecurityTrustHtml(icon('grip', 18));

    // New rows mean the database has the order, so the preview gives way to it.
    effect(() => {
      this.rows();
      untracked(() => this.preview.set(null));
    });

    // A keyboard move re-renders the list, which drops focus from the moved row. Put it back.
    afterEveryRender(() => {
      const id = this.pendingFocus;
      if (id === null) return;
      this.pendingFocus = null;
      this.host.nativeElement.querySelector<HTMLElement>(`li.row[data-id="${id}"]`)?.focus();
    });
  }

  protected rowTransform(index: number): string | null {
    const d = this.drag();
    if (!d) return null;
    if (index === d.from) return `translateY(${d.offset}px)`;
    if (d.to > d.from && index > d.from && index <= d.to) return `translateY(${-d.pitch}px)`;
    if (d.to < d.from && index >= d.to && index < d.from) return `translateY(${d.pitch}px)`;
    return null;
  }

  protected onHandleDown(e: PointerEvent, index: number): void {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    const base = this.shown().map((v) => v.book.id);
    this.drag.set({
      id: base[index],
      pointerId: e.pointerId,
      startY: e.clientY,
      from: index,
      to: index,
      pitch: handle.closest('li')?.offsetHeight ?? 56,
      base,
      offset: 0,
    });
  }

  protected onHandleMove(e: PointerEvent): void {
    const d = this.drag();
    if (!d || e.pointerId !== d.pointerId) return;
    const dy = e.clientY - d.startY;
    const to = Math.min(d.base.length - 1, Math.max(0, d.from + Math.round(dy / d.pitch)));
    // Other rows shift with CSS while dragging. The DOM order changes only on release.
    this.drag.set({ ...d, to, offset: dy });
  }

  protected onHandleUp(e: PointerEvent): void {
    const d = this.drag();
    if (!d || e.pointerId !== d.pointerId) return;
    this.drag.set(null);
    if (d.to !== d.from) this.commit(moveItem(d.base, d.from, d.to));
  }

  /** Alt+ArrowUp and Alt+ArrowDown move the focused row by one place. */
  protected onRowKey(e: KeyboardEvent, index: number): void {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const base = this.shown().map((v) => v.book.id);
    const target = index + (e.key === 'ArrowUp' ? -1 : 1);
    if (target < 0 || target >= base.length) return;
    this.pendingFocus = base[index];
    this.commit(moveItem(base, index, target));
  }

  private commit(next: ID[]): void {
    this.preview.set(next);
    this.reorder.emit(next);
  }
}
