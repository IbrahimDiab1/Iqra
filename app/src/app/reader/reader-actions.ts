import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { buildAnchor } from '../annotations/anchor';
import { AnnotationService, type HighlightColor } from '../annotations/annotation.service';
import { findSummary } from '../annotations/summary-scope';
import { newId } from '../core/ids';
import type { Annotation, Book, Rect, SummaryScope } from '../core/models';
import { COPY } from '../ui/copy';
import { ToastService } from '../ui/toast.service';
import type { ReaderSession } from './reader.page';
import type { ReaderState } from './reader.state';
import { SelectionService, type PendingSelection } from './selection.service';
import type { PendingArea } from './selection-toolbar.component';

const AREA_HINT_MS = 4000;

/** What the actions read from the reader page. */
export interface ReaderActionsContext {
  state: Signal<ReaderState | null>;
  book: Signal<Book | null>;
  session: Signal<ReaderSession | null>;
  annotations: Signal<Annotation[]>;
  /** The on-screen box of a page's text layer, for placing the toolbar over a drawn area. */
  pageBox(page: number): DOMRect | undefined;
}

/**
 * The reader's annotation, bookmark, area-tool and selection handlers, one instance per open reader.
 * The page attaches its signals once; the template and the keyboard call the methods here.
 */
@Injectable()
export class ReaderActions {
  private readonly annotationService = inject(AnnotationService);
  private readonly toast = inject(ToastService);
  private readonly selection = inject(SelectionService);

  private ctx!: ReaderActionsContext;

  /** The annotation the note sheet edits: a tapped highlight, or a freshly created note. */
  readonly noteTarget = signal<Annotation | null>(null);
  /** The note created by the Note action in this open session; only it is removed if closed empty. */
  readonly newNoteId = signal<string | null>(null);
  /** The side note or summary the text editor sheet edits. */
  readonly textTarget = signal<Annotation | null>(null);
  readonly textIsDraft = signal(false);
  /** The side note the panel just created in this open session; closed empty, it is removed. */
  readonly newSideNoteId = signal<string | null>(null);
  /** A rectangle just drawn with the area tool, waiting for a color or a note. */
  readonly pendingArea = signal<PendingArea | null>(null);
  readonly toolbarTarget = computed(() => this.pendingArea() ?? this.selection.pending());

  /** The live bookmark on the current page, if any. */
  readonly bookmark = computed(() => {
    const page = this.ctx.state()?.page();
    return this.ctx.annotations().find((a) => a.type === 'bookmark' && a.page === page);
  });

  private bookmarkBusy = false;
  private readonly addedBookmarks = new Map<number, string>();
  private readonly removedBookmarks = new Set<string>();

  attach(ctx: ReaderActionsContext): void {
    this.ctx = ctx;
  }

  /** A tap on a highlight opens its note sheet. */
  onAnnotationTap(a: Annotation): void {
    this.noteTarget.set(a);
  }

  async toggleBookmark(): Promise<void> {
    const s = this.ctx.state();
    const book = this.ctx.book();
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
  editSummary(scope: SummaryScope): void {
    const book = this.ctx.book();
    if (!book) return;
    const existing = findSummary(this.ctx.annotations(), scope);
    this.textIsDraft.set(!existing);
    this.textTarget.set(
      existing ?? { id: newId(), bookId: book.id, deviceId: '', updatedAt: 0, type: 'summary', scope, tags: [], createdAt: 0 },
    );
  }

  editText(a: Annotation): void {
    this.textIsDraft.set(false);
    this.textTarget.set(a);
  }

  startSideNote(a: Annotation): void {
    this.newSideNoteId.set(a.id);
    this.editText(a);
  }

  /** Closing the text editor drops a side note made just now and left empty. */
  closeText(empty: boolean): void {
    const target = this.textTarget();
    this.textTarget.set(null);
    if (!target || target.id !== this.newSideNoteId()) return;
    this.newSideNoteId.set(null);
    if (empty) {
      void this.annotationService.remove(target.id).catch((err) => console.warn('Could not drop the empty side note', err));
    }
  }

  toggleArea(): void {
    const s = this.ctx.state();
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
  onAreaDrawn(e: { page: number; rect: Rect }): void {
    this.ctx.state()?.tool.set('none');
    const box = this.ctx.pageBox(e.page);
    const left = (box?.left ?? 0) + e.rect.x * (box?.width ?? 0);
    const top = (box?.top ?? 0) + e.rect.y * (box?.height ?? 0);
    const width = e.rect.w * (box?.width ?? 0);
    const height = e.rect.h * (box?.height ?? 0);
    const anchor = { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
    this.pendingArea.set({ kind: 'area', page: e.page, rect: e.rect, anchor });
  }

  private async saveArea(area: PendingArea, color: HighlightColor, openNote: boolean): Promise<void> {
    const book = this.ctx.book();
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
    const session = this.ctx.session()!;
    const [items, size] = await Promise.all([session.textItems(sel.page), session.pageSize(sel.page)]);
    return { anchor: buildAnchor(items, sel.page, sel.start, sel.end, size), geometry: { items, size } };
  }

  async highlight(color: HighlightColor): Promise<void> {
    const area = this.pendingArea();
    if (area) return this.saveArea(area, color, false);
    const sel = this.selection.pending();
    const book = this.ctx.book();
    if (!sel || !book || !this.ctx.session()) return;
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

  async addNote(): Promise<void> {
    const area = this.pendingArea();
    if (area) return this.saveArea(area, 'yellow', true);
    const sel = this.selection.pending();
    const book = this.ctx.book();
    if (!sel || !book || !this.ctx.session()) return;
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

  async copySelection(): Promise<void> {
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
}

