import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import type { ID } from '../core/models';
import { icon } from '../ui/icons';
import { SheetComponent } from '../ui/sheet.component';
import { ToastService } from '../ui/toast.service';
import { detectLang, kindFor, normalizeSelection } from './review-logic';
import { REVIEW_COPY } from './review-copy';
import { ReviewService } from './review.service';
import { TranslationError, TranslationService, canSpeak, otherLang, speak, type Definition } from './translation';

/** What the reader hands over: the selected text, its page and the sentence it sits in. */
export interface TranslateTarget {
  text: string;
  page: number;
  context: string;
}

type Phase = 'loading' | 'done' | 'offline' | 'too-long' | 'failed';

/**
 * Small sheet for the reader's Translate action: the selected text, its translation (English to Arabic, or Arabic
 * to English by script), for one English word a definition and phonetic, a speak button and Save to Review.
 */
@Component({
  selector: 'iqra-translate-sheet',
  imports: [SheetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <f-sheet [open]="!!target()" [title]="c.title" (closed)="closed.emit()">
      @if (target(); as t) {
        <p class="dir">{{ c.from(lang()) }}</p>
        <div class="line">
          <p class="src" dir="auto" [attr.lang]="lang()" data-testid="source">{{ shown() }}</p>
          @if (speech) {
            <button type="button" class="ico" [attr.aria-label]="c.speakSource" (click)="say(shown(), lang())" [innerHTML]="speakerIcon"></button>
          }
        </div>
        <div class="result" aria-live="polite">
          @switch (phase()) {
            @case ('loading') {
              <p class="status">{{ c.translating }}</p>
            }
            @case ('done') {
              <div class="line">
                <p class="tr" dir="auto" [attr.lang]="other()" data-testid="translation">{{ translation() }}</p>
                @if (speech) {
                  <button type="button" class="ico" [attr.aria-label]="c.speakTranslation" (click)="say(translation(), other())" [innerHTML]="speakerIcon"></button>
                }
              </div>
            }
            @default {
              <p class="status err" role="alert" data-testid="translate-error">{{ errorText() }}</p>
              @if (phase() !== 'too-long') {
                <button type="button" class="btn ghost" (click)="run()">{{ c.retry }}</button>
              }
            }
          }
        </div>
        @if (def(); as d) {
          <div class="def" data-testid="definition">
            <h4>{{ c.definition }}</h4>
            @if (d.phonetic) {
              <p class="phon" dir="ltr">{{ d.phonetic }}</p>
            }
            <p class="dtext" dir="ltr">
              @if (d.partOfSpeech) {
                <em>{{ d.partOfSpeech }}</em>
              }
              {{ d.definition }}
            </p>
          </div>
        }
        <button type="button" class="btn" data-testid="save-review" [disabled]="phase() !== 'done' || saved()" (click)="save()">
          {{ saved() ? (existed() ? c.savedAgain : c.saved) : c.save }}
        </button>
      }
    </f-sheet>
  `,
  styles: `
    :host { display: contents; }
    .dir { margin: 0 0 6px; color: var(--muted); font-size: 12px; }
    .line { display: flex; align-items: flex-start; gap: 6px; }
    .src, .tr { flex: 1; min-width: 0; margin: 0; overflow-wrap: anywhere; }
    .src { font: 600 18px/1.45 var(--book); max-height: 30vh; overflow-y: auto; }
    .tr { font: 20px/1.5 var(--book); }
    .result { margin: 10px 0; padding: 10px 12px; border-radius: var(--radius-control); background: var(--surface-2); min-height: 44px; }
    .status { margin: 0; color: var(--muted); font-size: 14px; }
    .status.err { color: var(--fg); }
    .ico { display: grid; place-items: center; flex: none; width: 40px; height: 40px; border: 0; border-radius: var(--radius-control); background: none; color: var(--accent); cursor: pointer; }
    .ico:hover { background: var(--accent-soft); }
    .def { margin: 0 0 12px; font: 14px/1.5 var(--ui); }
    .def h4 { margin: 0 0 2px; color: var(--muted); font-size: 12px; font-weight: 600; }
    .phon { margin: 0; color: var(--muted); }
    .dtext { margin: 2px 0 0; }
    .btn { min-height: 44px; padding: 0 16px; border: 0; border-radius: var(--radius-control); background: var(--accent); color: var(--accent-fg); font: 600 14px var(--ui); cursor: pointer; }
    .btn.ghost { margin-top: 8px; background: none; border: 1px solid var(--line); color: var(--fg); }
    .btn:disabled { opacity: 0.55; cursor: default; }
    .btn:focus-visible, .ico:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  `,
})
export class TranslateSheet {
  readonly target = input<TranslateTarget | null>(null);
  readonly bookId = input.required<ID>();
  readonly closed = output<void>();

  protected readonly c = REVIEW_COPY.sheet;
  protected readonly speech = canSpeak();
  protected readonly speakerIcon = inject(DomSanitizer).bypassSecurityTrustHtml(icon('speaker', 20));

  private readonly translator = inject(TranslationService);
  private readonly reviews = inject(ReviewService);
  private readonly toast = inject(ToastService);

  protected readonly phase = signal<Phase>('loading');
  protected readonly translation = signal('');
  protected readonly def = signal<Definition | null>(null);
  protected readonly saved = signal(false);
  protected readonly existed = signal(false);
  protected readonly errorText = computed(() => {
    const p = this.phase();
    return p === 'offline' ? this.c.offline : p === 'too-long' ? this.c.tooLong : this.c.failed;
  });

  protected readonly shown = computed(() => normalizeSelection(this.target()?.text ?? ''));
  protected readonly lang = computed(() => detectLang(this.shown()));
  protected readonly other = computed(() => otherLang(this.lang()));
  private run$ = 0;

  constructor() {
    // Keyed by the text and page, so the reader filling in the context sentence later does not restart the lookup.
    const key = computed(() => {
      const t = this.target();
      return t ? `${t.page}:${t.text}` : null;
    });
    effect(() => {
      const open = key() !== null;
      untracked(() => {
        this.saved.set(false);
        this.existed.set(false);
        this.def.set(null);
        this.translation.set('');
        if (open) void this.run();
        else this.run$++;
      });
    });
  }

  /** Looks the text up. A newer lookup (or a closed sheet) makes an older answer stale. */
  protected async run(): Promise<void> {
    const text = this.shown();
    if (text === '') return;
    const token = ++this.run$;
    const from = this.lang();
    this.phase.set('loading');
    const isWord = from === 'en' && kindFor(text) === 'word' && /^[\p{L}'’-]+$/u.test(text);
    if (isWord) void this.translator.define(text).then((d) => token === this.run$ && this.def.set(d));
    try {
      const out = await this.translator.translate(text, from);
      if (token !== this.run$) return;
      this.translation.set(out);
      this.phase.set('done');
    } catch (e) {
      if (token !== this.run$) return;
      this.phase.set(e instanceof TranslationError && (e.kind === 'offline' || e.kind === 'too-long') ? e.kind : 'failed');
    }
  }

  protected say(text: string, lang: 'en' | 'ar'): void {
    speak(text, lang);
  }

  protected async save(): Promise<void> {
    const t = this.target();
    if (!t || this.phase() !== 'done' || this.saved()) return;
    try {
      const { existed } = await this.reviews.add({
        text: this.shown(),
        translation: this.translation(),
        sourceLang: this.lang(),
        bookId: this.bookId(),
        page: t.page,
        context: t.context,
      });
      this.existed.set(existed);
      this.saved.set(true);
    } catch {
      this.toast.show(REVIEW_COPY.sheet.saveFailed);
    }
  }
}
