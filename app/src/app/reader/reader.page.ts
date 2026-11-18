import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  InjectionToken,
  OnDestroy,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DB } from '../core/db';
import type { Book } from '../core/models';
import { SettingsService } from '../core/settings.service';
import { DRIVE_ADAPTER } from '../sync/drive-adapter';
import { COPY } from '../ui/copy';
import { icon, type IconName } from '../ui/icons';
import { ToastService } from '../ui/toast.service';
import type { Place } from './jump-history';
import { isReaderKeyIgnored } from './keys';
import { chapterTitleAt } from './outline';
import { BookPanelSheetComponent } from './book-panel.sheet';
import { PagerComponent } from './pager.component';
import { PdfSession, ReaderOpenError, type PageRenderer, type PdfSource } from './pdf-session';
import { PositionService } from './position.service';
import { ReaderState } from './reader.state';
import { ReadingSettingsSheetComponent } from './reading-settings.sheet';
import { ReflowViewComponent } from './reflow-view.component';
import { ScrollerComponent } from './scroller.component';
import { ZoomGesturesDirective } from './zoom-gestures.directive';
import { zoomIn, zoomOut } from './zoom';

export type ReaderSession = PageRenderer & { destroy(): void };

/** Opens a PDF; tests provide a fake. */
export const PDF_OPENER = new InjectionToken<(src: PdfSource) => Promise<ReaderSession>>('pdfOpener', {
  factory: () => (src) => PdfSession.open(src),
});

type Status = 'loading' | 'ready' | { error: string };

const SYNC_TOAST_MS = 8000;

