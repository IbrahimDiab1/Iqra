import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { buildAnchor } from '../annotations/anchor';
import { AnnotationService, type HighlightColor } from '../annotations/annotation.service';
import { findSummary } from '../annotations/summary-scope';
import { newId } from '../core/ids';
import type { Annotation, Book, Rect, SummaryScope } from '../core/models';
import { ReadMarkService } from '../progress/read-mark.service';
import { contextSentence } from '../review/review-logic';
import { COPY } from '../ui/copy';
import { ToastService } from '../ui/toast.service';
import { CHROME_COPY } from './chrome-copy';
import type { ReaderSession } from './reader.page';
import type { ReaderState } from './reader.state';
import { SelectionService, type PendingSelection } from './selection.service';
import type { PendingArea } from './selection-toolbar.component';
import { UndoStack, recordCommand, type UndoCommand } from './undo-stack';

/** What the actions read from the reader page. */
export interface ReaderActionsContext {
  state: Signal<ReaderState | null>;
  book: Signal<Book | null>;
  session: Signal<ReaderSession | null>;
  annotations: Signal<Annotation[]>;
  /** The pages marked read (marked mode). */
  marked: Signal<ReadonlySet<number>>;
  /** The page's text, for Copy page text. */
  pageText(page: number): Promise<string>;
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
  private readonly readMarks = inject(ReadMarkService);
  readonly undoStack = inject(UndoStack);

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
  /** The selection the Translate sheet shows; null keeps it closed. */
  readonly translateTarget = signal<{ text: string; page: number; context: string } | null>(null);
  readonly toolbarTarget = computed(() => this.pendingArea() ?? this.selection.pending());

  /**
   * What this page itself just added or removed, which the live query may not show yet. Each entry is only trusted while
   * the live list is still the one that was current when the entry was made; once the query has caught up (or moved on,
   * e.g. a removal in the Bookmarks tab or from another device) the live data alone decides.
   */
  private readonly optimistic = signal<{ added: ReadonlyMap<number, { id: string; at: unknown }>; removed: ReadonlyMap<string, unknown> }>({ added: new Map(), removed: new Map() });
  private bookmarkQueue: Promise<void> = Promise.resolve();

  /** The id of the live bookmark on the current page, if any. */
  readonly bookmarkId = computed(() => {
    const page = this.ctx.state()?.page();
    const { added, removed } = this.optimistic();
    const list = this.ctx.annotations();
    const live = list.find((a) => a.type === 'bookmark' && a.page === page && removed.get(a.id) !== list);
    if (live) return live.id;
    const pending = page === undefined ? undefined : added.get(page);
    return pending && pending.at === list ? pending.id : undefined;
  });
  readonly bookmarked = computed(() => this.bookmarkId() !== undefined);

  constructor() {
    // An undo or redo whose record changed on another device is skipped and dropped, and the owner is told why.
    this.undoStack.onConflict = () => this.toast.show(CHROME_COPY.changedElsewhere);
  }

  attach(ctx: ReaderActionsContext): void {
    this.ctx = ctx;
  }

  /** A tap on a highlight opens its note sheet. */
  onAnnotationTap(a: Annotation): void {
    this.noteTarget.set(a);
  }

  /** Adds or removes the bookmark on the current page. Presses are served one after the other, so a double press is add then remove. */
  toggleBookmark(): Promise<void> {
    this.bookmarkQueue = this.bookmarkQueue.then(() => this.doToggleBookmark());
    return this.bookmarkQueue;
  }

  private markBookmark(page: number, id: string, present: boolean): void {
    const at = this.ctx.annotations();
    this.optimistic.update(({ added, removed }) => {
      const a = new Map(added);
      const r = new Map(removed);
      if (present) {
        a.set(page, { id, at });
        r.delete(id);
      } else {
        if (a.get(page)?.id === id) a.delete(page);
        r.set(id, at);
      }
      return { added: a, removed: r };
    });
  }

