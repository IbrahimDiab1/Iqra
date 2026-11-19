import { Injectable, Injector, Signal, inject, runInInjectionContext } from '@angular/core';
import { CLOCK } from '../core/clock';
import { DB } from '../core/db';
import { ChangedElsewhereError } from '../core/changed-elsewhere';
import { DEVICE_ID, newId } from '../core/ids';
import type { Annotation, ID, TextAnchor } from '../core/models';
import { Repo } from '../core/repo';
import type { PageSize } from '../reader/pdf-session';
import type { TextItem } from '../reader/text';
import { anchorsOverlap, compareCaret, unionAnchor } from './anchor';

export const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink'] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

export type NewAnnotation = Omit<
  Annotation,
  'id' | 'updatedAt' | 'deviceId' | 'createdAt' | 'tags' | 'deleted'
> & { tags?: string[] };

/** The page's text items and size: what an anchor needs to rebuild its quote and rects. */
export interface PageGeometry {
  items: TextItem[];
  size: PageSize;
}

export interface HighlightResult {
  created: Annotation;
  /** The highlights the new one absorbed, as they were before the merge. */
  mergedAway: Annotation[];
}

type Patch = Partial<Pick<Annotation, 'color' | 'body' | 'tags' | 'type' | 'text' | 'rect' | 'page' | 'scope'>>;

/** Page order (summaries last), then creation time. */
function byPageThenCreated(a: Annotation, b: Annotation): number {
  const pa = a.page ?? Number.POSITIVE_INFINITY;
  const pb = b.page ?? Number.POSITIVE_INFINITY;
  return pa !== pb ? pa - pb : a.createdAt - b.createdAt;
}

/**
 * The only writer of annotations. All writes go through Repo, so they sync and
 * never hard-delete. Deleting is a soft delete; undo is a restore.
 */
@Injectable({ providedIn: 'root' })
export class AnnotationService {
  private readonly repo = inject(Repo);
  private readonly db = inject(DB);
  private readonly clock = inject(CLOCK);
  private readonly deviceId = inject(DEVICE_ID);
  private readonly injector = inject(Injector);
  private readonly byBook = new Map<ID, Signal<Annotation[] | undefined>>();
  private everything?: Signal<Annotation[] | undefined>;

  /** Live, not deleted, one book, sorted by page then createdAt. */
  forBook(bookId: ID): Signal<Annotation[] | undefined> {
    let sig = this.byBook.get(bookId);
    if (!sig) {
      sig = runInInjectionContext(this.injector, () =>
        this.repo.live(async () =>
          (await this.db.annotations.where('bookId').equals(bookId).toArray())
            .filter((a) => !a.deleted)
            .sort(byPageThenCreated),
        ),
      );
      this.byBook.set(bookId, sig);
    }
    return sig;
  }

  /** Live, not deleted, every book. */
  all(): Signal<Annotation[] | undefined> {
    this.everything ??= runInInjectionContext(this.injector, () =>
      this.repo.live(() => this.db.annotations.filter((a) => !a.deleted).toArray()),
    );
    return this.everything;
  }

  create(input: NewAnnotation): Promise<Annotation> {
    return this.insert({ ...input, tags: input.tags ?? [], createdAt: this.clock.now() });
  }

  async update(id: ID, patch: Patch): Promise<Annotation | undefined> {
    // One transaction, so two patches close together cannot overwrite each other's fields.
    return this.db.transaction('rw', this.db.annotations, async () => {
      const existing = await this.db.annotations.get(id);
      if (!existing || existing.deleted) return undefined;
      return this.repo.put<Annotation>('annotations', { ...existing, ...patch });
    });
  }

  /** Soft-deletes the record. Returns it as it was before the delete. */
  async remove(id: ID): Promise<Annotation | undefined> {
    const existing = await this.db.annotations.get(id);
    if (!existing || existing.deleted) return undefined;
    await this.repo.softDelete('annotations', id);
    return existing;
  }

  /** Puts a removed record back. It is re-stamped, so the restore syncs as the newest write. */
  async restore(rec: Annotation): Promise<void> {
    const { deleted: _deleted, ...live } = rec;
    await this.repo.put<Annotation>('annotations', live);
  }

