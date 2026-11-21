import { ChangeDetectionStrategy, Component, HostListener, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { ElementRef } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import type { ID } from '../core/models';
import { icon } from '../ui/icons';
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
  /** Where the selection sits in the viewport; the popup opens next to it. */
  anchor?: { left: number; top: number; right: number; bottom: number };
}

/** Popup width cap and its gap from the selection. */
export const POPUP_MAX_WIDTH = 320;
const GAP = 8;
const EDGE = 8;

/**
 * Where the popup goes: under the selection (or above it when there is no room below), centred on it and kept
 * inside the viewport. Vertical placement is a `top` or a `bottom` so the popup never needs to be measured.
 */
export function placePopup(o: { anchor?: TranslateTarget['anchor']; vw: number; vh: number }): { left: number; top?: number; bottom?: number; width: number } {
  const width = Math.min(POPUP_MAX_WIDTH, Math.max(0, o.vw - 2 * EDGE));
  const a = o.anchor;
  if (!a) return { left: Math.max(EDGE, (o.vw - width) / 2), top: Math.round(o.vh / 4), width };
  const left = Math.min(Math.max((a.left + a.right) / 2 - width / 2, EDGE), Math.max(EDGE, o.vw - width - EDGE));
  const below = o.vh - a.bottom - GAP - EDGE;
  const above = a.top - GAP - EDGE;
  if (below >= 180 || below >= above) return { left, top: a.bottom + GAP, width };
  return { left, bottom: o.vh - a.top + GAP, width };
}

type Phase = 'loading' | 'done' | 'offline' | 'too-long' | 'failed';

/**
 * Small sheet for the reader's Translate action: the selected text, its translation (English to Arabic, or Arabic
 * to English by script), for one English word a definition and phonetic, a speak button and Save to Review.
 */
@Component({
  selector: 'iqra-translate-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (target(); as t) {
      <div
        class="pop"
        role="dialog"
        [attr.aria-label]="c.title"
        [style.left.px]="pos().left"
        [style.top.px]="pos().top ?? null"
        [style.bottom.px]="pos().bottom ?? null"
        [style.width.px]="pos().width"
        (mousedown)="$event.preventDefault()"
      >
        <div class="scroll" data-testid="translate-scroll">
        <p class="dir">{{ c.from(lang()) }}</p>
        <div class="line">
          <p class="src" dir="auto" [attr.lang]="lang()" data-testid="source">{{ shown() }}</p>
        </div>
        <div class="result" aria-live="polite">
          @switch (phase()) {
            @case ('loading') {
              <p class="status">{{ c.translating }}</p>
            }
            @case ('done') {
              <div class="line">
                <p class="tr" dir="auto" [attr.lang]="other()" data-testid="translation">{{ translation() }}</p>
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
        </div>
        <div class="actions" data-testid="translate-actions">
          <button type="button" class="btn" data-testid="save-review" [disabled]="phase() !== 'done' || saved()" (click)="save()">
            {{ c.save }}
          </button>
          @if (speech) {
            <button
              type="button"
              class="btn ghost"
              data-testid="listen"
              [attr.aria-label]="phase() === 'done' ? c.speakTranslation : c.speakSource"
              (click)="phase() === 'done' ? say(translation(), other()) : say(shown(), lang())"
            >
              <span class="si" aria-hidden="true" [innerHTML]="speakerIcon"></span>{{ c.speak }}
            </button>
          }
          <button type="button" class="btn ghost" data-testid="close-translate" (click)="closed.emit()">{{ c.close }}</button>
        </div>
      </div>
    }
  `,
  styles: `
    :host { display: contents; }
    .pop {
      position: fixed; z-index: 24; box-sizing: border-box; max-width: calc(100vw - 16px); max-height: calc(100dvh - 16px); display: flex; flex-direction: column; overflow: hidden;
      padding: 10px 12px 10px; border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--surface); color: var(--fg); box-shadow: var(--shadow);
    }
    .scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
    .actions { flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--line); }
    .si { display: inline-grid; vertical-align: middle; margin-inline-end: 4px; }
    .dir { margin: 0 0 6px; color: var(--muted); font-size: 12px; }
    .line { display: flex; align-items: flex-start; gap: 6px; }
    .src, .tr { flex: 1; min-width: 0; margin: 0; overflow-wrap: anywhere; }
    .src { font: 600 16px/1.45 var(--book); }
    .tr { font: 18px/1.5 var(--book); }
    .result { margin: 8px 0; padding: 8px 10px; border-radius: var(--radius-control); background: var(--surface-2); min-height: 44px; }
    .status { margin: 0; color: var(--muted); font-size: 14px; }
    .status.err { color: var(--fg); }
    .ico { display: grid; place-items: center; flex: none; width: 36px; height: 36px; border: 0; border-radius: var(--radius-control); background: none; color: var(--accent); cursor: pointer; }
    .ico:hover { background: var(--accent-soft); }
    .def { margin: 0 0 4px; font: 14px/1.5 var(--ui); }
    .def h4 { margin: 0 0 2px; color: var(--muted); font-size: 12px; font-weight: 600; }
    .phon { margin: 0; color: var(--muted); }
    .dtext { margin: 2px 0 0; }
    .btn { min-height: 40px; padding: 0 14px; border: 0; border-radius: var(--radius-control); background: var(--accent); color: var(--accent-fg); font: 600 14px var(--ui); cursor: pointer; }
    .btn.ghost { background: none; border: 1px solid var(--line); color: var(--fg); }
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
  protected readonly pos = computed(() =>
    placePopup({ anchor: this.target()?.anchor, vw: typeof innerWidth === 'number' ? innerWidth : 1024, vh: typeof innerHeight === 'number' ? innerHeight : 768 }),
  );
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private run$ = 0;

  /** A press outside the popup closes it. Captured, because the reader stops some pointer events from bubbling. */
  @HostListener('document:pointerdown', ['$event'])
  protected onOutside(e: Event): void {
    if (!this.target()) return;
    const pop = this.host.nativeElement.querySelector('.pop');
    if (pop && !pop.contains(e.target as Node)) this.closed.emit();
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.target()) this.closed.emit();
  }

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
      this.toast.show(existed ? REVIEW_COPY.sheet.savedAgain : REVIEW_COPY.sheet.saved);
      this.closed.emit();
    } catch {
      this.toast.show(REVIEW_COPY.sheet.saveFailed);
    }
  }
}
