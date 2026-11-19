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
import { PROGRESS_COPY } from './progress-copy';
import { CHROME_COPY } from './chrome-copy';
import { icon, type IconName } from '../ui/icons';
import { ToastService } from '../ui/toast.service';
import type { Place } from './jump-history';
import { isReaderKeyIgnored } from './keys';
import { chapterTitleAt, sectionTitleAt } from './outline';
import { BookPanelDrawerComponent, type PanelTab } from './book-panel.drawer';
import { PagerComponent } from './pager.component';
import { PdfSession, ReaderOpenError, type PageRenderer, type PdfSource } from './pdf-session';
import { PositionService } from './position.service';
import { ReaderState } from './reader.state';
import { SessionService, type ReaderSessionHandle } from './session.service';
import { ReadingSettingsSheetComponent } from './reading-settings.sheet';
import { ReaderHeaderComponent } from './reader-header.component';
import { ReaderToolbarComponent, type ToolbarAction } from './reader-toolbar.component';
import { ShortcutHelpComponent } from './shortcut-help.component';
import { shortcutFor, type ShortcutAction } from './shortcuts';
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
  imports: [RouterLink, ReaderHeaderComponent, ReaderToolbarComponent, ShortcutHelpComponent, BookPanelDrawerComponent, ReadingSettingsSheetComponent, PagerComponent, ScrollerComponent, ReflowViewComponent, ZoomGesturesDirective, SelectionToolbarComponent, NoteSheetComponent, TextEditorSheet],
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
            [(gotoOpen)]="gotoOpen"
            (historyBack)="historyBack()"
            (historyForward)="historyForward()"
            (goTo)="goToPage($event)"
          />

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
                />
              </div>
            }
          </main>

          <iqra-reader-toolbar
            class="r-tools"
            [view]="s.view()"
            [tool]="s.tool()"
            [bookmarked]="!!bookmark()"
            [progressMode]="b.progressMode"
            [pageMarked]="pageMarked()"
            [fullscreen]="fullscreen()"
            [noteCount]="pageNoteCount()"
            (action)="onToolbar($event)"
            (progressModeChange)="setProgressMode($event)"
          />

          <div class="overlays">
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
              (summary)="editSummary($event)"
              (edit)="editText($event)"
              (note)="noteTarget.set($event)"
              (sideNote)="startSideNote($event)"
              (flash)="s.flashAnnotation($event)"
            />
            <iqra-shortcut-help [open]="helpOpen()" (closed)="helpOpen.set(false)" />
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
    .btn:focus-visible, .ib:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

    .reader {
      --paper: var(--paper-light); --ink: var(--ink-light);
      --reader-header-h: calc(52px + env(safe-area-inset-top, 0px)); --reader-toolbar-w: 52px;
      position: fixed; inset: 0; display: grid; color: var(--ink);
      grid-template-columns: minmax(0, 1fr) var(--reader-toolbar-w); grid-template-rows: var(--reader-header-h) minmax(0, 1fr);
      background: color-mix(in srgb, var(--ink) 7%, var(--paper));
    }
    .reader[data-rt='sepia'] { --paper: var(--paper-sepia); --ink: var(--ink-sepia); }
    .reader[data-rt='night'] { --paper: var(--paper-night); --ink: var(--ink-night); }
    .r-top { grid-column: 1 / -1; grid-row: 1; }
    .stage { grid-column: 1; grid-row: 2; position: relative; min-width: 0; min-height: 0; overflow: hidden; }
    .r-tools { grid-column: 2; grid-row: 2; min-height: 0; }
    /* Sheets, the drawer and the floating toolbars position themselves; they take no grid cell. */
    .overlays { display: contents; }
    .zoomwrap { width: 100%; height: 100%; }
    .ib { display: inline-grid; place-items: center; width: 40px; height: 40px; flex: none; padding: 0; border: 0; border-radius: var(--radius-control); background: none; color: inherit; cursor: pointer; }
    .ib:hover:not(:disabled) { background: color-mix(in srgb, var(--ink) 8%, transparent); }
    .zoompair { display: none; }
    @media (min-width: 900px) {
      .zoompair { position: absolute; right: calc(var(--reader-toolbar-w) + 16px); bottom: 24px; z-index: 5; display: grid; gap: 6px; background: color-mix(in srgb, var(--paper) 94%, transparent); border-radius: var(--radius-control); box-shadow: var(--shadow); }
    }
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
  private readonly sanitizer = inject(DomSanitizer);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly annotationService = inject(AnnotationService);
  private readonly repo = inject(Repo);
  protected readonly selection = inject(SelectionService);
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
  protected readonly panel = signal<PanelTab | null>(null);
  protected readonly settingsOpen = signal(false);
  /** The header's Go to page field. */
  protected readonly gotoOpen = signal(false);
  protected readonly helpOpen = signal(false);
  protected readonly fullscreen = signal(false);

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

  @HostListener('document:keydown', ['$event'])
  protected onKey(e: KeyboardEvent): void {
    if (!this.state() || isReaderKeyIgnored(e)) return;
    if (e.key === 'Escape' && (this.state()!.tool() !== 'none' || this.pendingArea())) {
      this.state()!.tool.set('none');
      this.pendingArea.set(null);
      e.preventDefault();
      return;
    }
    const action = shortcutFor(e);
    if (action && this.run(action)) e.preventDefault();
  }

  /** Runs a shortcut; false when it does nothing here, so the key keeps its browser meaning. */
  private run(action: ShortcutAction): boolean {
    switch (action) {
      case 'bookmark': void this.toggleBookmark(); return true;
      case 'mark': void this.markPage(); return true;
      case 'area': this.toggleArea(); return true;
      case 'mode': this.toggleView(); return true;
      case 'search': this.openPanel('search'); return true;
      case 'contents': this.openPanel('contents'); return true;
      case 'notes': this.openPanel('notes'); return true;
      case 'fullscreen': this.toggleFullscreen(); return true;
      case 'goto': this.gotoOpen.set(true); return true;
      case 'help': this.helpOpen.set(true); return true;
      case 'historyBack': this.historyBack(); return true;
      case 'historyForward': this.historyForward(); return true;
      // Undo and redo arrive with the undo stack; until then the keys keep their browser meaning.
      default: return false;
    }
  }

  protected onToolbar(action: ToolbarAction): void {
    switch (action) {
      case 'contents': this.panel.set(this.panel() === null ? 'contents' : null); break;
      case 'search': this.openPanel('search'); break;
      case 'bookmark': void this.toggleBookmark(); break;
      case 'mark': void this.markPage(); break;
      case 'area': this.toggleArea(); break;
      case 'mode': this.toggleView(); break;
      case 'settings': this.settingsOpen.set(true); break;
      case 'fullscreen': this.toggleFullscreen(); break;
      default: break;
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
    await this.toggleMark();
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

  private async toggleMark(): Promise<void> {
    const s = this.state();
    const b = this.book();
    if (!s || !b) return;
    const page = s.page();
    try {
      await this.readMarks.toggle(b.id, page);
    } catch (err) {
      console.warn('Could not change the read mark', err);
      this.toast.show(COPY.annotations.saveFailed);
    }
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
    void this.tracking?.end();
    this.tracking = null;
    if (this.openBookId) this.readMarks.release(this.openBookId);
    void this.state()?.flush();
    this.session()?.destroy();
  }
}
