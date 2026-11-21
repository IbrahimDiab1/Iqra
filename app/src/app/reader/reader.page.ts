import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  Signal,
  effect,
  InjectionToken,
  OnDestroy,
  computed,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AnnotationService } from '../annotations/annotation.service';
import { NoteSheetComponent } from '../annotations/note-sheet.component';
import { TextEditorSheet } from '../annotations/text-editor.sheet';
import { tagSuggestionsFrom } from '../annotations/tag-input.component';
import { CLOCK } from '../core/clock';
import { DB } from '../core/db';
import type { Annotation, Book } from '../core/models';
import { Repo } from '../core/repo';
import { SettingsService } from '../core/settings.service';
import { ReadMarkService } from '../progress/read-mark.service';
import { DRIVE_ADAPTER } from '../sync/drive-adapter';
import { SyncScheduler } from '../sync/sync-scheduler';
import { BackLinkDirective } from '../ui/back-link.directive';
import { COPY } from '../ui/copy';
import { PROGRESS_COPY } from './progress-copy';
import { CHROME_COPY } from './chrome-copy';
import { ToastService } from '../ui/toast.service';
import type { Place } from './jump-history';
import { isReaderKeyIgnored } from './keys';
import { chapterTitleAt, sectionTitleAt } from './outline';
import { BookPanelDrawerComponent, type PanelTab } from './book-panel.drawer';
import { PagerComponent } from './pager.component';
import { PdfSession, ReaderOpenError, type PageRenderer, type PdfSource } from './pdf-session';
import { ContextMenuComponent } from './context-menu.component';
import { contextMenuModel, type ContextActionId } from './context-menu';
import { ReaderActions } from './reader-actions';
import { UndoStack } from './undo-stack';
import type { HighlightColor } from '../annotations/annotation.service';
import { PositionService } from './position.service';
import { ReaderState } from './reader.state';
import { SessionService, type ReaderSessionHandle } from './session.service';
import { TranslateSheet } from '../review/translate.sheet';
import { ReadingSettingsSheetComponent } from './reading-settings.sheet';
import { ReaderHeaderComponent } from './reader-header.component';
import { ReaderToolbarComponent, type ToolbarAction } from './reader-toolbar.component';
import { ShortcutHelpComponent } from './shortcut-help.component';
import { shortcutFor, type ShortcutAction } from './shortcuts';
import { ReflowViewComponent } from './reflow-view.component';
import { ScrollerComponent } from './scroller.component';
import { SelectionService } from './selection.service';
import { SelectionToolbarComponent } from './selection-toolbar.component';
import { ZoomGesturesDirective } from './zoom-gestures.directive';
import { zoomIn, zoomOut } from './zoom';

export type ReaderSession = PageRenderer & { destroy(): void };

/** Opens a PDF; tests provide a fake. */
export const PDF_OPENER = new InjectionToken<(src: PdfSource) => Promise<ReaderSession>>('pdfOpener', {
  factory: () => (src) => PdfSession.open(src),
});

type Status = 'loading' | 'ready' | { error: string };

const SYNC_TOAST_MS = 8000;
/** A jump to an annotation lands a little above it. */
const ANNOTATION_JUMP_MARGIN = 0.05;
const FINISH_TOAST_MS = 8000;

