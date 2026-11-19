import { Injectable, computed, signal } from '@angular/core';

/** A reversible action. Both directions are async because they write to the database. */
export interface UndoCommand {
  /** What the action did, for `Undid <label>`. */
  label: string;
  /** The id of the record it is about, so `discardSubject` can drop it when that record is thrown away. */
  subject?: string;
  undo(): Promise<void>;
  redo(): Promise<void>;
}

export const MAX_UNDO = 100;

/**
 * The reader session's undo and redo history. One instance per open book (provided by the reader page), so leaving the
 * book drops it. Operations run one at a time: a second press while one is running waits and then finds the next command.
 */
@Injectable()
export class UndoStack {
  private readonly undos = signal<UndoCommand[]>([]);
  private readonly redos = signal<UndoCommand[]>([]);
  private queue: Promise<unknown> = Promise.resolve();

  readonly canUndo = computed(() => this.undos().length > 0);
  readonly canRedo = computed(() => this.redos().length > 0);
  readonly nextUndoLabel = computed(() => this.undos().at(-1)?.label ?? null);
  readonly nextRedoLabel = computed(() => this.redos().at(-1)?.label ?? null);

  /** Records an action that has just happened. Whatever could have been redone is forgotten. */
  push(cmd: UndoCommand): void {
    this.undos.update((list) => [...list, cmd].slice(-MAX_UNDO));
    this.redos.set([]);
  }

  /** The newest command that can be undone. */
  top(): UndoCommand | undefined {
    return this.undos().at(-1);
  }

  /** Reverses the newest command; null when there is nothing to undo. A failing command stays on the stack and the error is thrown. */
  undo(): Promise<UndoCommand | null> {
    return this.enqueue(async () => {
      const cmd = this.undos().at(-1);
      if (!cmd) return null;
      await cmd.undo();
      this.undos.update((list) => list.filter((c) => c !== cmd));
      this.redos.update((list) => [...list, cmd]);
      return cmd;
    });
  }

  redo(): Promise<UndoCommand | null> {
    return this.enqueue(async () => {
      const cmd = this.redos().at(-1);
      if (!cmd) return null;
      await cmd.redo();
      this.redos.update((list) => list.filter((c) => c !== cmd));
      this.undos.update((list) => [...list, cmd].slice(-MAX_UNDO));
      return cmd;
    });
  }

  /**
   * Undoes one specific command, for a toast's Undo button. False when it is no longer on the stack (an Undo or Ctrl+Z
   * got there first), so the same action is never reversed twice.
   */
  undoCommand(cmd: UndoCommand): Promise<boolean> {
    return this.enqueue(async () => {
      if (!this.undos().includes(cmd)) return false;
      await cmd.undo();
      this.undos.update((list) => list.filter((c) => c !== cmd));
      this.redos.update((list) => [...list, cmd]);
      return true;
    });
  }

  /** Drops every command about one record: a note or side note that was closed empty is gone, so its history is too. */
  discardSubject(id: string): void {
    this.undos.update((list) => list.filter((c) => c.subject !== id));
    this.redos.update((list) => list.filter((c) => c.subject !== id));
  }

  clear(): void {
    this.undos.set([]);
    this.redos.set([]);
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job, job);
    this.queue = run.catch(() => undefined);
    return run;
  }
}

/**
 * Records `cmd` on the reader's stack and returns the callback for a toast's Undo button, which goes through the stack so
 * the action is never reversed twice. Outside a reader (no stack) it just undoes the command.
 */
export function recordCommand(stack: UndoStack | null, cmd: UndoCommand): () => void {
  stack?.push(cmd);
  return () => {
    const run = stack ? stack.undoCommand(cmd) : cmd.undo();
    run.catch((err) => console.warn('Could not undo', err));
  };
}
