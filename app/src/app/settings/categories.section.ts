import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, inject, signal } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { CategoryService, type CategoryNameError } from '../books/category.service';
import type { Category, ID } from '../core/models';
import { icon } from '../ui/icons';
import { dropIndex } from './category-order';
import { SETTINGS_COPY } from './settings-copy';

/** Where a pointer drag started, and which row it would drop on. */
interface Drag {
  id: ID;
  from: number;
  over: number;
  startY: number;
  dy: number;
  rows: { top: number; height: number }[];
}

/** Rename, add, delete and reorder categories. Deleting removes the category from every book and can be undone. */
@Component({
  selector: 'iqra-categories-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div [attr.data-ready]="ready() ? '' : null">
      @if (ready() && list().length === 0) {
        <p class="empty">{{ c.none }}</p>
      }
      <ul class="list" #listEl>
        @for (cat of list(); track cat.id; let i = $index) {
          <li
            class="row"
            [attr.data-cat]="cat.id"
            [class.dragging]="drag()?.id === cat.id"
            [class.drop]="drag() !== null && drag()!.over === i && drag()!.id !== cat.id"
            [style.transform]="drag()?.id === cat.id ? 'translateY(' + drag()!.dy + 'px)' : null"
          >
            <button
              type="button"
              class="ib grip"
              [attr.aria-label]="c.drag(cat.name)"
              (pointerdown)="dragStart($event, cat, i)"
              (pointermove)="dragMove($event)"
              (pointerup)="dragEnd($event)"
              (pointercancel)="dragCancel()"
              (keydown.escape)="dragCancel()"
              [innerHTML]="gripIcon"
            ></button>

            @if (renamingId() === cat.id) {
              <input
                class="field name-input"
                dir="auto"
                data-testid="rename-input"
                [attr.aria-label]="c.renameInput"
                [attr.aria-invalid]="error() ? 'true' : null"
                [value]="cat.name"
                (input)="error.set(null)"
                (keydown.enter)="saveRename(cat, $any($event.target).value)"
                (keydown.escape)="cancelRename()"
              />
            } @else {
              <span class="name" dir="auto" data-testid="cat-name">{{ cat.name }}</span>
            }

            <button type="button" class="ib" data-testid="up" [attr.aria-label]="c.moveUp(cat.name)" [disabled]="i === 0" (click)="move(i, i - 1)" [innerHTML]="upIcon"></button>
            <button type="button" class="ib" data-testid="down" [attr.aria-label]="c.moveDown(cat.name)" [disabled]="i === list().length - 1" (click)="move(i, i + 1)" [innerHTML]="downIcon"></button>
            <button type="button" class="ib" data-testid="rename" [attr.aria-label]="c.renameLabel(cat.name)" (click)="startRename(cat)" [innerHTML]="editIcon"></button>
            <button type="button" class="ib danger" data-testid="delete" [attr.aria-label]="c.deleteLabel(cat.name)" (click)="remove(cat)" [innerHTML]="trashIcon"></button>
          </li>
        }
      </ul>

      @if (error()) {
        <p class="error" role="alert" data-testid="error">{{ error() }}</p>
      }

      <div class="add-row">
        <input
          class="field"
          dir="auto"
          data-testid="add-input"
          [attr.aria-label]="c.addLabel"
          [placeholder]="c.newPlaceholder"
          (input)="error.set(null)"
          (keydown.enter)="add($any($event.target))"
          #addInput
        />
        <button type="button" class="btn" data-testid="add" (click)="add(addInput)">{{ c.add }}</button>
      </div>
    </div>
  `,
  styles: `
    :host { display: block; }
    .list { list-style: none; margin: 0; padding: 0; }
    .row { display: flex; align-items: center; gap: 2px; min-height: 48px; border-top: 1px solid var(--line); background: var(--bg); }
    .row:first-child { border-top: 0; }
    .row.drop { box-shadow: inset 0 2px 0 var(--accent); }
    .row.dragging { position: relative; z-index: 1; background: var(--surface); box-shadow: var(--shadow); border-radius: var(--radius-control); opacity: .95; }
    .name, .name-input { flex: 1; min-width: 0; }
    .name { font-size: 15px; overflow-wrap: anywhere; padding: 0 6px; }
    .ib { display: grid; place-items: center; flex: none; width: 40px; height: 40px; border: 0; border-radius: var(--radius-control); background: none; color: var(--muted); cursor: pointer; }
    .ib:hover:not(:disabled) { background: var(--surface-2); color: var(--fg); }
    .ib:disabled { opacity: .35; cursor: default; }
    .ib.danger { color: var(--danger); }
    .grip { cursor: grab; touch-action: none; }
    .dragging .grip { cursor: grabbing; }
    .field { box-sizing: border-box; min-height: 40px; border: 1px solid var(--line); border-radius: var(--radius-control); padding: 0 12px; font: 16px var(--ui); background: var(--surface-2); color: var(--fg); }
    .add-row { display: flex; gap: 8px; margin-top: 10px; }
    .add-row .field { flex: 1; min-width: 0; }
    .btn { min-height: 40px; padding: 0 14px; border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--surface); color: var(--fg); font: 600 14px var(--ui); cursor: pointer; }
    .empty { margin: 0 0 8px; font-size: 14px; color: var(--muted); }
    .error { margin: 6px 2px 0; font-size: 13px; color: var(--danger); }
    .ib:focus-visible, .btn:focus-visible, .field:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    @media (prefers-reduced-motion: no-preference) { .row.dragging { transition: box-shadow 120ms; } }
  `,
})
export class CategoriesSection {
  private readonly categories = inject(CategoryService);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly sanitizer = inject(DomSanitizer);

  protected readonly c = SETTINGS_COPY.categories;
  protected readonly ready = this.categories.ready;
  protected readonly list = this.categories.list;

  protected readonly renamingId = signal<ID | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly drag = signal<Drag | null>(null);

  protected readonly gripIcon = this.svg('grip');
  protected readonly upIcon = this.svg('chevD', true);
  protected readonly downIcon = this.svg('chevD');
  protected readonly editIcon = this.svg('edit');
  protected readonly trashIcon = this.svg('trash');

  /** Icon markup comes from the static ICON table in icons.ts, so it is safe to trust. */
  private svg(name: Parameters<typeof icon>[0], flip = false) {
    const markup = icon(name, 20);
    return this.sanitizer.bypassSecurityTrustHtml(flip ? markup.replace('<svg ', '<svg style="transform:rotate(180deg)" ') : markup);
  }

  protected async move(from: number, to: number): Promise<void> {
    await this.categories.move(from, to);
  }

  private message(error: CategoryNameError): string {
    return error === 'empty' ? this.c.empty : this.c.duplicate;
  }

  protected startRename(cat: Category): void {
    this.error.set(null);
    this.renamingId.set(cat.id);
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLInputElement>('[data-testid="rename-input"]')?.select(), { injector: this.injector });
  }

  protected cancelRename(): void {
    this.renamingId.set(null);
    this.error.set(null);
  }

  protected async saveRename(cat: Category, raw: string): Promise<void> {
    const failed = await this.categories.rename(cat, raw);
    if (failed) {
      this.error.set(this.message(failed));
      return;
    }
    this.renamingId.set(null);
    this.error.set(null);
  }

  protected async add(input: HTMLInputElement): Promise<void> {
    const raw = input.value;
    if (raw.trim() === '') return;
    // Cleared at once, as before the shared service: the next name can be typed while this one saves.
    input.value = '';
    const failed = await this.categories.add(raw);
    if (failed) {
      if (input.value === '') input.value = raw;
      this.error.set(this.message(failed));
      return;
    }
    this.error.set(null);
  }

  /** Deletes the category; the toast offers Undo. */
  protected async remove(cat: Category): Promise<void> {
    await this.categories.remove(cat);
  }

  protected dragStart(event: PointerEvent, cat: Category, from: number): void {
    if (event.button > 0) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    const rows = Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('[data-cat]')).map((r) => {
      const box = r.getBoundingClientRect();
      return { top: box.top, height: box.height };
    });
    this.drag.set({ id: cat.id, from, over: from, startY: event.clientY, dy: 0, rows });
  }

  protected dragMove(event: PointerEvent): void {
    const d = this.drag();
    if (!d) return;
    this.drag.set({ ...d, dy: event.clientY - d.startY, over: dropIndex(d.rows, event.clientY) });
  }

  protected dragEnd(event: PointerEvent): void {
    const d = this.drag();
    if (!d) return;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    this.drag.set(null);
    void this.move(d.from, d.over);
  }

  protected dragCancel(): void {
    this.drag.set(null);
  }
}
