import { ChangeDetectionStrategy, Component, HostListener, computed, inject, input, output, signal } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import type { ReviewItem } from '../core/models';
import { icon } from '../ui/icons';
import { frontBack, type CardDirection, type Grade } from './review-logic';
import { REVIEW_COPY } from './review-copy';
import { ReviewService } from './review.service';
import { canSpeak, speak } from './translation';

const GRADES: readonly Grade[] = ['again', 'hard', 'good', 'easy'];

interface QueueCard {
  item: ReviewItem;
  dir: 'en-ar' | 'ar-en';
}

/**
 * A flashcard session. The queue is fixed when it starts; a card graded Again returns to the end of it.
 * Space or Enter flips the card; 1 to 4 grade it (Again, Hard, Good, Easy).
 */
@Component({
  selector: 'iqra-practice',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="practice" aria-label="Practice">
      <header class="top">
        <button type="button" class="link" data-testid="exit-practice" (click)="exit.emit()">{{ c.exit }}</button>
        <span class="count" data-testid="progress">{{ c.progress(done(), total()) }}</span>
      </header>
      <div class="bar" role="progressbar" [attr.aria-valuemin]="0" [attr.aria-valuemax]="total()" [attr.aria-valuenow]="done()">
        <span [style.width.%]="total() ? (done() / total()) * 100 : 0"></span>
      </div>
      @if (card(); as k) {
        <div class="card" data-testid="card" [attr.data-flipped]="flipped()">
          <div class="side">
            <p class="front" dir="auto" [attr.lang]="face().frontLang" data-testid="front">{{ face().front }}</p>
            @if (speech) {
              <button type="button" class="ico" [attr.aria-label]="c.speak(face().frontLang)" (click)="say(face().front, face().frontLang)" [innerHTML]="speakerIcon"></button>
            }
          </div>
          @if (flipped()) {
            <hr />
            <div class="side">
              <p class="back" dir="auto" [attr.lang]="face().backLang" data-testid="back" aria-live="polite">{{ face().back }}</p>
              @if (speech) {
                <button type="button" class="ico" [attr.aria-label]="c.speak(face().backLang)" (click)="say(face().back, face().backLang)" [innerHTML]="speakerIcon"></button>
              }
            </div>
            @if (k.item.context) {
              <p class="ctx" dir="auto">{{ k.item.context }}</p>
            }
          }
        </div>
        @if (!flipped()) {
          <button type="button" class="flip" data-testid="flip" (click)="flip()">{{ c.flip }}</button>
          <p class="hint">{{ c.flipHint }}</p>
        } @else {
          <div class="grades" role="group" aria-label="Grade">
            @for (g of grades; track g; let i = $index) {
              <button type="button" class="grade" [attr.data-grade]="g" (click)="grade(g)"><span>{{ c.grades[g] }}</span><kbd>{{ i + 1 }}</kbd></button>
            }
          </div>
        }
      } @else {
        <div class="finish" data-testid="finished">
          <h2>{{ c.doneTitle }}</h2>
          <p>{{ c.doneBody(total()) }}</p>
          <button type="button" class="flip" (click)="exit.emit()">{{ c.back }}</button>
        </div>
      }
    </section>
  `,
  styles: `
    :host { display: block; }
    .practice { display: grid; gap: 12px; }
    .top { display: flex; align-items: center; justify-content: space-between; }
    .link { min-height: 40px; padding: 0 4px; border: 0; background: none; color: var(--accent); font: 600 14px var(--ui); cursor: pointer; }
    .count { color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; }
    .bar { height: 4px; border-radius: 4px; background: var(--surface-2); overflow: hidden; }
    .bar span { display: block; height: 100%; background: var(--accent); }
    .card { display: grid; gap: 10px; min-height: 200px; align-content: center; padding: 20px 16px; border: 1px solid var(--line); border-radius: var(--radius-card); background: var(--surface); }
    .side { display: flex; align-items: flex-start; gap: 6px; }
    .front, .back { flex: 1; min-width: 0; margin: 0; text-align: center; overflow-wrap: anywhere; font: 26px/1.5 var(--book); }
    .back { color: var(--accent); }
    hr { width: 100%; margin: 0; border: 0; border-top: 1px solid var(--line); }
    .ctx { margin: 0; color: var(--muted); font: 14px/1.5 var(--ui); text-align: center; overflow-wrap: anywhere; }
    .ico { display: grid; place-items: center; flex: none; width: 40px; height: 40px; border: 0; border-radius: var(--radius-control); background: none; color: var(--accent); cursor: pointer; }
    .ico:hover { background: var(--accent-soft); }
    .flip { min-height: 48px; border: 0; border-radius: var(--radius-control); background: var(--accent); color: var(--accent-fg); font: 600 15px var(--ui); cursor: pointer; padding: 0 16px; }
    .hint { margin: -4px 0 0; text-align: center; color: var(--muted); font-size: 12px; }
    .grades { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
    .grade { display: grid; justify-items: center; gap: 2px; min-height: 52px; padding: 6px 2px; border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--surface); color: var(--fg); font: 600 13px var(--ui); cursor: pointer; }
    .grade kbd { color: var(--muted); font: 11px var(--ui); }
    .grade:hover { background: var(--surface-2); }
    .finish { display: grid; gap: 10px; justify-items: center; text-align: center; padding: 24px 0; }
    .finish h2 { margin: 0; font: 600 22px var(--book); }
    .finish p { margin: 0; color: var(--muted); }
    button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  `,
})
export class PracticeComponent {
  readonly cards = input.required<ReviewItem[]>();
  readonly direction = input<CardDirection>('en-ar');
  readonly exit = output<void>();

  protected readonly c = REVIEW_COPY.practice;
  protected readonly grades = GRADES;
  protected readonly speech = canSpeak();
  protected readonly speakerIcon = inject(DomSanitizer).bypassSecurityTrustHtml(icon('speaker', 20));
  private readonly reviews = inject(ReviewService);

  private fixed: QueueCard[] | undefined;
  private readonly queue = computed(() => this.fixed ?? (this.cards().length > 0 ? (this.fixed = this.start()) : []));
  protected readonly flipped = signal(false);
  private readonly doneCount = signal(0);
  private readonly pos = signal(0);
  /** Cards returned by Again, appended to the queue. */
  private readonly extra = signal<QueueCard[]>([]);

  protected readonly total = computed(() => this.queue().length);
  protected readonly done = this.doneCount.asReadonly();
  protected readonly card = computed(() => [...this.queue(), ...this.extra()][this.pos()] ?? null);
  protected readonly face = computed(() => {
    const k = this.card();
    return k ? frontBack(k.item, k.dir) : { front: '', back: '', frontLang: 'en' as const, backLang: 'ar' as const };
  });

  /** Fixes the queue and, for mixed, each card's direction, once when the session opens. */
  private start(): QueueCard[] {
    const mode = this.direction();
    return this.cards().map((item): QueueCard => ({ item, dir: mode === 'mixed' ? (Math.random() < 0.5 ? 'en-ar' : 'ar-en') : mode }));
  }

  protected flip(): void {
    if (this.card()) this.flipped.set(true);
  }

  protected async grade(g: Grade): Promise<void> {
    const k = this.card();
    if (!k || !this.flipped()) return;
    this.flipped.set(false);
    if (g === 'again') this.extra.update((e) => [...e, k]);
    else this.doneCount.update((n) => n + 1);
    this.pos.update((p) => p + 1);
    await this.reviews.gradeItem(k.item.id, g);
  }

  protected say(text: string, lang: 'en' | 'ar'): void {
    speak(text, lang);
  }

  @HostListener('document:keydown', ['$event'])
  protected onKey(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const el = e.target as HTMLElement | null;
    if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
    if (!this.card()) return;
    if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      if (!this.flipped()) this.flip();
      return;
    }
    const n = Number(e.key);
    if (n >= 1 && n <= 4 && this.flipped()) {
      e.preventDefault();
      void this.grade(GRADES[n - 1]);
    }
  }
}