@Component({
  selector: 'iqra-reader-page',
  imports: [BackLinkDirective, ContextMenuComponent, ReaderHeaderComponent, ReaderToolbarComponent, ShortcutHelpComponent, BookPanelDrawerComponent, ReadingSettingsSheetComponent, PagerComponent, ScrollerComponent, ReflowViewComponent, ZoomGesturesDirective, SelectionToolbarComponent, NoteSheetComponent, TextEditorSheet, TranslateSheet],
  providers: [SelectionService, UndoStack, ReaderActions],
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
            <a class="btn link" iqraBack="/library">{{ copy.back }}</a>
          </div>
        </div>
      }
      @case ('ready') {
        @let s = state()!;
        @let r = session()!;
        @let b = book()!;
        <section class="reader ready" [attr.data-rt]="theme()">
          <iqra-reader-header
            class="r-top"
            [title]="b.title"
            [chapter]="chapter()"
            [section]="section()"
            [page]="s.page()"
            [numPages]="r.numPages"
            [canBack]="s.canBack()"
            [canForward]="s.canForward()"
            [areaActive]="s.tool() === 'area'"
            [beforeBack]="saveBeforeLeaving"
            [(gotoOpen)]="gotoOpen"
            (historyBack)="historyBack()"
            (historyForward)="historyForward()"
            (goTo)="goToPage($event)"
          />

          <main
            class="stage"
            (contextmenu)="onContextMenu($event)"
            (pointerdown)="onStagePointerDown($event)"
          >
            @if (s.view() === 'reflow') {
              <iqra-reflow-view
                [renderer]="r"
                [page]="s.page()"
                [zoom]="s.zoom()"
                [rtl]="rtl()"
                [theme]="theme()"
                (pageChange)="s.pageChange($event)"
                (showPage)="showPage()"
                (tap)="toolbar()?.reveal()"
                [annotations]="annotations()"
                [flashId]="s.flash()"
                (annotationTap)="actions.onAnnotationTap($event)"
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
                (areaDrawn)="actions.onAreaDrawn($event)"
                (placeChange)="s.placeChange($event)"
                (tap)="toolbar()?.reveal()"
                (zoomChange)="s.setZoom($event)"
                (annotationTap)="actions.onAnnotationTap($event)"
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
                  (areaDrawn)="actions.onAreaDrawn($event)"
                  (pageChange)="s.pageChange($event)"
                  (tap)="toolbar()?.reveal()"
                  (zoomChange)="s.setZoom($event)"
                  (annotationTap)="actions.onAnnotationTap($event)"
                />
              </div>
            }
          </main>

          <iqra-reader-toolbar
            class="r-tools"
            [view]="s.view()"
            [tool]="s.tool()"
            [bookmarked]="actions.bookmarked()"
            [progressMode]="b.progressMode"
            [pageMarked]="pageMarked()"
            [fullscreen]="fullscreen()"
            [hold]="s.tool() === 'area' || menuAt() !== null"
            [canZoomIn]="zoomIn(s.zoom(), s.view()) !== s.zoom()"
            [canZoomOut]="zoomOut(s.zoom(), s.view()) !== s.zoom()"
            [canUndo]="actions.undoStack.canUndo()"
            [canRedo]="actions.undoStack.canRedo()"
            (action)="onToolbar($event)"
          />

          <div class="overlays">
            <iqra-selection-toolbar
              [selection]="menuAt() ? null : actions.toolbarTarget()"
              (color)="actions.highlight($event)"
              (note)="actions.addNote()"
              (copy)="actions.copySelection()"
              (translate)="actions.translate()"
            />

            <iqra-book-panel-drawer
              [open]="panel() !== null"
              [tab]="panel() ?? 'contents'"
              [book]="b"
              [renderer]="r"
              [page]="s.page()"
              [annotations]="annotations()"
              [marked]="marked()"
              (closed)="panel.set(null)"
              (tabChange)="panel.set($event)"
              (jump)="jump($event)"
              (summary)="actions.editSummary($event)"
              (edit)="actions.editText($event)"
              (note)="actions.noteTarget.set($event)"
              (sideNote)="actions.startSideNote($event)"
              (flash)="s.flashAnnotation($event)"
            />
            <iqra-context-menu
              [at]="menuAt()"
              [model]="menuModel()"
              (pick)="onMenuPick($event)"
              (color)="onMenuColor($event)"
              (closed)="menuAt.set(null)"
            />
            <iqra-shortcut-help [open]="helpOpen()" (closed)="helpOpen.set(false)" />
            <iqra-text-editor-sheet
              [annotation]="actions.textTarget()"
              [draft]="actions.textIsDraft()"
              [isNew]="actions.textTarget()?.id === actions.newSideNoteId()"
              [pageCount]="r.numPages"
              [tagSuggestions]="tagSuggestions()"
              (closed)="actions.closeText($event.empty)"
            />
            <iqra-translate-sheet [target]="actions.translateTarget()" [bookId]="b.id" (closed)="actions.translateTarget.set(null)" />
            <iqra-note-sheet
              [annotation]="actions.noteTarget()"
              [isNew]="actions.noteTarget()?.id === actions.newNoteId()"
              [tagSuggestions]="tagSuggestions()"
              (closed)="actions.noteTarget.set(null)"
            />
            <iqra-reading-settings-sheet
              [open]="settingsOpen()"
              [book]="b"
              [state]="s"
              (closed)="settingsOpen.set(false)"
              (bookChange)="book.set($event)"
              (progressModeChange)="setProgressMode($event)"
            />
          </div>
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
    .btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

    .reader {
      --paper: var(--paper-light); --ink: var(--ink-light);
      --reader-header-h: calc(52px + env(safe-area-inset-top, 0px)); --reader-toolbar-w: 0px;
      position: fixed; inset: 0; display: grid; color: var(--ink);
      grid-template-columns: minmax(0, 1fr); grid-template-rows: var(--reader-header-h) minmax(0, 1fr);
      background: color-mix(in srgb, var(--ink) 7%, var(--paper));
    }
    .reader[data-rt='sepia'] { --paper: var(--paper-sepia); --ink: var(--ink-sepia); }
    .reader[data-rt='night'] { --paper: var(--paper-night); --ink: var(--ink-night); }
    .r-top { grid-column: 1; grid-row: 1; }
    .stage { grid-column: 1; grid-row: 2; position: relative; min-width: 0; min-height: 0; overflow: hidden; }
    /* Sheets, the drawer and the floating toolbars position themselves; they take no grid cell. */
    .overlays { display: contents; }
    .zoomwrap { width: 100%; height: 100%; }
  `,
})
export class ReaderPage implements OnDestroy {
  protected readonly copy = COPY.reader;
  protected readonly annCopy = COPY.annotations;
  protected readonly progressCopy = PROGRESS_COPY;
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
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly annotationService = inject(AnnotationService);
  private readonly repo = inject(Repo);
  private readonly scheduler = inject(SyncScheduler);
  protected readonly selection = inject(SelectionService);
  protected readonly actions = inject(ReaderActions);
  private readonly scroller = viewChild(ScrollerComponent);
  protected readonly toolbar = viewChild(ReaderToolbarComponent);

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
  protected readonly marked = computed(() => this.markSource()?.() ?? new Set<number>());
  /** Whether the current page is marked read (marked mode). */
  protected readonly pageMarked = computed(() => this.marked().has(this.state()?.page() ?? 0));
  private tracking: ReaderSessionHandle | null = null;
  /** The finish prompt is offered once per open. */
  private finishOffered = false;
  private openBookId: string | null = null;
  /** Whether the marks were complete at the last change; unknown until the first read. */
  private markedComplete: boolean | undefined;
  private readonly annotationSource = signal<Signal<Annotation[] | undefined> | null>(null);
  /** This book's live annotations. */
  protected readonly annotations = computed(() => this.annotationSource()?.() ?? []);
  private readonly allAnnotations = this.annotationService.all();
  protected readonly tagSuggestions = computed(() => tagSuggestionsFrom(this.allAnnotations()));
  protected readonly session = signal<ReaderSession | null>(null);
  protected readonly state = signal<ReaderState | null>(null);
  protected readonly panel = signal<PanelTab | null>(null);
  protected readonly settingsOpen = signal(false);
  /** The header's Go to page field. */
  protected readonly gotoOpen = signal(false);
  protected readonly helpOpen = signal(false);
  protected readonly fullscreen = signal(false);
  /** Where the page-actions menu is open, in viewport coordinates. */
  protected readonly menuAt = signal<{ x: number; y: number; keyboard?: boolean } | null>(null);
  protected readonly menuModel = computed(() =>
    contextMenuModel({
      page: this.state()?.page() ?? 1,
      bookmarked: this.actions.bookmarked(),
      pageMarked: this.pageMarked(),
      markedMode: this.book()?.progressMode === 'marked',
      hasSelection: this.selection.pending() !== null && this.actions.pendingArea() === null,
      reflow: this.state()?.view() === 'reflow',
    }),
  );
  /** What the last press on the page area was made with; a touch long-press must leave the native menu and selection alone. */
  private lastPointerType = 'mouse';

  protected readonly theme = computed(() => this.settings.settings().readerTheme);
  protected readonly rtl = computed(() => this.book()?.direction === 'rtl');
  protected readonly chapter = computed(() => {
    const b = this.book();
    const s = this.state();
    return b && s ? chapterTitleAt(b.outline, s.page()) : null;
  });
  protected readonly section = computed(() => {
    const b = this.book();
    const s = this.state();
    return b && s ? sectionTitleAt(b.outline, s.page()) : null;
  });

  private stopListening: () => void = () => undefined;
  private destroyed = false;
  private loadId = 0;

  constructor() {
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
      const b = this.book();
      const set = this.markSource()?.();
      untracked(() => this.checkMarkedComplete(b, set));
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
    this.actions.attach({
      state: this.state,
      book: this.book,
      session: this.session,
      annotations: this.annotations,
      marked: this.marked,
      pageText: (page) => this.session()!.pageText(page),
      pageBox: (page) => this.host.nativeElement.querySelector(`.text-layer[data-page="${page}"]`)?.getBoundingClientRect(),
    });
    void this.load();
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
      this.markedComplete = undefined;
      this.actions.undoStack.clear();
      if (this.openBookId) this.readMarks.release(this.openBookId);
      this.openBookId = book.id;
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

  protected showPage(): void {
    const s = this.state();
    s?.setView('page');
  }

  protected openPanel(which: PanelTab): void {
    this.panel.set(which);
  }

  @HostListener('document:keydown', ['$event'])
  protected onKey(e: KeyboardEvent): void {
    if (!this.state() || isReaderKeyIgnored(e)) return;
    if (e.key === 'Escape' && this.actions.cancelArea()) {
      e.preventDefault();
      return;
    }
    const action = shortcutFor(e);
    if (action && this.run(action)) e.preventDefault();
  }

  /** Runs a shortcut; false when it does nothing here, so the key keeps its browser meaning. */
  private run(action: ShortcutAction): boolean {
    switch (action) {
      case 'bookmark': void this.actions.toggleBookmark(); return true;
      case 'mark': void this.markPage(); return true;
      case 'area': this.actions.toggleArea(); return true;
      case 'mode': this.toggleView(); return true;
      case 'search': this.openPanel('search'); return true;
      case 'contents': this.openPanel('contents'); return true;
      case 'notes': this.openPanel('notes'); return true;
      case 'fullscreen': this.toggleFullscreen(); return true;
      case 'goto': this.gotoOpen.set(true); return true;
      case 'help': this.helpOpen.set(true); return true;
      case 'historyBack': this.historyBack(); return true;
      case 'historyForward': this.historyForward(); return true;
      case 'undo': void this.actions.undo(); return true;
      case 'redo': void this.actions.redo(); return true;
      case 'menu': this.openMenuAtCentre(); return true;
      default: return false;
    }
  }

  protected onToolbar(action: ToolbarAction): void {
    switch (action) {
      case 'contents': this.panel.set(this.panel() === null ? 'contents' : null); break;
      case 'search': this.openPanel('search'); break;
      case 'bookmark': void this.actions.toggleBookmark(); break;
      case 'mark': void this.markPage(); break;
      case 'area': this.actions.toggleArea(); break;
      case 'mode': this.toggleView(); break;
      case 'settings': this.settingsOpen.set(true); break;
      case 'undo': void this.actions.undo(); break;
      case 'redo': void this.actions.redo(); break;
      case 'fullscreen': this.toggleFullscreen(); break;
      case 'zoomIn': this.state()?.setZoom(zoomIn(this.state()!.zoom(), this.state()!.view())); break;
      case 'zoomOut': this.state()?.setZoom(zoomOut(this.state()!.zoom(), this.state()!.view())); break;
    }
  }

  private toggleView(): void {
    const s = this.state();
    s?.setView(s.view() === 'page' ? 'reflow' : 'page');
  }

  protected goToPage(page: number): void {
    this.jump({ page, offset: 0 });
  }

  private toggleFullscreen(): void {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch((err) => console.warn('Could not leave full screen', err));
    } else {
      document.documentElement.requestFullscreen?.().catch((err) => console.warn('Could not enter full screen', err));
    }
  }

  /** Right-click in the page area: cancels a running area tool, otherwise opens the page-actions menu. Elsewhere the native menu stays. */
  protected onContextMenu(e: MouseEvent): void {
    if (!this.state()) return;
    // Touch (long-press) keeps the system's own text selection and menu; the custom menu is for mouse and keyboard.
    if (this.lastPointerType === 'touch' || (e as PointerEvent).pointerType === 'touch') return;
    e.preventDefault();
    if (this.actions.cancelArea()) return;
    this.menuAt.set({ x: e.clientX, y: e.clientY });
  }

  /** Shift+F10 / the Menu key: the menu opens at the middle of the page area. */
  private openMenuAtCentre(): void {
    const box = this.host.nativeElement.querySelector('.stage')?.getBoundingClientRect();
    if (!box) return;
    this.actions.cancelArea();
    this.menuAt.set({ x: box.left + box.width / 2, y: box.top + box.height / 2, keyboard: true });
  }

  protected onStagePointerDown(e: PointerEvent): void {
    this.lastPointerType = e.pointerType || 'mouse';
  }

  protected onMenuPick(id: ContextActionId): void {
    this.menuAt.set(null);
    switch (id) {
      case 'note': void this.actions.addNote(); break;
      case 'copySelection': void this.actions.copySelection(); break;
      case 'translate': void this.actions.translate(); break;
      case 'sideNote': void this.actions.addSideNote(); break;
      case 'bookmark': void this.actions.toggleBookmark(); break;
      case 'mark': void this.markPage(); break;
      case 'area': this.actions.toggleArea(); break;
      case 'summary': this.actions.addRangeSummary(); break;
      case 'goto': this.gotoOpen.set(true); break;
      case 'copyPage': void this.actions.copyPageText(); break;
    }
  }

  protected onMenuColor(color: HighlightColor): void {
    this.menuAt.set(null);
    void this.actions.highlight(color);
  }

  @HostListener('document:fullscreenchange')
  protected onFullscreenChange(): void {
    this.fullscreen.set(document.fullscreenElement !== null);
  }

  /** The Mark page read toggle; outside marked mode it says why it does nothing. */
  private async markPage(): Promise<void> {
    if (this.book()?.progressMode !== 'marked') {
      this.toast.show(CHROME_COPY.markDisabled);
      return;
    }
    await this.actions.toggleMark();
  }

  /** Switches how this book's progress is counted; both the marks and the last page reached are kept. */
  protected async setProgressMode(mode: Book['progressMode']): Promise<void> {
    const b = this.book();
    if (!b || b.progressMode === mode) return;
    try {
      const saved = await this.repo.update<Book>('books', b.id, () => ({ progressMode: mode }));
      if (!saved || this.destroyed) return;
      // The completeness check starts afresh in the new mode, so an old reading cannot raise the finish prompt.
      this.markedComplete = undefined;
      this.book.set(saved);
      this.toast.show(mode === 'marked' ? CHROME_COPY.nowMarked : CHROME_COPY.nowLast);
    } catch (err) {
      console.warn('Could not change the progress mode', err);
      this.toast.show(COPY.annotations.saveFailed);
    }
  }

  /** A press anywhere but the toolbar abandons a drawn area (the toolbar stops its own presses). */
  @HostListener('document:pointerdown')
  protected onPointerDown(): void {
    if (this.actions.pendingArea()) this.actions.pendingArea.set(null);
  }

  /** The header's back arrow writes the reading position before it leaves; so does the browser's Back (below). */
  protected readonly saveBeforeLeaving = async (): Promise<void> => {
    await this.state()?.flush();
  };

  /** The browser's Back or Forward: the position is on its way to the database before the page is torn down. */
  @HostListener('window:popstate')
  protected onPopState(): void {
    void this.state()?.flush();
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

  /**
   * Marked mode: the marks becoming complete (by the Mark read toggle or a Contents check) offers the
   * finish prompt. Only a change seen while open counts, so opening a fully marked book does not prompt.
   */
  private checkMarkedComplete(book: Book | null, marks: ReadonlySet<number> | undefined): void {
    if (!book || book.progressMode !== 'marked' || book.pageCount <= 0 || !marks) return;
    const complete = marks.size >= book.pageCount;
    if (complete && this.markedComplete === false) this.offerFinish();
    this.markedComplete = complete;
  }

  private offerFinish(): void {
    const b = this.book();
    if (!b || b.status === 'finished' || this.finishOffered) return;
    this.finishOffered = true;
    this.toast.show(PROGRESS_COPY.finishPrompt, {
      actionLabel: PROGRESS_COPY.markFinished,
      durationMs: FINISH_TOAST_MS,
      undo: () => void this.markFinished(b.id),
    });
  }

  private async markFinished(bookId: string): Promise<void> {
    try {
      const saved = await this.repo.update<Book>('books', bookId, () => ({ status: 'finished', finishedAt: this.clock.now() }));
      if (!saved) return;
      if (!this.destroyed) this.book.set(saved);
    } catch (err) {
      console.warn('Could not mark the book finished', err);
      this.toast.show(COPY.annotations.saveFailed);
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.stopListening();
    // Position and reading session are written first; leaving the reader then syncs at once.
    const saved = Promise.all([this.tracking?.end(), this.state()?.flush()]);
    this.scheduler.afterReader(saved);
    this.tracking = null;
    if (this.openBookId) this.readMarks.release(this.openBookId);
    this.session()?.destroy();
  }
}