  /**
   * Adds a highlight. Live highlights on the same page whose text overlaps or touches
   * the new range are merged into it: the range is the union, bodies are joined with a
   * blank line, tags are combined, and the earliest createdAt is kept.
   */
  addHighlight(
    bookId: ID,
    anchor: TextAnchor,
    color: HighlightColor,
    geometry: PageGeometry,
  ): Promise<HighlightResult> {
    return this.db.transaction('rw', this.db.annotations, async () => {
      const same = (await this.db.annotations.where('bookId').equals(bookId).toArray()).filter(
        (a) => !a.deleted && a.type === 'highlight' && a.page === anchor.page && !!a.text,
      );
      const touching = same
        .filter((a) => anchorsOverlap(a.text!, anchor))
        .sort((a, b) => compareCaret(a.text!.start, b.text!.start) || a.createdAt - b.createdAt);

      if (touching.length === 0) {
        const created = await this.create({ bookId, type: 'highlight', page: anchor.page, color, text: anchor, tags: [] });
        return { created, mergedAway: [] };
      }

      let merged = anchor;
      for (const a of touching) {
        merged = unionAnchor(merged, a.text!, geometry.items, geometry.size);
      }
      const bodies = touching.map((a) => a.body ?? '').filter((b) => b.trim() !== '');
      const tags = [...new Set(touching.flatMap((a) => a.tags))];
      const createdAt = Math.min(...touching.map((a) => a.createdAt));

      for (const a of touching) await this.remove(a.id);
      const created = await this.insert({
        id: newId(),
        bookId,
        type: 'highlight',
        page: anchor.page,
        color,
        text: merged,
        ...(bodies.length > 0 ? { body: bodies.join('\n\n') } : {}),
        tags,
        createdAt,
      });
      return { created, mergedAway: touching };
    });
  }

  /**
   * Runs `apply` only if every listed row is currently in the state this device left it: last written here, deleted or
   * not as expected. A row another device has changed, deleted or never had makes the whole call throw
   * ChangedElsewhereError and change nothing, so an old undo never overwrites or resurrects a newer remote change.
   */
  private guarded<T>(expect: { id: ID; deleted: boolean }[], apply: () => Promise<T>): Promise<T> {
    return this.db.transaction('rw', this.db.annotations, async () => {
      for (const e of expect) {
        const row = await this.db.annotations.get(e.id);
        if (!row || !!row.deleted !== e.deleted || row.deviceId !== this.deviceId) throw new ChangedElsewhereError();
      }
      return apply();
    });
  }

  /** Undo of a creation (or redo of a delete): removes a live record this device last wrote. */
  async removeIfOurs(id: ID): Promise<void> {
    await this.guarded([{ id, deleted: false }], () => this.remove(id));
  }

  /** Undo of a delete (or redo of a creation): restores a record this device soft-deleted. */
  restoreIfOurs(rec: Annotation): Promise<void> {
    return this.guarded([{ id: rec.id, deleted: true }], () => this.restore(rec));
  }

  /** Undo or redo of a field edit on a live record this device last wrote. */
  async updateIfOurs(id: ID, patch: Patch): Promise<void> {
    await this.guarded([{ id, deleted: false }], () => this.update(id, patch));
  }

  /** Reverses addHighlight: the new record is removed and the absorbed ones are restored (all or nothing, see `guarded`). */
  undoAddHighlight(result: HighlightResult): Promise<void> {
    const expect = [{ id: result.created.id, deleted: false }, ...result.mergedAway.map((r) => ({ id: r.id, deleted: true }))];
    return this.guarded(expect, async () => {
      await this.remove(result.created.id);
      for (const rec of result.mergedAway) await this.restore(rec);
    });
  }

  /** Reapplies an undone addHighlight: the absorbed highlights go away again and the merged one comes back. */
  redoAddHighlight(result: HighlightResult): Promise<void> {
    const expect = [{ id: result.created.id, deleted: true }, ...result.mergedAway.map((r) => ({ id: r.id, deleted: false }))];
    return this.guarded(expect, async () => {
      for (const rec of result.mergedAway) await this.remove(rec.id);
      await this.restore(result.created);
    });
  }

  private insert(rec: Omit<Annotation, 'id' | 'updatedAt' | 'deviceId'> & { id?: ID }): Promise<Annotation> {
    return this.repo.put<Annotation>('annotations', { ...rec, id: rec.id ?? newId() });
  }
}
