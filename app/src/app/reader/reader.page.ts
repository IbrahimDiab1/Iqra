import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  Signal,
  WritableSignal,
  effect,
  InjectionToken,
  OnDestroy,
  computed,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { buildAnchor } from '../annotations/anchor';
import { AnnotationService, type HighlightColor } from '../annotations/annotation.service';
import { NoteSheetComponent } from '../annotations/note-sheet.component';
import { TextEditorSheet } from '../annotations/text-editor.sheet';
import { findSummary } from '../annotations/summary-scope';
import { tagSuggestionsFrom } from '../annotations/tag-input.component';
import { CLOCK } from '../core/clock';
import { DB } from '../core/db';
import { newId } from '../core/ids';
import type { Annotation, Book, Rect, SummaryScope } from '../core/models';
import { Repo } from '../core/repo';
import { SettingsService } from '../core/settings.service';
import { ReadMarkService } from '../progress/read-mark.service';
import { DRIVE_ADAPTER } from '../sync/drive-adapter';
import { COPY } from '../ui/copy';
import { icon, type IconName } from '../ui/icons';
import { ToastService } from '../ui/toast.service';
import type { Place } from './jump-history';
import { isReaderKeyIgnored } from './keys';
import { chapterTitleAt } from './outline';
import { BookPanelSheetComponent, type PanelTab } from './book-panel.sheet';
import { PagerComponent } from './pager.component';
import { PdfSession, ReaderOpenError, type PageRenderer, type PdfSource } from './pdf-session';
import { PositionService } from './position.service';
import { ReaderState } from './reader.state';
import { SessionService, type ReaderSessionHandle } from './session.service';
import { ReadingSettingsSheetComponent } from './reading-settings.sheet';
import { ReflowViewComponent } from './reflow-view.component';
import { ScrollerComponent } from './scroller.component';
import { SelectionService, type PendingSelection } from './selection.service';
import { SelectionToolbarComponent, type PendingArea } from './selection-toolbar.component';
import { ZoomGesturesDirective } from './zoom-gestures.directive';
import { zoomIn, zoomOut } from './zoom';

export type ReaderSession = PageRenderer & { destroy(): void };

/** Opens a PDF; tests provide a fake. */
export const PDF_OPENER = new InjectionToken<(src: PdfSource) => Promise<ReaderSession>>('pdfOpener', {
  factory: () => (src) => PdfSession.open(src),
});

type Status = 'loading' | 'ready' | { error: string };

const SYNC_TOAST_MS = 8000;
const AREA_HINT_MS = 4000;
/** A jump to an annotation lands a little above it. */
const ANNOTATION_JUMP_MARGIN = 0.05;
const FINISH_TOAST_MS = 8000;