@Component({
  selector: 'iqra-reader-page',
  imports: [RouterLink, BookPanelSheetComponent, ReadingSettingsSheetComponent, PagerComponent, ScrollerComponent, ReflowViewComponent, ZoomGesturesDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (statusKind()) {
      @case ('loading') {
        <div class="status" role="status">
          <div class="skeleton" aria-hidden="true"></div>
          <p>{{ copy.loading }}</p>
        </div>
      }
      @case ('error') {
        <div class="status error" role="alert">
          <p dir="auto">{{ errorText() }}</p>
          <div class="actions">
            <button type="button" class="btn" (click)="load()">{{ copy.retry }}</button>
            <a class="btn link" routerLink="/library">{{ copy.back }}</a>
          </div>
        </div>
      }
      @case ('ready') {
        @let s = state()!;
        @let r = session()!;
        @let b = book()!;
        <section class="reader ready" [attr.data-rt]="theme()" [class.immersive]="!s.chrome()">
          <header class="r-top" [attr.inert]="s.chrome() ? null : ''">
            <a class="ib" routerLink="/library" [attr.aria-label]="copy.back" [innerHTML]="ic('back')"></a>
            <div class="r-title">
              <div class="t1" dir="auto">{{ b.title }}</div>
              @if (chapter(); as c) {
                <div class="t2 chapter" dir="auto">{{ c }}</div>
              }
            </div>
            @if (s.canBack() || s.canForward()) {
              <button type="button" class="ib" [attr.aria-label]="copy.jumpBack" [disabled]="!s.canBack()" (click)="historyBack()" [innerHTML]="ic('histBack')"></button>
              <button type="button" class="ib" [attr.aria-label]="copy.jumpForward" [disabled]="!s.canForward()" (click)="historyForward()" [innerHTML]="ic('histFwd')"></button>
            }
            <button
              type="button"
              class="ib"
              [attr.aria-label]="s.view() === 'page' ? copy.readingMode : copy.pageView"
              (click)="s.setView(s.view() === 'page' ? 'reflow' : 'page')"
              [innerHTML]="ic(s.view() === 'page' ? 'reflow' : 'pageview')"
            ></button>
            <button type="button" class="ib" [attr.aria-label]="copy.search" (click)="openPanel('search')" [innerHTML]="ic('search')"></button>
            <button type="button" class="ib" [attr.aria-label]="copy.settings" (click)="settingsOpen.set(true)" [innerHTML]="ic('type')"></button>
          </header>

          <main class="stage">
            @if (s.view() === 'reflow') {
              <iqra-reflow-view
                [renderer]="r"
                [page]="s.page()"
                [zoom]="s.zoom()"
                [rtl]="rtl()"
                [theme]="theme()"
                (pageChange)="s.pageChange($event)"
                (showPage)="showPage()"
                (tap)="s.toggleChrome()"
              />
            } @else if (b.pageMode === 'scroll') {
              <iqra-scroller
                [renderer]="r"
                [startPlace]="s.place()"
                [zoom]="s.zoom()"
                [theme]="theme()"
                (placeChange)="s.placeChange($event)"
                (zoomChange)="s.setZoom($event)"
                (tap)="s.toggleChrome()"
              />
            } @else {
              <div
                class="zoomwrap"
                iqraZoomGestures
                view="page"
                [zoom]="s.zoom()"
                [lastCustomZoom]="s.lastCustomZoom()"
                (zoomChange)="s.setZoom($event)"
              >
                <iqra-pager
                  [renderer]="r"
                  [page]="s.page()"
                  [zoom]="s.zoom()"
                  [rtl]="rtl()"
                  [theme]="theme()"
                  (pageChange)="s.pageChange($event)"
                  (zoomChange)="s.setZoom($event)"
                  (tap)="s.toggleChrome()"
                />
              </div>
            }
          </main>

          <div class="zoompair">
            <button type="button" class="ib" [attr.aria-label]="copy.zoom + ' +'" (click)="s.setZoom(zoomIn(s.zoom(), s.view()))" [innerHTML]="ic('zoomIn')"></button>
            <button type="button" class="ib" [attr.aria-label]="copy.zoom + ' −'" (click)="s.setZoom(zoomOut(s.zoom(), s.view()))" [innerHTML]="ic('zoomOut')"></button>
          </div>

          <footer class="r-bottom" [attr.inert]="s.chrome() ? null : ''">
            <div class="r-range">
              <input
                type="range"
                min="1"
                [max]="r.numPages"
                step="1"
                [value]="preview() ?? s.page()"
                [attr.aria-label]="copy.pageOf(preview() ?? s.page(), r.numPages)"
                (input)="preview.set(sliderValue($event))"
                (change)="slide($event)"
              />
            </div>
            <div class="r-row">
              <button type="button" class="ib" [attr.aria-label]="copy.prevPage" [disabled]="s.page() <= 1" (click)="step(-1)" [innerHTML]="ic('chevL')"></button>
              <span class="pg">{{ copy.pageOf(preview() ?? s.page(), r.numPages) }} <span>· {{ percent() }}%</span></span>
              <button type="button" class="pill" (click)="openPanel('contents')">{{ copy.contents }}</button>
              <button type="button" class="ib" [attr.aria-label]="copy.nextPage" [disabled]="s.page() >= r.numPages" (click)="step(1)" [innerHTML]="ic('chevR')"></button>
            </div>
          </footer>
          <iqra-book-panel-sheet
            [open]="panel() !== null"
            [tab]="panel() ?? 'contents'"
            [book]="b"
            [renderer]="r"
            [page]="s.page()"
            (closed)="panel.set(null)"
            (jump)="jump($event)"
          />
          <iqra-reading-settings-sheet
            [open]="settingsOpen()"
            [book]="b"
            [state]="s"
            (closed)="settingsOpen.set(false)"
            (bookChange)="book.set($event)"
          />
        </section>
      }
    }
  `,
  styles: `
    :host { display: block; }
    .status { display: grid; justify-items: center; align-content: center; gap: 12px; min-height: 60vh; padding: 24px var(--gutter); color: var(--muted); text-align: center; }
    .status p { margin: 0; font-size: 15px; }
    .skeleton { width: 120px; height: 168px; border-radius: 4px; background: var(--surface-2); }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; }
    .btn { display: inline-flex; align-items: center; justify-content: center; min-width: 40px; min-height: 40px; padding: 0 16px; border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--surface); color: var(--fg); font: 15px var(--ui); text-decoration: none; cursor: pointer; }
    .btn.link { color: var(--accent); }
    .btn:focus-visible, .ib:focus-visible, .pill:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

    .reader {
      --paper: var(--paper-light); --ink: var(--ink-light);
      position: fixed; inset: 0; display: flex; flex-direction: column; color: var(--ink);
      background: color-mix(in srgb, var(--ink) 7%, var(--paper));
    }
    .reader[data-rt='sepia'] { --paper: var(--paper-sepia); --ink: var(--ink-sepia); }
    .reader[data-rt='night'] { --paper: var(--paper-night); --ink: var(--ink-night); }
    .stage { position: absolute; inset: 0; }
    .zoomwrap { width: 100%; height: 100%; }
    .r-top, .r-bottom {
      position: absolute; left: 0; right: 0; z-index: 5;
      background: color-mix(in srgb, var(--paper) 94%, transparent);
      -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
      transition: transform 240ms cubic-bezier(.2, .8, .2, 1), opacity 200ms;
    }
    .r-top { top: 0; display: flex; align-items: center; padding: 8px 6px 8px 2px; border-bottom: 1px solid color-mix(in srgb, var(--ink) 10%, transparent); }
    .r-bottom { bottom: 0; display: grid; gap: 4px; padding: 8px 10px calc(8px + env(safe-area-inset-bottom, 0px)); border-top: 1px solid color-mix(in srgb, var(--ink) 10%, transparent); }
    .immersive .r-top { transform: translateY(-100%); opacity: 0; pointer-events: none; }
    .immersive .r-bottom { transform: translateY(100%); opacity: 0; pointer-events: none; }
    .r-title { flex: 1; min-width: 0; padding: 0 4px; }
    .t1 { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .t2 { font-size: 12px; color: color-mix(in srgb, var(--ink) 58%, transparent); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ib { display: inline-grid; place-items: center; width: 40px; height: 40px; flex: none; padding: 0; border: 0; border-radius: var(--radius-control); background: none; color: inherit; cursor: pointer; }
    .ib:hover:not(:disabled) { background: color-mix(in srgb, var(--ink) 8%, transparent); }
    .ib:disabled { opacity: 0.35; cursor: default; }
    .r-row { display: flex; align-items: center; gap: 6px; }
    .pg { flex: 1; min-width: 0; font-size: 13px; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
    .pg span { color: color-mix(in srgb, var(--ink) 55%, transparent); }
    .pill { min-height: 40px; padding: 0 14px; border: 1px solid color-mix(in srgb, var(--ink) 18%, transparent); border-radius: 999px; background: none; color: inherit; font: 13px var(--ui); cursor: pointer; }
    .r-range { display: flex; align-items: center; padding: 0 6px; }
    .r-range input { flex: 1; min-width: 0; min-height: 24px; accent-color: var(--accent); }
    .zoompair { display: none; }
    @media (min-width: 900px) {
      .zoompair { position: absolute; right: 16px; bottom: 120px; z-index: 5; display: grid; gap: 6px; background: color-mix(in srgb, var(--paper) 94%, transparent); border-radius: var(--radius-control); box-shadow: var(--shadow); }
      .immersive .zoompair { bottom: 24px; }
    }
    @media (prefers-reduced-motion: reduce) { .r-top, .r-bottom { transition: none; } }
  `,
})
export class ReaderPage implements OnDestroy {
  protected readonly copy = COPY.reader;
  protected readonly zoomIn = zoomIn;
  protected readonly zoomOut = zoomOut;

  private readonly route = inject(ActivatedRoute);
  private readonly db = inject(DB);
  private readonly drive = inject(DRIVE_ADAPTER);
  private readonly positions = inject(PositionService);
  private readonly settings = inject(SettingsService);
  private readonly toast = inject(ToastService);
  private readonly open = inject(PDF_OPENER);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly scroller = viewChild(ScrollerComponent);

  protected readonly status = signal<Status>('loading');
  protected readonly statusKind = computed(() => {
    const s = this.status();
    return typeof s === 'string' ? s : 'error';
  });
  protected readonly errorText = computed(() => {
    const s = this.status();
    return typeof s === 'string' ? '' : s.error;
  });
  protected readonly book = signal<Book | null>(null);
  protected readonly session = signal<ReaderSession | null>(null);
  protected readonly state = signal<ReaderState | null>(null);
  protected readonly preview = signal<number | null>(null);
  protected readonly panel = signal<'contents' | 'search' | null>(null);
  protected readonly settingsOpen = signal(false);

  protected readonly theme = computed(() => this.settings.settings().readerTheme);
  protected readonly rtl = computed(() => this.book()?.direction === 'rtl');
  protected readonly chapter = computed(() => {
    const b = this.book();
    const s = this.state();
    return b && s ? chapterTitleAt(b.outline, s.page()) : null;
  });
  protected readonly percent = computed(() => {
    const s = this.state();
    const n = this.session()?.numPages ?? 0;
    return s && n > 0 ? Math.round(((this.preview() ?? s.page()) / n) * 100) : 0;
  });

  private destroyed = false;
  private loadId = 0;

  constructor() {
    void this.load();
  }

  protected ic(name: IconName) {
    return this.sanitizer.bypassSecurityTrustHtml(icon(name, 22));
  }

  async load(): Promise<void> {
    const id = ++this.loadId;
    this.status.set('loading');
    let opened: ReaderSession | undefined;
    try {
      const bookId = this.route.snapshot.paramMap.get('bookId') ?? '';
      const streaming = this.route.snapshot.queryParamMap.get('source') === 'drive';
      const book = await this.db.books.get(bookId);
      if (!book || book.deleted) throw new ReaderOpenError('corrupt');

      let src: PdfSource;
      const file = await this.db.pdfFiles.get(bookId);
      if (file) {
        src = { kind: 'local', blob: file.blob };
      } else if (streaming) {
        src = { kind: 'drive', ...this.drive.mediaRequest(book.driveFileId) };
      } else {
        throw new ReaderOpenError('corrupt');
      }

      const session = await this.open(src);
      opened = session;
      if (this.destroyed || id !== this.loadId) {
        session.destroy();
        return;
      }
      const restored = await this.positions.restore(book);
      const state = new ReaderState(book, this.positions);
      state.init(restored);
      this.session()?.destroy();
      this.book.set(book);
      this.session.set(session);
      this.state.set(state);
      this.status.set('ready');
      state.touch();
      if (restored.fromOtherDevice && restored.previousLocal) {
        const back = restored.previousLocal;
        this.toast.show(COPY.reader.syncedFrom(back.page), {
          actionLabel: COPY.reader.backAction,
          durationMs: SYNC_TOAST_MS,
          undo: () => this.jump(back),
        });
      }
    } catch (err) {
      // A session that opened but never became the page's session would leak its worker document.
      if (opened && this.session() !== opened) opened.destroy();
      if (this.destroyed || id !== this.loadId) return;
      this.status.set({ error: this.errorMessage(err) });
    }
  }

  private errorMessage(err: unknown): string {
    const reason = err instanceof ReaderOpenError ? err.reason : typeof err === 'string' ? err : 'corrupt';
    if (reason === 'password') return COPY.reader.passwordFailed;
    if (reason === 'network') return COPY.reader.networkFailed;
    return COPY.reader.failed;
  }

  /** A jump: records history, then moves (and scrolls, in scroll mode). */
  protected jump(place: Place): void {
    const s = this.state();
    if (!s) return;
    s.jumpTo(place);
    this.scroller()?.scrollTo(place);
  }

  protected historyBack(): void {
    const place = this.state()?.historyBack();
    if (place) this.scroller()?.scrollTo(place);
  }

  protected historyForward(): void {
    const place = this.state()?.historyForward();
    if (place) this.scroller()?.scrollTo(place);
  }

  protected step(dir: 1 | -1): void {
    const s = this.state();
    const n = this.session()?.numPages ?? 0;
    if (!s) return;
    const page = Math.min(n, Math.max(1, s.page() + dir));
    if (page === s.page()) return;
    s.pageChange(page);
    this.scroller()?.scrollTo({ page, offset: 0 });
  }

  protected showPage(): void {
    const s = this.state();
    s?.setView('page');
  }

  protected openPanel(which: 'contents' | 'search'): void {
    this.panel.set(which);
  }

  protected sliderValue(e: Event): number {
    return Number((e.target as HTMLInputElement).value);
  }

  protected slide(e: Event): void {
    this.preview.set(null);
    this.jump({ page: this.sliderValue(e), offset: 0 });
  }

  @HostListener('document:keydown', ['$event'])
  protected onKey(e: KeyboardEvent): void {
    if (!this.state() || isReaderKeyIgnored(e)) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'f') {
      this.openPanel('search');
      e.preventDefault();
      return;
    }
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'ArrowLeft') {
      this.historyBack();
      e.preventDefault();
    } else if (e.key === 'ArrowRight') {
      this.historyForward();
      e.preventDefault();
    }
  }

  @HostListener('document:visibilitychange')
  protected onVisibility(): void {
    if (document.visibilityState === 'hidden') void this.state()?.flush();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    void this.state()?.flush();
    this.session()?.destroy();
  }
}
