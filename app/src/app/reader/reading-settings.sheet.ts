import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { DB } from '../core/db';
import type { Book } from '../core/models';
import { Repo } from '../core/repo';
import { SettingsService } from '../core/settings.service';
import { COPY } from '../ui/copy';
import { CHROME_COPY } from './chrome-copy';
import { SheetComponent } from '../ui/sheet.component';
import type { ReaderState } from './reader.state';
import { zoomIn, zoomOut } from './zoom';

type Theme = 'paper' | 'sepia' | 'night';
interface Choice<T> {
  value: T;
  label: string;
}

@Component({
  selector: 'iqra-reading-settings-sheet',
  imports: [SheetComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <f-sheet [open]="open()" [title]="copy.settings" (closed)="closed.emit()">
      <section class="group">
        <h4 id="rs-view">{{ copy.view }}</h4>
        <div class="seg" role="radiogroup" aria-labelledby="rs-view">
          @for (c of views; track c.value) {
            <button type="button" role="radio" [attr.aria-checked]="state().view() === c.value" [class.on]="state().view() === c.value" (click)="state().setView(c.value)">{{ c.label }}</button>
          }
        </div>
      </section>

      <section class="group">
        <h4 id="rs-mode">{{ copy.pageMode }}</h4>
        <div class="seg" role="radiogroup" aria-labelledby="rs-mode">
          @for (c of modes; track c.value) {
            <button type="button" role="radio" [attr.aria-checked]="book().pageMode === c.value" [class.on]="book().pageMode === c.value" (click)="setPageMode(c.value)">{{ c.label }}</button>
          }
        </div>
      </section>

      <section class="group">
        <h4 id="rs-dir">{{ chrome.textDirection }}</h4>
        <div class="seg" role="radiogroup" aria-labelledby="rs-dir">
          @for (c of directions; track c.value) {
            <button type="button" role="radio" [attr.aria-checked]="textDirection() === c.value" [class.on]="textDirection() === c.value" (click)="setDirection(c.value)">{{ c.label }}</button>
          }
        </div>
        <p class="hint">{{ chrome.textDirectionHint }}</p>
      </section>

      <section class="group">
        <h4 id="rs-theme">{{ copy.pageColor }}</h4>
        <div class="seg" role="radiogroup" aria-labelledby="rs-theme">
          @for (c of themes; track c.value) {
            <button type="button" role="radio" [attr.aria-checked]="theme() === c.value" [class.on]="theme() === c.value" (click)="setTheme(c.value)">{{ c.label }}</button>
          }
        </div>
      </section>

      <section class="group">
        <h4 id="rs-progress">{{ details.progressMode }}</h4>
        <div class="seg" role="radiogroup" aria-labelledby="rs-progress">
          @for (c of progressModes; track c.value) {
            <button type="button" role="radio" [attr.aria-checked]="book().progressMode === c.value" [class.on]="book().progressMode === c.value" (click)="pickProgress(c.value)">{{ c.label }}</button>
          }
        </div>
      </section>

      <section class="group">
        <h4 id="rs-zoom">{{ state().view() === 'page' ? copy.zoom : copy.textSize }}</h4>
        <div class="stepper" role="group" aria-labelledby="rs-zoom">
          <button type="button" data-step="out" [disabled]="!canOut()" (click)="state().setZoom(out())">A−</button>
          <span class="pct">{{ percent() }}%</span>
          <button type="button" data-step="in" [disabled]="!canIn()" (click)="state().setZoom(next())">A+</button>
        </div>
      </section>
    </f-sheet>
  `,
  styles: `
    .group { margin: 0 0 18px; }
    .hint { margin: 6px 0 0; font-size: 12px; color: var(--muted); }
    h4 { margin: 0 0 8px; font-size: 13px; font-weight: 600; color: var(--muted); }
    .seg { display: flex; gap: 4px; padding: 3px; border-radius: var(--radius-control); background: var(--surface-2); }
    .seg button { flex: 1; min-height: 40px; border: 0; border-radius: 10px; background: none; color: var(--muted); font: 600 14px var(--ui); cursor: pointer; }
    .seg button.on { background: var(--surface); color: var(--fg); box-shadow: 0 1px 2px rgb(0 0 0 / 0.12); }
    .stepper { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .stepper button { min-width: 56px; min-height: 40px; border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--surface); color: var(--fg); font: 600 16px var(--ui); cursor: pointer; }
    .stepper button:disabled { opacity: 0.4; cursor: default; }
    .pct { flex: 1; text-align: center; font-size: 15px; font-variant-numeric: tabular-nums; }
    button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  `,
})
export class ReadingSettingsSheetComponent {
  readonly open = input(false);
  readonly book = input.required<Book>();
  readonly state = input.required<ReaderState>();
  readonly closed = output<void>();
  /** Emits the saved book after the page mode changes. */
  readonly bookChange = output<Book>();
  /** The reader switches how this book's progress is counted (and says so). */
  readonly progressModeChange = output<Book['progressMode']>();

  protected readonly copy = COPY.reader;
  protected readonly chrome = CHROME_COPY;
  protected readonly details = COPY.details;
  protected readonly progressModes: Choice<Book['progressMode']>[] = [
    { value: 'last-page', label: COPY.details.lastPage },
    { value: 'marked', label: COPY.details.marked },
  ];
  protected readonly views: Choice<'page' | 'reflow'>[] = [
    { value: 'page', label: COPY.reader.pageView },
    { value: 'reflow', label: COPY.reader.readingMode },
  ];
  protected readonly modes: Choice<'swipe' | 'scroll'>[] = [
    { value: 'swipe', label: COPY.reader.swipe },
    { value: 'scroll', label: COPY.reader.scroll },
  ];
  protected readonly directions: Choice<NonNullable<Book['textDirection']>>[] = [
    { value: 'auto', label: CHROME_COPY.dirAuto },
    { value: 'rtl', label: CHROME_COPY.dirRtl },
    { value: 'ltr', label: CHROME_COPY.dirLtr },
  ];
  protected readonly themes: Choice<Theme>[] = [
    { value: 'paper', label: COPY.reader.paper },
    { value: 'sepia', label: COPY.reader.sepia },
    { value: 'night', label: COPY.reader.night },
  ];

  private readonly db = inject(DB);
  private readonly repo = inject(Repo);
  private readonly settings = inject(SettingsService);

  protected readonly theme = computed(() => this.settings.settings().readerTheme);
  protected readonly textDirection = computed(() => this.book().textDirection ?? 'auto');
  protected readonly percent = computed(() => Math.round(this.state().zoom() * 100));
  protected readonly next = computed(() => zoomIn(this.state().zoom(), this.state().view()));
  protected readonly out = computed(() => zoomOut(this.state().zoom(), this.state().view()));
  protected readonly canIn = computed(() => this.next() !== this.state().zoom());
  protected readonly canOut = computed(() => this.out() !== this.state().zoom());

  protected pickProgress(mode: Book['progressMode']): void {
    if (mode !== this.book().progressMode) this.progressModeChange.emit(mode);
  }

  protected setTheme(readerTheme: Theme): void {
    this.settings.update({ readerTheme }).catch((err) => console.warn('Could not save the page color', err));
  }

  protected setDirection(textDirection: NonNullable<Book['textDirection']>): Promise<void> {
    return this.saveBook({ textDirection }, 'text direction');
  }

  protected setPageMode(pageMode: Book['pageMode']): Promise<void> {
    return this.saveBook({ pageMode }, 'page mode');
  }

  private async saveBook(patch: Partial<Book>, what: string): Promise<void> {
    try {
      // Read the stored book: the position flush may have raised lastPageReached since this copy was made.
      const stored = (await this.db.books.get(this.book().id)) ?? this.book();
      const saved = await this.repo.put<Book>('books', { ...stored, ...patch });
      this.bookChange.emit(saved);
    } catch (err) {
      console.warn(`Could not save the ${what}`, err);
    }
  }
}