  private async doToggleBookmark(): Promise<void> {
    const s = this.ctx.state();
    const book = this.ctx.book();
    if (!s || !book) return;
    const page = s.page();
    const existingId = this.bookmarkId();
    try {
      if (existingId) {
        this.markBookmark(page, existingId, false);
        const rec = await this.annotationService.remove(existingId);
        if (rec) {
          const cmd: UndoCommand = {
            label: CHROME_COPY.actions.removeBookmark,
            subject: rec.id,
            undo: async () => {
              await this.annotationService.restoreIfOurs(rec);
              this.markBookmark(page, rec.id, true);
            },
            redo: async () => {
              await this.annotationService.removeIfOurs(rec.id);
              this.markBookmark(page, rec.id, false);
            },
          };
          this.toast.show(COPY.annotations.deleted, { undo: recordCommand(this.undoStack, cmd) });
        }
      } else {
        const created = await this.annotationService.create({ bookId: book.id, type: 'bookmark', page });
        this.markBookmark(page, created.id, true);
        const cmd: UndoCommand = {
          label: CHROME_COPY.actions.addBookmark,
          subject: created.id,
          undo: async () => {
            await this.annotationService.removeIfOurs(created.id);
            this.markBookmark(page, created.id, false);
          },
          redo: async () => {
            await this.annotationService.restoreIfOurs(created);
            this.markBookmark(page, created.id, true);
          },
        };
        this.undoStack.push(cmd);
        this.toast.show(COPY.annotations.bookmarkAdded);
      }
    } catch (err) {
      console.warn('Could not change the bookmark', err);
      this.toast.show(COPY.annotations.saveFailed);
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
    this.undoStack.push(this.creation(a, CHROME_COPY.actions.sideNote));
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
      this.undoStack.discardSubject(target.id);
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
  }

  /** Esc or a right-click while drawing: turns the tool off and drops a drawn area. False when there was nothing to cancel. */
  cancelArea(): boolean {
    const s = this.ctx.state();
    if (!s || (s.tool() === 'none' && !this.pendingArea())) return false;
    s.tool.set('none');
    this.pendingArea.set(null);
    return true;
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
      const cmd = this.creation(created, CHROME_COPY.actions.area);
      if (openNote) {
        this.undoStack.push(cmd);
        this.noteTarget.set(created);
      } else {
        this.toast.show(COPY.annotations.highlightSaved, { undo: recordCommand(this.undoStack, cmd) });
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
      const cmd: UndoCommand = {
        label: CHROME_COPY.actions.highlight,
        subject: result.created.id,
        undo: () => this.annotationService.undoAddHighlight(result),
        redo: () => this.annotationService.redoAddHighlight(result),
      };
      this.toast.show(COPY.annotations.highlightSaved, { undo: recordCommand(this.undoStack, cmd) });
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
      this.undoStack.push(this.creation(note, CHROME_COPY.actions.note));
      this.newNoteId.set(note.id);
      this.noteTarget.set(note);
    } catch (err) {
      console.warn('Could not save the note', err);
      this.toast.show(COPY.annotations.saveFailed);
    }
  }

  /** Opens the Translate sheet for the selection; the sentence it sits in is filled in once the page text is read. */
  async translate(): Promise<void> {
    const sel = this.selection.pending();
    if (!sel) return;
    const target = { text: sel.quote, page: sel.page, context: '' };
    this.translateTarget.set(target);
    try {
      const context = contextSentence(await this.ctx.pageText(sel.page), sel.quote);
      if (context !== '' && this.translateTarget() === target) this.translateTarget.set({ ...target, context });
    } catch {
      // No context sentence: the item is still saved.
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

  /** The command for a record that was just created: undo removes it, redo puts it back as it was created. */
  private creation(rec: Annotation, label: string): UndoCommand {
    return {
      label,
      subject: rec.id,
      undo: () => this.annotationService.removeIfOurs(rec.id),
      redo: () => this.annotationService.restoreIfOurs(rec),
    };
  }

  /** The Mark page read toggle for the current page. */
  async toggleMark(): Promise<void> {
    const s = this.ctx.state();
    const b = this.ctx.book();
    if (!s || !b) return;
    const page = s.page();
    const was = this.ctx.marked().has(page);
    try {
      await this.readMarks.toggle(b.id, page);
      this.undoStack.push({
        label: CHROME_COPY.actions.markRead,
        undo: () => this.readMarks.setRange(b.id, page, page, was),
        redo: () => this.readMarks.setRange(b.id, page, page, !was),
      });
    } catch (err) {
      console.warn('Could not change the read mark', err);
      this.toast.show(COPY.annotations.saveFailed);
    }
  }

  /** Opens the editor for a new side note on this page (the Notes tab's own button does the same from the drawer). */
  async addSideNote(): Promise<void> {
    const s = this.ctx.state();
    const book = this.ctx.book();
    if (!s || !book) return;
    try {
      const rec = await this.annotationService.create({ bookId: book.id, type: 'side-note', page: s.page() });
      this.startSideNote(rec);
    } catch (err) {
      console.warn('Could not add the side note', err);
      this.toast.show(COPY.annotations.saveFailed);
    }
  }

  addRangeSummary(): void {
    const page = this.ctx.state()?.page();
    if (page !== undefined) this.editSummary({ kind: 'pages', fromPage: page, toPage: page });
  }

  async copyPageText(): Promise<void> {
    const page = this.ctx.state()?.page();
    if (page === undefined) return;
    try {
      const text = (await this.ctx.pageText(page)).trim();
      if (text === '') {
        this.toast.show(CHROME_COPY.noPageText);
        return;
      }
      await navigator.clipboard.writeText(text);
      this.toast.show(CHROME_COPY.pageTextCopied);
    } catch (err) {
      console.warn('Could not copy the page text', err);
      this.toast.show(COPY.annotations.copyFailed);
    }
  }

  /** Undo (toolbar, Ctrl+Z): reverses the newest action and says so, with a Redo button. */
  async undo(): Promise<void> {
    try {
      const cmd = await this.undoStack.undo();
      if (cmd) this.toast.show(CHROME_COPY.undid(cmd.label), { actionLabel: CHROME_COPY.redo, undo: () => void this.redo() });
    } catch (err) {
      console.warn('Could not undo', err);
      this.toast.show(COPY.annotations.saveFailed);
    }
  }

  async redo(): Promise<void> {
    try {
      const cmd = await this.undoStack.redo();
      if (cmd) this.toast.show(CHROME_COPY.redid(cmd.label), { actionLabel: CHROME_COPY.undo, undo: () => void this.undo() });
    } catch (err) {
      console.warn('Could not redo', err);
      this.toast.show(COPY.annotations.saveFailed);
    }
  }
}
