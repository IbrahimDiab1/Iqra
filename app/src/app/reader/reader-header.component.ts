import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, input, model, output, viewChild } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { COPY } from '../ui/copy';
import { icon, type IconName } from '../ui/icons';
import { CHROME_COPY } from './chrome-copy';

/** The slim always-visible bar: back, title with `chapter › section`, jump history and the page indicator. */
@Component({
  selector: 'iqra-reader-header',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="ib" routerLink="/library" [attr.aria-label]="copy.back" [innerHTML]="ic('back')"></a>
    <div class="titles">
      <div class="t1" dir="auto">{{ title() }}</div>
      @if (chapter(); as c) {
        <div class="t2" dir="auto">
          <span class="chapter">{{ c }}</span>
          @if (section(); as s) {
            <span class="sep" aria-hidden="true"> {{ chrome.chapterSep }} </span><span class="section">{{ s }}</span>
          }
        </div>
      }
    </div>
    @if (canBack() || canForward()) {
      <button type="button" class="ib" [attr.aria-label]="copy.jumpBack" data-shortcut="Alt+←" [disabled]="!canBack()" (click)="historyBack.emit()" [innerHTML]="ic('history')"></button>
      <button type="button" class="ib" [attr.aria-label]="copy.jumpForward" data-shortcut="Alt+→" [disabled]="!canForward()" (click)="historyForward.emit()" [innerHTML]="ic('historyFwd')"></button>
    }
    @if (gotoOpen()) {
      <form class="goto" (submit)="submit($event)">
        <input
          #field
          type="number"
          inputmode="numeric"
          min="1"
          [max]="numPages()"
          [value]="page()"
          [attr.aria-label]="chrome.goToPage"
          (keydown.escape)="closeGoto($event)"
          (blur)="gotoOpen.set(false)"
        />
        <span class="of" dir="ltr">/ {{ numPages() }}</span>
      </form>
    } @else {
      <button type="button" class="pg" dir="ltr" [attr.aria-label]="chrome.goToPage" data-shortcut="G" (click)="gotoOpen.set(true)">
        {{ chrome.pageIndicator(page(), numPages()) }}
      </button>
    }
  `,
  styles: `
    :host {
      display: flex; align-items: center; gap: 2px; box-sizing: border-box;
      height: var(--reader-header-h, 52px); padding: env(safe-area-inset-top, 0px) 8px 0 2px;
      border-bottom: 1px solid color-mix(in srgb, var(--ink) 10%, transparent);
      background: color-mix(in srgb, var(--paper) 96%, transparent);
    }
    .titles { flex: 1; min-width: 0; padding: 0 6px; }
    .t1 { font-size: 14px; font-weight: 600; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .t2 { font-size: 12px; line-height: 1.25; color: color-mix(in srgb, var(--ink) 62%, transparent); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sep { opacity: 0.7; }
    .ib { display: inline-grid; place-items: center; width: 40px; height: 40px; flex: none; padding: 0; border: 0; border-radius: var(--radius-control); background: none; color: inherit; cursor: pointer; }
    .ib:hover:not(:disabled) { background: color-mix(in srgb, var(--ink) 8%, transparent); }
    .ib:disabled { opacity: 0.35; cursor: default; }
    .ib:focus-visible, .pg:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .pg { flex: none; min-height: 40px; padding: 0 10px; border: 0; border-radius: var(--radius-control); background: none; color: inherit; font: 13px var(--ui); font-variant-numeric: tabular-nums; white-space: nowrap; cursor: pointer; }
    .pg:hover { background: color-mix(in srgb, var(--ink) 8%, transparent); }
    .goto { display: flex; align-items: center; gap: 6px; flex: none; padding: 0 6px; font-size: 13px; }
    .goto input { box-sizing: border-box; width: 72px; min-height: 36px; padding: 0 8px; border: 1px solid color-mix(in srgb, var(--ink) 28%, transparent); border-radius: 10px; background: var(--paper); color: inherit; font: 16px var(--ui); font-variant-numeric: tabular-nums; }
    .of { color: color-mix(in srgb, var(--ink) 62%, transparent); font-variant-numeric: tabular-nums; }
  `,
})
export class ReaderHeaderComponent {
  readonly title = input.required<string>();
  /** The top-level chapter at the current page. */
  readonly chapter = input<string | null>(null);
  /** The deepest section under that chapter, when there is one. */
  readonly section = input<string | null>(null);
  readonly page = input.required<number>();
  readonly numPages = input.required<number>();
  readonly canBack = input(false);
  readonly canForward = input(false);
  /** Whether the Go to page field is showing; the page opens it for the `G` key. */
  readonly gotoOpen = model(false);
  readonly historyBack = output<void>();
  readonly historyForward = output<void>();
  readonly goTo = output<number>();

  protected readonly copy = COPY.reader;
  protected readonly chrome = CHROME_COPY;
  private readonly sanitizer = inject(DomSanitizer);
  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');

  constructor() {
    effect(() => {
      const el = this.field()?.nativeElement;
      if (el) {
        el.focus();
        el.select();
      }
    });
  }

  protected ic(name: IconName) {
    return this.sanitizer.bypassSecurityTrustHtml(icon(name, 22));
  }

  protected submit(e: Event): void {
    e.preventDefault();
    const el = this.field()?.nativeElement;
    const n = Math.round(Number(el?.value));
    this.gotoOpen.set(false);
    if (Number.isFinite(n) && n >= 1) this.goTo.emit(Math.min(n, this.numPages()));
  }

  protected closeGoto(e: Event): void {
    e.stopPropagation();
    this.gotoOpen.set(false);
  }
}
