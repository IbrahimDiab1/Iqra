import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import type { Category, Goal, ID } from '../core/models';
import { SheetComponent } from '../ui/sheet.component';
import { ToastService } from '../ui/toast.service';
import { formatMinutes } from './format';
import { GOAL_PERIODS, goalPeriod, type GoalPeriod } from './goal-period';
import { GoalService } from './goal.service';
import { STATS_COPY } from './stats-copy';

/** Creates or edits a goal for a day, a week or a month. `goal` null with `open` set means a new goal. */
@Component({
  selector: 'iqra-goal-editor-sheet',
  imports: [SheetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <f-sheet [open]="open()" [title]="goal() ? c.editTitle : c.newTitle" (closed)="closed.emit()">
      <span class="lbl" id="ge-books">{{ c.books }}</span>
      <div class="chips" role="group" aria-labelledby="ge-books">
        <button type="button" class="chip" [attr.aria-pressed]="categoryId() === null" (click)="categoryId.set(null)">{{ allBooks }}</button>
        @for (cat of categories(); track cat.id) {
          <button type="button" class="chip" dir="auto" [attr.aria-pressed]="categoryId() === cat.id" (click)="categoryId.set(cat.id)">{{ cat.name }}</button>
        }
      </div>

      <span class="lbl" id="ge-measure">{{ c.measure }}</span>
      <div class="seg" role="group" aria-labelledby="ge-measure">
        <button type="button" [attr.aria-pressed]="measure() === 'time'" (click)="measure.set('time')">{{ c.time }}</button>
        <button type="button" [attr.aria-pressed]="measure() === 'pages'" (click)="measure.set('pages')">{{ c.pages }}</button>
      </div>

      <span class="lbl" id="ge-period">{{ c.period }}</span>
      <div class="seg" role="group" aria-labelledby="ge-period">
        @for (p of periods; track p) {
          <button type="button" [attr.data-period]="p" [attr.aria-pressed]="period() === p" (click)="period.set(p)">{{ periodLabel(p) }}</button>
        }
      </div>

      <label class="lbl" for="goal-target">{{ measure() === 'time' ? c.targetTime(per()) : c.targetPages(per()) }}</label>
      <input id="goal-target" class="field" type="text" inputmode="numeric" autocomplete="off" [value]="targetText()" (input)="onTarget($event)" [attr.aria-invalid]="valid() || targetText() === '' ? null : 'true'" />
      @if (targetText() !== '' && !valid()) {
        <p class="hint err">{{ c.invalid }}</p>
      } @else if (valid() && measure() === 'time') {
        <p class="hint">{{ c.hint(hours(), per()) }}</p>
      }

      <div sheet-foot class="foot-row">
        @if (goal()) {
          <button type="button" class="btn-ghost danger" (click)="remove()">{{ c.delete }}</button>
        }
        <span class="spacer"></span>
        <button type="button" class="btn-primary" [disabled]="!valid()" (click)="save()">{{ c.save }}</button>
      </div>
    </f-sheet>
  `,
  styles: `
    .lbl { display: block; margin: 14px 0 6px; font-size: 12px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip { min-height: 40px; padding: 6px 12px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); color: var(--fg); font-size: 13px; }
    .chip[aria-pressed="true"] { background: var(--fg); color: var(--surface); border-color: var(--fg); }
    .seg { display: flex; background: var(--surface-2); border-radius: 12px; padding: 3px; gap: 2px; }
    .seg button { flex: 1; min-height: 40px; border: 0; background: none; border-radius: 9px; font-size: 13px; font-weight: 500; color: var(--muted); }
    .seg button[aria-pressed="true"] { background: var(--surface); color: var(--fg); box-shadow: 0 1px 3px rgba(0, 0, 0, .12); }
    .field { box-sizing: border-box; width: 100%; min-height: 44px; border: 1px solid var(--line); border-radius: 12px; padding: 0 12px; font: 16px var(--ui); background: var(--surface-2); color: var(--fg); }
    .hint { margin: 6px 2px 0; font-size: 13px; color: var(--muted); }
    .hint.err { color: var(--danger); }
    button:focus-visible, .field:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .btn-primary, .btn-ghost { min-height: 40px; border: 0; border-radius: 12px; padding: 10px 14px; font-weight: 600; }
    .btn-primary { background: var(--accent); color: var(--accent-fg); }
    .btn-primary:disabled { opacity: .55; }
    .btn-ghost { background: none; color: var(--muted); }
    .btn-ghost.danger { color: var(--danger); }
    .foot-row { display: flex; align-items: center; gap: 6px; width: 100%; }
    .spacer { flex: 1; }
  `,
})
export class GoalEditorSheet {
  readonly open = input(false);
  readonly goal = input<Goal | null>(null);
  readonly categories = input<Category[]>([]);
  readonly closed = output<void>();

  protected readonly c = STATS_COPY.goals;
  protected readonly allBooks = STATS_COPY.allBooks;
  protected readonly categoryId = signal<ID | null>(null);
  protected readonly measure = signal<Goal['measure']>('time');
  protected readonly period = signal<GoalPeriod>('week');
  protected readonly periods = GOAL_PERIODS;
  protected readonly targetText = signal('');
  protected readonly per = computed(() => ({ day: this.c.perDay, week: this.c.perWeek, month: this.c.perMonth })[this.period()]);

  private readonly goals = inject(GoalService);
  private readonly toast = inject(ToastService);

  /** The typed target as a whole number above 0, or null. */
  private readonly target = computed(() => {
    const t = this.targetText().trim();
    return /^\d+$/.test(t) && Number(t) > 0 ? Number(t) : null;
  });
  protected readonly valid = computed(() => this.target() !== null);
  protected readonly hours = computed(() => formatMinutes(this.target() ?? 0));

  constructor() {
    // Loads the draft each time the sheet opens or the goal being edited changes.
    effect(() => {
      const open = this.open();
      const g = this.goal();
      if (!open) return;
      untracked(() => {
        this.categoryId.set(g?.categoryId ?? null);
        this.measure.set(g?.measure ?? 'time');
        this.period.set(g ? goalPeriod(g) : 'week');
        this.targetText.set(g ? String(g.target) : '');
      });
    });
  }

  protected periodLabel(p: GoalPeriod): string {
    return p === 'day' ? this.c.periodDay : p === 'week' ? this.c.periodWeek : this.c.periodMonth;
  }

  protected onTarget(ev: Event): void {
    this.targetText.set((ev.target as HTMLInputElement).value);
  }

  protected async save(): Promise<void> {
    const target = this.target();
    if (target === null) return;
    const g = this.goal();
    const fields = { categoryId: this.categoryId(), measure: this.measure(), target, period: this.period() };
    try {
      if (g) await this.goals.update(g.id, fields);
      else await this.goals.create(fields);
    } catch (err) {
      console.warn('Could not save the goal', err);
      this.toast.show(this.c.saveFailed);
      return;
    }
    this.closed.emit();
  }

  protected async remove(): Promise<void> {
    const g = this.goal();
    if (!g) return;
    let removed: Goal | undefined;
    try {
      removed = await this.goals.remove(g.id);
    } catch (err) {
      console.warn('Could not delete the goal', err);
      this.toast.show(this.c.saveFailed);
      return;
    }
    this.closed.emit();
    if (removed) this.toast.show(this.c.deleted, { undo: () => void this.goals.restore(removed) });
  }
}
