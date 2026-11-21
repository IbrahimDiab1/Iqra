import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import type { Category, ID } from '../../core/models';
import { COPY } from '../../ui/copy';
import { icon } from '../../ui/icons';
import { CategoryService, type CategoryNameError } from '../category.service';
import { UNCATEGORIZED } from './library-query';

/** How many books each chip stands for. */
export interface CategoryCounts {
  all: number;
  uncategorized: number;
  byId: ReadonlyMap<ID, number>;
}

interface MenuState {
  cat: Category;
  index: number;
  left: number;
  top: number;
  rtl: boolean;
}

const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP_PX = 10;
const MENU_WIDTH_PX = 184;
const ALL_KEY = 'all';
const ADD_KEY = '+';

/**
 * The Library's category chips: All, Uncategorized, each category in order and a `+` to add one.
 * A plain click selects one chip. Ctrl/Cmd/Shift-click or a long press adds or removes a chip
 * (several chips match with OR). Categories are managed in place: right-click or the chip's menu button
 * opens Rename, Delete (with Undo) and Move left/right. The row is one toolbar with a roving tab stop.
 * The selection is owned by the page: this component takes `selected` and emits `selectedChange`.
 */
@Component({
  selector: 'iqra-category-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div #row class="strip" role="toolbar" aria-orientation="horizontal" [attr.aria-label]="c.label" (focusin)="onFocusIn($event)" (scroll)="reportHidden()" (keydown)="onRowKey($event)">
      <button
        type="button"
        class="chip"
        data-chip="all"
        [attr.aria-pressed]="selected().length === 0"
        [attr.tabindex]="tabKey() === 'all' ? 0 : -1"
        (click)="chooseAll()"
      ><span>{{ c.all }}</span><span class="ct">{{ counts().all }}</span></button>
      <button
        type="button"
        class="chip"
        data-chip="uncategorized"
        [attr.aria-pressed]="isOn(uncategorized)"
        [attr.tabindex]="tabKey() === 'uncategorized' ? 0 : -1"
        (click)="onChipClick($event, uncategorized)"
        (pointerdown)="pressStart($event, uncategorized)"
        (pointermove)="pressMove($event)"
        (pointerup)="pressEnd()"
        (pointercancel)="pressEnd()"
        (pointerleave)="pressEnd()"
      ><span>{{ c.uncategorized }}</span><span class="ct">{{ counts().uncategorized }}</span></button>

      @for (cat of categories(); track cat.id; let i = $index) {
        <span class="wrap" [attr.data-cat]="cat.id" [class.on]="isOn(cat.id)" [class.editing]="renamingId() === cat.id">
          @if (renamingId() === cat.id) {
            <input
              class="field"
              dir="auto"
              data-testid="rename-input"
              [attr.aria-label]="c.renameInput"
              [attr.aria-invalid]="error() ? 'true' : null"
              [value]="cat.name"
              (input)="error.set(null)"
              (keydown.enter)="saveRename(cat, $any($event.target).value)"
              (keydown.escape)="cancelEdit($event, cat.id)"
              (blur)="cancelEdit(null, null)"
            />
          } @else {
            <button
              type="button"
              class="chip has-more"
              [attr.data-chip]="cat.id"
              [attr.aria-pressed]="isOn(cat.id)"
              [attr.tabindex]="tabKey() === cat.id ? 0 : -1"
              (click)="onChipClick($event, cat.id)"
              (contextmenu)="onContextMenu($event, cat, i)"
              (pointerdown)="pressStart($event, cat.id)"
              (pointermove)="pressMove($event)"
              (pointerup)="pressEnd()"
              (pointercancel)="pressEnd()"
              (pointerleave)="pressEnd()"
              (keydown)="onCatKey($event, cat, i)"
            ><span dir="auto" class="nm">{{ cat.name }}</span><span class="ct">{{ counts().byId.get(cat.id) ?? 0 }}</span></button>
            <button
              type="button"
              class="more"
              tabindex="-1"
              data-testid="more"
              aria-haspopup="menu"
              [attr.aria-label]="c.more(cat.name)"
              [attr.aria-expanded]="menu()?.cat?.id === cat.id"
              (click)="toggleMenu($event, cat, i)"
              [innerHTML]="moreIcon"
            ></button>
          }
        </span>
      }

      @if (adding()) {
        <input
          class="field add-field"
          dir="auto"
          data-testid="add-input"
          [attr.aria-label]="c.newLabel"
          [attr.aria-invalid]="error() ? 'true' : null"
          [placeholder]="c.newPlaceholder"
          (input)="error.set(null)"
          (keydown.enter)="saveAdd($any($event.target).value)"
          (keydown.escape)="cancelEdit($event, ADD_KEY)"
          (blur)="cancelEdit(null, null)"
        />
      } @else {
        <button
          type="button"
          class="chip plus"
          data-chip="+"
          data-testid="add"
          [attr.aria-label]="c.add"
          [attr.tabindex]="tabKey() === '+' ? 0 : -1"
          (click)="startAdd()"
          [innerHTML]="plusIcon"
        ></button>
      }
    </div>

    @if (error()) {
      <p class="error" role="alert" data-testid="error">{{ error() }}</p>
    }

    @if (menu(); as m) {
      <div
        #menuEl
        class="menu"
        role="menu"
        data-testid="menu"
        [attr.aria-label]="c.more(m.cat.name)"
        [style.left.px]="m.left"
        [style.top.px]="m.top"
        (keydown)="onMenuKey($event)"
      >
        <button type="button" role="menuitem" data-testid="menu-rename" (click)="menuRename()">{{ c.rename }}</button>
        <button type="button" role="menuitem" data-testid="menu-left" [disabled]="!canMove(m, -1)" (click)="menuMove(-1)">{{ c.moveLeft }}</button>
        <button type="button" role="menuitem" data-testid="menu-right" [disabled]="!canMove(m, 1)" (click)="menuMove(1)">{{ c.moveRight }}</button>
        <button type="button" role="menuitem" class="danger" data-testid="menu-delete" (click)="menuDelete()">{{ c.delete }}</button>
      </div>
    }
  `,
  styles: `
    :host { display: block; min-width: 0; margin-bottom: 12px; }
    .strip {
      display: flex;
      align-items: center;
      gap: 6px;
      /* Room for the focus rings the scroll box would clip. */
      padding: 3px;
      overflow-x: auto;
      /* One line that scrolls by touch, wheel or keyboard; the bar itself is hidden. */
      scrollbar-width: none;
    }
    .strip::-webkit-scrollbar { display: none; }
    .wrap { display: inline-flex; flex: none; align-items: center; max-width: 100%; }
    .chip {
      display: inline-flex;
      flex: none;
      align-items: center;
      gap: 6px;
      min-height: 40px;
      max-width: 240px;
      padding: 6px 14px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: var(--surface);
      color: var(--fg);
      font-size: 13px;
      font-weight: 500;
      white-space: nowrap;
      cursor: pointer;
      touch-action: manipulation;
      -webkit-touch-callout: none;
      user-select: none;
    }
    .chip:hover { background: var(--surface-2); }
    .chip[aria-pressed='true'] { background: var(--fg); border-color: var(--fg); color: var(--surface); }
    .nm { overflow: hidden; min-width: 0; text-overflow: ellipsis; }
    .ct { color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
    .chip[aria-pressed='true'] .ct { color: inherit; opacity: 0.75; }
    .plus { justify-content: center; width: 40px; padding: 0; }

    /* The menu button sits inside the pill, after the chip. It shows on hover, focus and for selected chips. */
    .more {
      display: none;
      flex: none;
      place-items: center;
      width: 32px;
      height: 40px;
      margin-inline-start: -6px;
      padding: 0;
      border: 0;
      border-radius: 999px;
      background: none;
      color: var(--muted);
      cursor: pointer;
    }
    .wrap:hover .more, .wrap:focus-within .more, .wrap.on .more { display: grid; }
    .wrap:hover .chip.has-more, .wrap:focus-within .chip.has-more, .wrap.on .chip.has-more {
      border-start-end-radius: 0;
      border-end-end-radius: 0;
      border-inline-end-width: 0;
    }
    .wrap.on .more, .wrap:hover .more, .wrap:focus-within .more {
      height: 40px;
      width: 36px;
      margin-inline-start: 0;
      border: 1px solid var(--line);
      border-inline-start-width: 0;
      border-start-start-radius: 0;
      border-end-start-radius: 0;
      background: var(--surface);
    }
    .wrap.on .more { background: var(--fg); border-color: var(--fg); color: var(--surface); }
    .more:hover { color: var(--fg); }
    .wrap.on .more:hover { color: var(--surface); }

    .field {
      box-sizing: border-box;
      flex: none;
      width: 180px;
      max-width: 70vw;
      min-height: 40px;
      padding: 0 12px;
      border: 1px solid var(--accent);
      border-radius: 999px;
      background: var(--surface-2);
      color: var(--fg);
      font: 16px var(--ui);
    }
    .chip:focus-visible, .more:focus-visible, .field:focus-visible, .menu button:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
    .error { margin: 4px 6px 0; color: var(--danger); font-size: 13px; }

    .menu {
      position: fixed;
      z-index: 40;
      display: flex;
      flex-direction: column;
      width: ${MENU_WIDTH_PX}px;
      padding: 6px;
      border: 1px solid var(--line);
      border-radius: var(--radius-control);
      background: var(--surface);
      box-shadow: var(--shadow);
    }
    .menu button {
      min-height: 40px;
      padding: 0 12px;
      border: 0;
      border-radius: 8px;
      background: none;
      color: var(--fg);
      font: 500 14px var(--ui);
      text-align: start;
      cursor: pointer;
    }
    .menu button:hover:not(:disabled), .menu button:focus-visible { background: var(--surface-2); }
    .menu button:disabled { opacity: 0.4; cursor: default; }
    .menu .danger { color: var(--danger); }
  `,
})
export class CategoryBarComponent {
  private readonly service = inject(CategoryService);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly sanitizer = inject(DomSanitizer);

  readonly categories = input.required<Category[]>();
  readonly counts = input.required<CategoryCounts>();
  /** The selected category ids, `UNCATEGORIZED` included. Empty means All. */
  readonly selected = input<readonly ID[]>([]);
  readonly selectedChange = output<ID[]>();
  /** True while a selected chip is scrolled out of the visible part of the bar; the page then shows a summary chip. */
  readonly selectionHidden = output<boolean>();

  protected readonly c = COPY.categoryBar;
  protected readonly uncategorized = UNCATEGORIZED;
  protected readonly ADD_KEY = ADD_KEY;
  protected readonly moreIcon: SafeHtml = this.svg('more', 18);
  protected readonly plusIcon: SafeHtml = this.svg('plus', 18);

  private readonly row = viewChild.required<ElementRef<HTMLElement>>('row');
  private readonly menuEl = viewChild<ElementRef<HTMLElement>>('menuEl');

  protected readonly renamingId = signal<ID | null>(null);
  protected readonly adding = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly menu = signal<MenuState | null>(null);
  /** The chip that holds the toolbar's tab stop. Falls back to All when that chip is gone. */
  private readonly activeKey = signal<string>(ALL_KEY);
  protected readonly tabKey = computed(() => {
    const key = this.activeKey();
    if (key === ALL_KEY || key === 'uncategorized' || key === ADD_KEY) return key;
    return this.categories().some((cat) => cat.id === key) ? key : ALL_KEY;
  });

  private destroyed = false;
  private pressTimer: ReturnType<typeof setTimeout> | undefined;
  private pressStartAt: { x: number; y: number } | null = null;
  private suppressClick = false;
  private lastPointer = '';

  private hiddenReported = false;

  constructor() {
    // The open menu is fixed to the screen, so anything that moves its chip closes it.
    const close = (event: Event) => {
      if (this.menu() && !(event.target as HTMLElement | null)?.closest?.('.menu')) this.closeMenu(false);
    };
    window.addEventListener('scroll', close, { capture: true, passive: true });
    window.addEventListener('resize', close, { passive: true });
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.pressEnd();
      window.removeEventListener('scroll', close, { capture: true });
      window.removeEventListener('resize', close);
    });
    // A selection made earlier (kept from the last visit) or changed elsewhere must not sit out of sight.
    effect(() => {
      this.selected();
      this.categories();
      afterNextRender(
        () => {
          this.revealSelected();
          this.reportHidden();
        },
        { injector: this.injector },
      );
    });
  }

  private selectedChips(): HTMLElement[] {
    const keys = new Set(this.selected().map((id) => (id === UNCATEGORIZED ? 'uncategorized' : id)));
    return this.chipButtons().filter((el) => keys.has(el.dataset['chip'] ?? ''));
  }

  /** Scrolls the bar sideways until the first selected chip is fully inside it. Works in either direction. */
  private revealSelected(): void {
    const first = this.selectedChips()[0];
    if (!first) return;
    const box = this.row().nativeElement;
    const b = box.getBoundingClientRect();
    const r = first.getBoundingClientRect();
    if (r.left < b.left) box.scrollLeft -= b.left - r.left;
    else if (r.right > b.right) box.scrollLeft += r.right - b.right;
  }

  /** Tells the page whether any selected chip is out of view (1 px tolerance for rounding). */
  protected reportHidden(): void {
    if (this.destroyed) return;
    const b = this.row().nativeElement.getBoundingClientRect();
    const hidden = this.selectedChips().some((el) => {
      const r = el.getBoundingClientRect();
      return r.left < b.left - 1 || r.right > b.right + 1;
    });
    if (hidden !== this.hiddenReported) {
      this.hiddenReported = hidden;
      this.selectionHidden.emit(hidden);
    }
  }

  protected isOn(id: ID): boolean {
    return this.selected().includes(id);
  }

  // ---- selection ----

  protected chooseAll(): void {
    this.selectedChange.emit([]);
  }

  protected onChipClick(event: MouseEvent, id: ID): void {
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    if (event.ctrlKey || event.metaKey || event.shiftKey) this.toggle(id);
    else this.selectedChange.emit([id]);
  }

  private toggle(id: ID): void {
    const current = this.selected();
    this.selectedChange.emit(current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
  }

  protected pressStart(event: PointerEvent, id: ID): void {
    this.lastPointer = event.pointerType;
    this.pressEnd();
    if (event.button > 0 || (event.pointerType !== 'touch' && event.pointerType !== 'pen')) return;
    this.pressStartAt = { x: event.clientX, y: event.clientY };
    this.pressTimer = setTimeout(() => {
      this.pressTimer = undefined;
      this.suppressClick = true;
      this.toggle(id);
    }, LONG_PRESS_MS);
  }

  protected pressMove(event: PointerEvent): void {
    const start = this.pressStartAt;
    if (!start || this.pressTimer === undefined) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > LONG_PRESS_SLOP_PX) this.pressEnd();
  }

  protected pressEnd(): void {
    clearTimeout(this.pressTimer);
    this.pressTimer = undefined;
    this.pressStartAt = null;
  }

  // ---- keyboard: roving tab stop ----

  protected onFocusIn(event: FocusEvent): void {
    const key = (event.target as HTMLElement).closest<HTMLElement>('[data-chip]')?.dataset['chip'];
    if (key) this.activeKey.set(key);
  }

  private chipButtons(): HTMLElement[] {
    return Array.from(this.row().nativeElement.querySelectorAll<HTMLElement>('[data-chip]'));
  }

  private isRtl(): boolean {
    return getComputedStyle(this.row().nativeElement).direction === 'rtl';
  }

  protected onRowKey(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || event.altKey || event.ctrlKey || event.metaKey) return;
    const chips = this.chipButtons();
    const at = chips.indexOf(target);
    if (at < 0) return;
    let next = -1;
    if (event.key === 'ArrowRight') next = at + (this.isRtl() ? -1 : 1);
    else if (event.key === 'ArrowLeft') next = at + (this.isRtl() ? 1 : -1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = chips.length - 1;
    if (next < 0) return;
    event.preventDefault();
    chips[Math.min(chips.length - 1, next)]?.focus();
  }

  /** F2 renames and Alt+arrow moves the focused category; the context-menu key opens its menu. */
  protected onCatKey(event: KeyboardEvent, cat: Category, index: number): void {
    this.lastPointer = '';
    if (event.key === 'F2') {
      event.preventDefault();
      this.startRename(cat);
    } else if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      // Visual right is "later" in LTR and "earlier" in RTL.
      const toRight = event.key === 'ArrowRight';
      const delta = toRight === !this.isRtl() ? 1 : -1;
      void this.moveBy(index, delta, cat.id);
    }
  }

  private async moveBy(index: number, delta: number, focusId: ID): Promise<void> {
    const to = index + delta;
    if (to < 0 || to >= this.categories().length) return;
    await this.service.move(index, to);
    this.focusChip(focusId);
  }

  // ---- the menu ----

  protected onContextMenu(event: MouseEvent, cat: Category, index: number): void {
    event.preventDefault();
    // A touch long press toggles the chip instead; its contextmenu must not open a second UI.
    if (this.lastPointer === 'touch' || this.lastPointer === 'pen') return;
    this.openMenu(event.currentTarget as HTMLElement, cat, index);
  }

  protected toggleMenu(event: Event, cat: Category, index: number): void {
    event.stopPropagation();
    if (this.menu()?.cat.id === cat.id) {
      this.closeMenu(false);
      return;
    }
    const chip = (event.currentTarget as HTMLElement).parentElement?.querySelector<HTMLElement>('[data-chip]');
    this.openMenu(chip ?? (event.currentTarget as HTMLElement), cat, index);
  }

  private openMenu(anchor: HTMLElement, cat: Category, index: number): void {
    const rect = anchor.getBoundingClientRect();
    const rtl = this.isRtl();
    const wanted = rtl ? rect.right - MENU_WIDTH_PX : rect.left;
    const left = Math.max(8, Math.min(wanted, window.innerWidth - MENU_WIDTH_PX - 8));
    this.error.set(null);
    this.menu.set({ cat, index, left, top: rect.bottom + 4, rtl });
    afterNextRender(() => this.menuItems().find((b) => !b.disabled)?.focus(), { injector: this.injector });
  }

  private menuItems(): HTMLButtonElement[] {
    return Array.from(this.menuEl()?.nativeElement.querySelectorAll<HTMLButtonElement>('button') ?? []);
  }

  protected closeMenu(refocus: boolean): void {
    const m = this.menu();
    this.menu.set(null);
    if (m && refocus) this.focusChip(m.cat.id);
  }

  protected canMove(m: MenuState, direction: -1 | 1): boolean {
    // Left is earlier in LTR and later in RTL.
    const delta = m.rtl ? -direction : direction;
    const to = m.index + delta;
    return to >= 0 && to < this.categories().length;
  }

  protected onMenuKey(event: KeyboardEvent): void {
    const items = this.menuItems().filter((b) => !b.disabled);
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.closeMenu(true);
    } else if (event.key === 'Tab') {
      this.closeMenu(true);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      items[(at + step + items.length) % items.length]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      items[items.length - 1]?.focus();
    }
  }

  @HostListener('document:pointerdown', ['$event'])
  protected onDocumentPointerDown(event: PointerEvent): void {
    if (!this.menu()) return;
    const target = event.target as HTMLElement;
    if (target.closest('.menu') || target.closest('.more')) return;
    this.closeMenu(false);
  }

  protected menuRename(): void {
    const m = this.menu();
    this.menu.set(null);
    if (m) this.startRename(m.cat);
  }

  protected menuMove(direction: -1 | 1): void {
    const m = this.menu();
    if (!m) return;
    this.menu.set(null);
    void this.moveBy(m.index, m.rtl ? -direction : direction, m.cat.id);
  }

  protected menuDelete(): void {
    const m = this.menu();
    if (!m) return;
    this.menu.set(null);
    // The focused chip is about to vanish; keep the tab stop in the toolbar.
    this.focusChip(ALL_KEY);
    void this.service.remove(m.cat);
  }

  // ---- rename and add ----

  private message(failed: CategoryNameError): string {
    return failed === 'empty' ? this.c.empty : this.c.duplicate;
  }

  private startRename(cat: Category): void {
    this.error.set(null);
    this.adding.set(false);
    this.renamingId.set(cat.id);
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLInputElement>('[data-testid="rename-input"]')?.select(), {
      injector: this.injector,
    });
  }

  protected async saveRename(cat: Category, raw: string): Promise<void> {
    const failed = await this.service.rename(cat, raw);
    if (failed) {
      this.error.set(this.message(failed));
      return;
    }
    this.renamingId.set(null);
    this.error.set(null);
    this.focusChip(cat.id);
  }

  protected startAdd(): void {
    this.error.set(null);
    this.renamingId.set(null);
    this.adding.set(true);
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLInputElement>('[data-testid="add-input"]')?.focus(), {
      injector: this.injector,
    });
  }

  private saving = false;

  protected async saveAdd(raw: string): Promise<void> {
    // A second Enter while the first is still being written would repeat the same name.
    if (this.saving) return;
    this.saving = true;
    let failed: CategoryNameError | null;
    try {
      failed = await this.service.add(raw);
    } finally {
      this.saving = false;
    }
    if (failed) {
      this.error.set(this.message(failed));
      return;
    }
    this.adding.set(false);
    this.error.set(null);
    this.focusChip(ADD_KEY);
  }

  /** Esc (with an event) cancels and returns focus to the chip; a blur just closes the field. */
  protected cancelEdit(event: Event | null, returnTo: string | null): void {
    event?.stopPropagation();
    if (this.renamingId() === null && !this.adding()) return;
    this.renamingId.set(null);
    this.adding.set(false);
    this.error.set(null);
    if (returnTo) this.focusChip(returnTo);
  }

  private focusChip(key: string): void {
    // A save can finish after the page has gone.
    if (this.destroyed) return;
    afterNextRender(
      () => {
        const chip = this.chipButtons().find((el) => el.dataset['chip'] === key) ?? this.chipButtons()[0];
        chip?.focus();
        chip?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      },
      { injector: this.injector },
    );
  }

  private svg(name: Parameters<typeof icon>[0], size: number): SafeHtml {
    // Icon markup comes from the static table in icons.ts, so bypassing the sanitizer is safe.
    return this.sanitizer.bypassSecurityTrustHtml(icon(name, size));
  }
}
