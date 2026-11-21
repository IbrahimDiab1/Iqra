import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { SettingsService } from '../core/settings.service';
import type { Goal } from '../core/models';
import { GOAL_PERIODS, type GoalPeriod } from '../stats/goal-period';
import { GoalService } from '../stats/goal.service';
import { SheetComponent } from '../ui/sheet.component';
import { ONBOARDING_COPY } from './onboarding-copy';

/**
 * The first-run intro: a few short steps (what Iqra does, where books live, adding the first book, an optional goal).
 * Skippable at any point. Finishing or skipping records the flag in settings so it is shown once; Profile can open it again.
 */
@Component({
  selector: 'iqra-onboarding-sheet',
  imports: [SheetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <f-sheet [open]="open()" [title]="step().title" (closed)="finish()">
      <div class="step" data-testid="onboarding-step" [attr.data-step]="index()">
        <p class="body">{{ step().body }}</p>
        @switch (step().id) {
          @case ('book') {
            <button type="button" class="btn-primary" data-testid="onboarding-add" (click)="addBook()">{{ c.addAction }}</button>
          }
          @case ('goal') {
            <div class="seg" role="group" [attr.aria-label]="c.goalMeasure">
              <button type="button" [attr.aria-pressed]="measure() === 'pages'" (click)="measure.set('pages')">{{ c.pages }}</button>
              <button type="button" [attr.aria-pressed]="measure() === 'time'" (click)="measure.set('time')">{{ c.time }}</button>
            </div>
            <div class="seg" role="group" [attr.aria-label]="c.goalPeriod">
              @for (p of periods; track p) {
                <button type="button" [attr.data-period]="p" [attr.aria-pressed]="period() === p" (click)="period.set(p)">{{ periodLabel(p) }}</button>
              }
            </div>
            <label class="lbl" for="onb-target">{{ measure() === 'time' ? c.minutes : c.pagesCount }}</label>
            <input id="onb-target" class="field" type="text" inputmode="numeric" autocomplete="off" [value]="target()" (input)="onTarget($event)" />
            <button type="button" class="btn-primary" [disabled]="targetValue() === null" (click)="saveGoal()">{{ goalSaved() ? c.goalSaved : c.saveGoal }}</button>
          }
        }
      </div>

      <div sheet-foot class="foot-row">
        <button type="button" class="btn-ghost" data-testid="onboarding-skip" (click)="finish()">{{ c.skip }}</button>
        <span class="dots" role="img" [attr.aria-label]="c.progress(index() + 1, steps.length)">
          @for (s of steps; track s.id; let i = $index) {
            <span class="dot" [class.on]="i === index()"></span>
          }
        </span>
        <span class="spacer"></span>
        @if (index() > 0) {
          <button type="button" class="btn-ghost" data-testid="onboarding-back" (click)="back()">{{ c.back }}</button>
        }
        <button type="button" class="btn-primary" data-testid="onboarding-next" (click)="next()">{{ last() ? c.done : c.next }}</button>
      </div>
    </f-sheet>
  `,
  styles: `
    .body { margin: 4px 0 14px; font-size: 15px; line-height: 1.55; color: var(--fg); }
    .step { display: grid; gap: 10px; justify-items: start; min-height: 150px; }
    .step > * { max-width: 100%; }
    .lbl { font-size: 12px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
    .seg { display: flex; align-self: stretch; background: var(--surface-2); border-radius: 12px; padding: 3px; gap: 2px; }
    .seg button { flex: 1; min-height: 40px; border: 0; background: none; border-radius: 9px; font-size: 13px; font-weight: 500; color: var(--muted); }
    .seg button[aria-pressed="true"] { background: var(--surface); color: var(--fg); box-shadow: 0 1px 3px rgba(0, 0, 0, .12); }
    .field { box-sizing: border-box; width: 100%; min-height: 44px; border: 1px solid var(--line); border-radius: 12px; padding: 0 12px; font: 16px var(--ui); background: var(--surface-2); color: var(--fg); }
    button:focus-visible, .field:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .btn-primary, .btn-ghost { min-height: 40px; border: 0; border-radius: 12px; padding: 10px 14px; font-weight: 600; }
    .btn-primary { background: var(--accent); color: var(--accent-fg); }
    .btn-primary:disabled { opacity: .55; }
    .btn-ghost { background: none; color: var(--muted); }
    .foot-row { display: flex; align-items: center; gap: 6px; width: 100%; }
    .spacer { flex: 1; }
    .dots { display: inline-flex; gap: 6px; margin-inline-start: 6px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--line); }
    .dot.on { background: var(--accent); }
  `,
})
export class OnboardingSheet {
  readonly open = input(false);
  /** The intro was left, by Skip, Done, Esc or the close button. */
  readonly closed = output<void>();
  /** The first-book step asked to add a book. */
  readonly addBookRequested = output<void>();

  protected readonly c = ONBOARDING_COPY;
  protected readonly steps = ONBOARDING_COPY.steps;
  protected readonly periods = GOAL_PERIODS;
  protected readonly index = signal(0);
  protected readonly step = computed(() => this.steps[this.index()]);
  protected readonly last = computed(() => this.index() === this.steps.length - 1);

  protected readonly measure = signal<Goal['measure']>('pages');
  protected readonly period = signal<GoalPeriod>('day');
  protected readonly target = signal('');
  protected readonly goalSaved = signal(false);
  protected readonly targetValue = computed(() => {
    const t = this.target().trim();
    return /^\d+$/.test(t) && Number(t) > 0 ? Number(t) : null;
  });

  private readonly settings = inject(SettingsService);
  private readonly goals = inject(GoalService);

  constructor() {
    // Each opening starts from the first step.
    effect(() => {
      if (this.open()) {
        untracked(() => {
          this.index.set(0);
          this.goalSaved.set(false);
          this.target.set('');
        });
      }
    });
  }

  protected periodLabel(p: GoalPeriod): string {
    return p === 'day' ? this.c.daily : p === 'week' ? this.c.weekly : this.c.monthly;
  }

  protected onTarget(ev: Event): void {
    this.target.set((ev.target as HTMLInputElement).value);
    this.goalSaved.set(false);
  }

  protected back(): void {
    this.index.update((i) => Math.max(0, i - 1));
  }

  protected next(): void {
    if (this.last()) void this.finish();
    else this.index.update((i) => i + 1);
  }

  protected async saveGoal(): Promise<void> {
    const target = this.targetValue();
    if (target === null || this.goalSaved()) return;
    try {
      await this.goals.create({ categoryId: null, measure: this.measure(), target, period: this.period() });
      this.goalSaved.set(true);
    } catch (err) {
      console.warn('Could not save the goal', err);
    }
  }

  protected addBook(): void {
    void this.finish().then(() => this.addBookRequested.emit());
  }

  /** Records that the intro was seen, then closes. A failed write only means it may show again. */
  protected async finish(): Promise<void> {
    try {
      if (!this.settings.settings().introSeen) await this.settings.update({ introSeen: true });
    } catch (err) {
      console.warn('Could not save that the intro was seen', err);
    }
    this.closed.emit();
  }
}