@Component({
  selector: 'iqra-reader-page',
  imports: [RouterLink, BookPanelSheetComponent, ReadingSettingsSheetComponent, PagerComponent, ScrollerComponent, ReflowViewComponent, ZoomGesturesDirective, SelectionToolbarComponent, NoteSheetComponent, TextEditorSheet],
  providers: [SelectionService],
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
        <section
          class="reader ready"
          [attr.data-rt]="theme()"
          [class.immersive]="!s.chrome()"
          [style.--reader-top.px]="s.chrome() ? topH() : 0"
          [style.--reader-bottom.px]="s.chrome() ? bottomH() : 0"
        >
          <header #topBar class="r-top" [attr.inert]="s.chrome() ? null : ''">
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
            @if (s.view() === 'page') {
              <button
                type="button"
                class="ib"
                [attr.aria-label]="annCopy.area"
                [attr.aria-pressed]="s.tool() === 'area'"
                [class.on]="s.tool() === 'area'"
                (click)="toggleArea()"
                [innerHTML]="ic('areaSelect')"
              ></button>
            }
            <button
              type="button"
              class="ib bookmark"
              [attr.aria-label]="bookmark() ? annCopy.removeBookmark : annCopy.addBookmark"
              [attr.aria-pressed]="!!bookmark()"
              [class.on]="!!bookmark()"
              (click)="toggleBookmark()"
              [innerHTML]="ic(bookmark() ? 'bookmarkFill' : 'bookmark')"
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
                [annotations]="annotations()"
                [flashId]="s.flash()"
                (annotationTap)="onAnnotationTap($event)"
                (tap)="s.toggleChrome()"
              />
            } @else if (b.pageMode === 'scroll') {
              <iqra-scroller
                [renderer]="r"
                [startPlace]="s.place()"
                [zoom]="s.zoom()"
                [theme]="theme()"
                [annotations]="annotations()"
                [flashId]="s.flash()"
                [tool]="s.tool()"
                (areaDrawn)="onAreaDrawn($event)"
                (placeChange)="s.placeChange($event)"
                (zoomChange)="s.setZoom($event)"
                (annotationTap)="onAnnotationTap($event)"
                (tap)="s.toggleChrome()"
              />
            } @else {
              <div
                class="zoomwrap"
                iqraZoomGestures
                view="page"
                [zoom]="s.zoom()"
                [lastCustomZoom]="s.lastCustomZoom()"
                [suspended]="s.tool() !== 'none'"
                (zoomChange)="s.setZoom($event)"
              >
                <iqra-pager
                  [renderer]="r"
                  [page]="s.page()"
                  [zoom]="s.zoom()"
                  [rtl]="rtl()"
                  [theme]="theme()"
                  [annotations]="annotations()"
                  [flashId]="s.flash()"
                  [tool]="s.tool()"
                  (areaDrawn)="onAreaDrawn($event)"
                  (pageChange)="s.pageChange($event)"
                  (zoomChange)="s.setZoom($event)"
                  (annotationTap)="onAnnotationTap($event)"
                  (tap)="s.toggleChrome()"
                />
              </div>
            }
          </main>

          <iqra-selection-toolbar
            [selection]="toolbarTarget()"
            (color)="highlight($event)"
            (note)="addNote()"
            (copy)="copySelection()"
          />

          <div class="zoompair">
            <button type="button" class="ib" [attr.aria-label]="copy.zoom + ' +'" (click)="s.setZoom(zoomIn(s.zoom(), s.view()))" [innerHTML]="ic('zoomIn')"></button>
            <button type="button" class="ib" [attr.aria-label]="copy.zoom + ' −'" (click)="s.setZoom(zoomOut(s.zoom(), s.view()))" [innerHTML]="ic('zoomOut')"></button>
          </div>

          <footer #bottomBar class="r-bottom" [attr.inert]="s.chrome() ? null : ''">
            <div class="r-range" [attr.dir]="rtl() ? 'rtl' : null">
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
            <div class="r-row" [attr.dir]="rtl() ? 'rtl' : null">
              <button type="button" class="ib" [attr.aria-label]="copy.prevPage" [disabled]="s.page() <= 1" (click)="step(-1)" [innerHTML]="ic(rtl() ? 'chevR' : 'chevL')"></button>
              <span class="pg" dir="ltr">{{ copy.pageOf(preview() ?? s.page(), r.numPages) }} <span>· {{ percent() }}%</span></span>
              @if (b.progressMode === 'marked') {
                <button type="button" class="pill mark-read" [attr.aria-pressed]="pageMarked()" [class.on]="pageMarked()" (click)="toggleMark()">
                  {{ pageMarked() ? progressCopy.markedRead : progressCopy.markRead }}
                </button>
              }
              <button type="button" class="pill" (click)="openPanel('contents')">
                {{ copy.contents }}
                @if (pageNoteCount() > 0) {
                  <span class="badge">{{ pageNoteCount() }}</span>
                }
              </button>
              <button type="button" class="ib" [attr.aria-label]="copy.nextPage" [disabled]="s.page() >= r.numPages" (click)="step(1)" [innerHTML]="ic(rtl() ? 'chevL' : 'chevR')"></button>
            </div>
          </footer>
          <iqra-book-panel-sheet
            [open]="panel() !== null"
            [tab]="panel() ?? 'contents'"
            [book]="b"
            [renderer]="r"
            [page]="s.page()"
            [annotations]="annotations()"
            (closed)="panel.set(null)"
            (jump)="jump($event)"
            (summary)="editSummary($event)"
            (edit)="editText($event)"
            (note)="noteTarget.set($event)"
            (sideNote)="startSideNote($event)"
            (flash)="s.flashAnnotation($event)"
          />
          <iqra-text-editor-sheet
            [annotation]="textTarget()"
            [draft]="textIsDraft()"
            [isNew]="textTarget()?.id === newSideNoteId()"
            [pageCount]="r.numPages"
            [tagSuggestions]="tagSuggestions()"
            (closed)="closeText($event.empty)"
          />
          <iqra-note-sheet
            [annotation]="noteTarget()"
            [isNew]="noteTarget()?.id === newNoteId()"
            [tagSuggestions]="tagSuggestions()"
            (closed)="noteTarget.set(null)"
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
      transition: --reader-top 240ms cubic-bezier(.2, .8, .2, 1), --reader-bottom 240ms cubic-bezier(.2, .8, .2, 1);
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
    .r-top { top: 0; display: flex; align-items: center; padding: calc(8px + env(safe-area-inset-top, 0px)) 6px 8px 2px; border-bottom: 1px solid color-mix(in srgb, var(--ink) 10%, transparent); }
    .r-bottom { bottom: 0; display: grid; gap: 4px; padding: 8px 10px calc(8px + env(safe-area-inset-bottom, 0px)); border-top: 1px solid color-mix(in srgb, var(--ink) 10%, transparent); }
    .immersive .r-top { transform: translateY(-100%); opacity: 0; pointer-events: none; }
    .immersive .r-bottom { transform: translateY(100%); opacity: 0; pointer-events: none; }
    .r-title { flex: 1; min-width: 0; padding: 0 4px; }
    .t1 { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .t2 { font-size: 12px; color: color-mix(in srgb, var(--ink) 58%, transparent); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ib { display: inline-grid; place-items: center; width: 40px; height: 40px; flex: none; padding: 0; border: 0; border-radius: var(--radius-control); background: none; color: inherit; cursor: pointer; }
    .ib:hover:not(:disabled) { background: color-mix(in srgb, var(--ink) 8%, transparent); }
    .ib:disabled { opacity: 0.35; cursor: default; }
    .ib.on { background: color-mix(in srgb, var(--accent) 18%, transparent); color: var(--accent); }
    .r-row { display: flex; align-items: center; gap: 6px; }
    .pg { flex: 1; min-width: 0; font-size: 13px; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
    .pg span { color: color-mix(in srgb, var(--ink) 55%, transparent); }
    .badge { display: inline-block; min-width: 18px; margin-inline-start: 6px; padding: 0 5px; border-radius: 999px; background: var(--accent); color: var(--on-accent, #fff); font-size: 11px; font-weight: 600; line-height: 18px; text-align: center; }
    .pill.on { background: color-mix(in srgb, var(--accent) 18%, transparent); border-color: var(--accent); color: var(--accent); }
    .pill { min-height: 40px; padding: 0 14px; border: 1px solid color-mix(in srgb, var(--ink) 18%, transparent); border-radius: 999px; background: none; color: inherit; font: 13px var(--ui); cursor: pointer; }
    .r-range { display: flex; align-items: center; padding: 0 6px; }
    .r-range input { direction: inherit; flex: 1; min-width: 0; min-height: 24px; accent-color: var(--accent); }
    .zoompair { display: none; }
    @media (min-width: 900px) {
      .zoompair { position: absolute; right: 16px; bottom: 120px; z-index: 5; display: grid; gap: 6px; background: color-mix(in srgb, var(--paper) 94%, transparent); border-radius: var(--radius-control); box-shadow: var(--shadow); }
      .immersive .zoompair { bottom: 24px; }
    }
    @media (prefers-reduced-motion: reduce) { .reader, .r-top, .r-bottom { transition: none; } }
  `,
})
export class ReaderPage implements OnDestroy {
  protected readonly copy = COPY.reader;
  protected readonly annCopy = COPY.annotations;
  protected readonly progressCopy = COPY.progress;
  protected readonly zoomIn = zoomIn;
  protected readonly zoomOut = zoomOut;

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly db = inject(DB);
  private readonly drive = inject(DRIVE_ADAPTER);
  private readonly positions = inject(PositionService);
  private readonly settings = inject(SettingsService);
  private readonly toast = inject(ToastService);
  private readonly clock = inject(CLOCK);
  private readonly sessions = inject(SessionService);
  private readonly readMarks = inject(ReadMarkService);
  private readonly open = inject(PDF_OPENER);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly annotationService = inject(AnnotationService);
  private readonly repo = inject(Repo);
  protected readonly selection = inject(SelectionService);
  private readonly scroller = viewChild(ScrollerComponent);
  private readonly topBar = viewChild<ElementRef<HTMLElement>>('topBar');
  private readonly bottomBar = viewChild<ElementRef<HTMLElement>>('bottomBar');
  /** Heights of the bars (safe areas included): the space the content reserves while the chrome is visible. */
  protected readonly topH = signal(0);
  protected readonly bottomH = signal(0);

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
  private readonly markSource = signal<Signal<ReadonlySet<number> | undefined> | null>(null);
  private readonly marked = computed(() => this.markSource()?.() ?? new Set<number>());
  /** Whether the current page is marked read (marked mode). */
  protected readonly pageMarked = computed(() => this.marked().has(this.state()?.page() ?? 0));
  private tracking: ReaderSessionHandle | null = null;
  /** The finish prompt is offered once per open. */
  private finishOffered = false;
  private readonly annotationSource = signal<Signal<Annotation[] | undefined> | null>(null);
  /** This book's live annotations. */
  protected readonly annotations = computed(() => this.annotationSource()?.() ?? []);
  /** The annotation the note sheet edits: a tapped highlight, or a freshly created note. */
  protected readonly noteTarget = signal<Annotation | null>(null);
  /** The note created by the Note action in this open session; only it is removed if closed empty. */
  protected readonly newNoteId = signal<string | null>(null);
  /** The side note or summary the text editor sheet edits. */
  protected readonly textTarget = signal<Annotation | null>(null);
  protected readonly textIsDraft = signal(false);
  /** The live bookmark on the current page, if any. */
  protected readonly bookmark = computed(() => {
    const page = this.state()?.page();
    return this.annotations().find((a) => a.type === 'bookmark' && a.page === page);
  });
  /** How many notes, highlights, areas and side notes are on the current page (bookmarks do not count). */
  protected readonly pageNoteCount = computed(() => {
    const page = this.state()?.page();
    return this.annotations().filter((a) => a.type !== 'bookmark' && a.page === page).length;
  });
  /** The side note the panel just created in this open session; closed empty, it is removed. */
  protected readonly newSideNoteId = signal<string | null>(null);
  private bookmarkBusy = false;
  private readonly addedBookmarks = new Map<number, string>();
  private readonly removedBookmarks = new Set<string>();
  private readonly allAnnotations = this.annotationService.all();
  protected readonly tagSuggestions = computed(() => tagSuggestionsFrom(this.allAnnotations()));
  /** A rectangle just drawn with the area tool, waiting for a color or a note. */
  private readonly pendingArea = signal<PendingArea | null>(null);
  protected readonly toolbarTarget = computed(() => this.pendingArea() ?? this.selection.pending());
  protected readonly session = signal<ReaderSession | null>(null);
  protected readonly state = signal<ReaderState | null>(null);
  protected readonly preview = signal<number | null>(null);
  protected readonly panel = signal<PanelTab | null>(null);
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

  private stopListening: () => void = () => undefined;
  private destroyed = false;
  private loadId = 0;

  constructor() {
    this.measure(this.topBar, this.topH);
    this.measure(this.bottomBar, this.bottomH);
    effect(() => {
      const s = this.state();
      if (!s) return;
      const page = s.page();
      untracked(() => {
        this.tracking?.pageChanged(page);
        this.offerFinishAtEnd(page);
      });
    });
    effect(() => {
      this.state()?.zoom();
      untracked(() => this.tracking?.activity());
    });
    const activity = () => this.tracking?.activity();
    const root = this.host.nativeElement;
    for (const type of ['pointerdown', 'wheel', 'keydown', 'touchmove', 'scroll']) {
      root.addEventListener(type, activity, { capture: true, passive: true });
    }
    document.addEventListener('selectionchange', activity);
    this.stopListening = () => {
      for (const type of ['pointerdown', 'wheel', 'keydown', 'touchmove', 'scroll']) root.removeEventListener(type, activity, { capture: true });
      document.removeEventListener('selectionchange', activity);
    };
    void this.load();
  }

  private measure(bar: () => ElementRef<HTMLElement> | undefined, into: WritableSignal<number>): void {
    effect((onCleanup) => {
      const el = bar()?.nativeElement;
      if (!el) return;
      const read = () => into.set(el.offsetHeight);
      read();
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(read);
      observer.observe(el);
      onCleanup(() => observer.disconnect());
    });
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
      const target = await this.openTarget(book.id, book.pageCount);
      if (target) {
        state.jumpTo(target.place);
        this.consumeTarget();
      }
      this.session()?.destroy();
      this.book.set(book);
      this.annotationSource.set(this.annotationService.forBook(book.id));
      this.selection.attach({ items: (page) => session.textItems(page) });
      this.session.set(session);
      this.state.set(state);
      this.status.set('ready');
      void this.tracking?.end();
      this.tracking = this.sessions.start(book, state.page());
      this.finishOffered = false;
      this.markSource.set(this.readMarks.marked(book.id));
      this.positions.markOpened(book).catch((err) => console.warn('Could not record the open', err));
      if (target?.flashId) state.flashAnnotation(target.flashId);
      if (!target && restored.fromOtherDevice && restored.previousLocal) {
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

  /**
   * Where `?page=` (and `?a=` for the annotation to flash) ask to open: a little above the
   * annotation when it still exists. Invalid values are ignored.
   */
  /** The jump has been made: drop `page` and `a` so a reload, Retry or restored tab keeps the reader's own place. */
  private consumeTarget(): void {
    const url = this.router.parseUrl(this.router.url);
    delete url.queryParams['page'];
    delete url.queryParams['a'];
    this.router.navigateByUrl(url, { replaceUrl: true }).catch((err) => console.warn('Could not clear the open target', err));
  }

  private async openTarget(bookId: string, pageCount: number): Promise<{ place: Place; flashId?: string } | null> {
    const params = this.route.snapshot.queryParamMap;
    const raw = params.get('page');
    if (raw === null || !/^\d+$/.test(raw)) return null;
    const page = Number(raw);
    if (page < 1 || page > pageCount) return null;
    const id = params.get('a');
    const ann = id ? await this.db.annotations.get(id) : undefined;
    if (!ann || ann.deleted || ann.bookId !== bookId || ann.page !== page) return { place: { page, offset: 0 } };
    const y = (ann.type === 'area' ? ann.rect?.y : ann.text?.rects[0]?.y) ?? 0;
    return { place: { page, offset: Math.max(0, y - ANNOTATION_JUMP_MARGIN) }, flashId: ann.id };
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

  protected openPanel(which: PanelTab): void {
    this.panel.set(which);
  }

  /** A tap on a highlight opens its note sheet. */
  protected onAnnotationTap(a: Annotation): void {
    this.noteTarget.set(a);
  }

  protected async toggleBookmark(): Promise<void> {
    const s = this.state();
    const book = this.book();
    if (!s || !book || this.bookmarkBusy) return;
    const page = s.page();
    const live = this.bookmark();
    // The live query can lag a tap behind, so what this page itself just added or removed wins.
    const existingId = live && !this.removedBookmarks.has(live.id) ? live.id : this.addedBookmarks.get(page);
    this.bookmarkBusy = true;
    try {
      if (existingId) {
        this.removedBookmarks.add(existingId);
        this.addedBookmarks.delete(page);
        const rec = await this.annotationService.remove(existingId);
        if (rec) {
          this.toast.show(COPY.annotations.deleted, {
            undo: () => {
              this.removedBookmarks.delete(rec.id);
              this.addedBookmarks.set(page, rec.id);
              void this.annotationService.restore(rec);
            },
          });
        }
      } else {
        const created = await this.annotationService.create({ bookId: book.id, type: 'bookmark', page });
        this.addedBookmarks.set(page, created.id);
        this.toast.show(COPY.annotations.bookmarkAdded);
      }
    } catch (err) {
      console.warn('Could not change the bookmark', err);
      this.toast.show(COPY.annotations.saveFailed);
    } finally {
      this.bookmarkBusy = false;
    }
  }

  /** Opens the summary editor on a scope: the stored summary, or an unsaved draft that is created on the first non-empty text. */
  protected editSummary(scope: SummaryScope): void {
    const book = this.book();
    if (!book) return;
    const existing = findSummary(this.annotations(), scope);
    this.textIsDraft.set(!existing);
    this.textTarget.set(
      existing ?? { id: newId(), bookId: book.id, deviceId: '', updatedAt: 0, type: 'summary', scope, tags: [], createdAt: 0 },
    );
  }

  protected editText(a: Annotation): void {
    this.textIsDraft.set(false);
    this.textTarget.set(a);
  }

  protected startSideNote(a: Annotation): void {
    this.newSideNoteId.set(a.id);
    this.editText(a);
  }

  /** Closing the text editor drops a side note made just now and left empty. */
  protected closeText(empty: boolean): void {
    const target = this.textTarget();
    this.textTarget.set(null);
    if (!target || target.id !== this.newSideNoteId()) return;
    this.newSideNoteId.set(null);
    if (empty) {
      void this.annotationService.remove(target.id).catch((err) => console.warn('Could not drop the empty side note', err));
    }
  }

  protected toggleArea(): void {
    const s = this.state();
    if (!s) return;
    if (s.tool() === 'area') {
      s.tool.set('none');
      return;
    }
    this.selection.clear();
    this.pendingArea.set(null);
    s.tool.set('area');
    this.toast.show(COPY.annotations.areaHint, { durationMs: AREA_HINT_MS });
  }

  /** A finished drag: the tool turns itself off and the toolbar offers a color or a note. */
  protected onAreaDrawn(e: { page: number; rect: Rect }): void {
    this.state()?.tool.set('none');
    const box = this.host.nativeElement.querySelector(`.text-layer[data-page="${e.page}"]`)?.getBoundingClientRect();
    const left = (box?.left ?? 0) + e.rect.x * (box?.width ?? 0);
    const top = (box?.top ?? 0) + e.rect.y * (box?.height ?? 0);
    const width = e.rect.w * (box?.width ?? 0);
    const height = e.rect.h * (box?.height ?? 0);
    const anchor = { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
    this.pendingArea.set({ kind: 'area', page: e.page, rect: e.rect, anchor });
  }

  private async saveArea(area: PendingArea, color: HighlightColor, openNote: boolean): Promise<void> {
    const book = this.book();
    if (!book) return;
    try {
      const created = await this.annotationService.create({ bookId: book.id, type: 'area', page: area.page, rect: area.rect, color });
      this.pendingArea.set(null);
      if (openNote) {
        this.noteTarget.set(created);
      } else {
        this.toast.show(COPY.annotations.highlightSaved, { undo: () => void this.annotationService.remove(created.id) });
      }
    } catch (err) {
      console.warn('Could not save the area', err);
      this.toast.show(COPY.annotations.saveFailed);
    }
  }

  private async anchorOf(sel: PendingSelection) {
    const session = this.session()!;
    const [items, size] = await Promise.all([session.textItems(sel.page), session.pageSize(sel.page)]);
    return { anchor: buildAnchor(items, sel.page, sel.start, sel.end, size), geometry: { items, size } };
  }

  protected async highlight(color: HighlightColor): Promise<void> {
    const area = this.pendingArea();
    if (area) return this.saveArea(area, color, false);
    const sel = this.selection.pending();
    const book = this.book();
    if (!sel || !book || !this.session()) return;
    try {
      const { anchor, geometry } = await this.anchorOf(sel);
      const result = await this.annotationService.addHighlight(book.id, anchor, color, geometry);
      this.selection.clear();
      this.toast.show(COPY.annotations.highlightSaved, {
        undo: () => void this.annotationService.undoAddHighlight(result),
      });
    } catch (err) {
      console.warn('Could not save the highlight', err);
      this.toast.show(COPY.annotations.saveFailed);
    }
  }

  protected async addNote(): Promise<void> {
    const area = this.pendingArea();
    if (area) return this.saveArea(area, 'yellow', true);
    const sel = this.selection.pending();
    const book = this.book();
    if (!sel || !book || !this.session()) return;
    try {
      const { anchor } = await this.anchorOf(sel);
      const note = await this.annotationService.create({ bookId: book.id, type: 'note', page: anchor.page, text: anchor });
      this.selection.clear();
      this.newNoteId.set(note.id);
      this.noteTarget.set(note);
    } catch (err) {
      console.warn('Could not save the note', err);
      this.toast.show(COPY.annotations.saveFailed);
    }
  }

  protected async copySelection(): Promise<void> {
    const sel = this.selection.pending();
    if (!sel) return;
    try {
      await navigator.clipboard.writeText(sel.quote);
      this.toast.show(COPY.annotations.copied);
    } catch (err) {
      console.warn('Could not copy the selection', err);
      this.toast.show(COPY.annotations.copyFailed);
    }
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
    if (e.key === 'Escape' && (this.state()!.tool() !== 'none' || this.pendingArea())) {
      this.state()!.tool.set('none');
      this.pendingArea.set(null);
      e.preventDefault();
      return;
    }
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

  /** A press anywhere but the toolbar abandons a drawn area (the toolbar stops its own presses). */
  @HostListener('document:pointerdown')
  protected onPointerDown(): void {
    if (this.pendingArea()) this.pendingArea.set(null);
  }

  @HostListener('document:visibilitychange')
  protected onVisibility(): void {
    if (document.visibilityState === 'hidden') void this.state()?.flush();
  }

  /** Last-page mode: reaching the final page for the first time offers to mark the book finished. */
  private offerFinishAtEnd(page: number): void {
    const b = this.book();
    if (!b || b.progressMode !== 'last-page' || b.pageCount <= 0 || page < b.pageCount) return;
    if (b.lastPageReached >= b.pageCount) return;
    this.offerFinish();
  }

  protected async toggleMark(): Promise<void> {
    const s = this.state();
    const b = this.book();
    if (!s || !b) return;
    const page = s.page();
    const set = this.marked();
    const completes = !set.has(page) && set.size + 1 >= b.pageCount;
    try {
      await this.readMarks.toggle(b.id, page);
      if (completes) this.offerFinish();
    } catch (err) {
      console.warn('Could not change the read mark', err);
      this.toast.show(COPY.annotations.saveFailed);
    }
  }

  private offerFinish(): void {
    const b = this.book();
    if (!b || b.status === 'finished' || this.finishOffered) return;
    this.finishOffered = true;
    this.toast.show(COPY.progress.finishPrompt, {
      actionLabel: COPY.progress.markFinished,
      durationMs: FINISH_TOAST_MS,
      undo: () => void this.markFinished(b.id),
    });
  }

  private async markFinished(bookId: string): Promise<void> {
    try {
      const stored = await this.db.books.get(bookId);
      if (!stored || stored.deleted) return;
      const saved = await this.repo.put<Book>('books', { ...stored, status: 'finished', finishedAt: this.clock.now() });
      if (!this.destroyed) this.book.set(saved);
    } catch (err) {
      console.warn('Could not mark the book finished', err);
      this.toast.show(COPY.annotations.saveFailed);
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.stopListening();
    void this.tracking?.end();
    this.tracking = null;
    void this.state()?.flush();
    this.session()?.destroy();
  }
}
