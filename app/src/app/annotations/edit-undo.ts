import type { Annotation } from '../core/models';
import { CHROME_COPY } from '../reader/chrome-copy';
import type { UndoCommand, UndoStack } from '../reader/undo-stack';
import type { AnnotationService } from './annotation.service';

type Patch = Parameters<AnnotationService['update']>[1];

/**
 * Records edits to one annotation's fields on the reader's undo stack (when there is one). Edits that follow each other
 * with nothing else recorded in between, such as the pauses of one typing session, merge into a single command.
 */
export class FieldEdits {
  private current: { cmd: UndoCommand; before: Patch; after: Patch } | undefined;

  record(stack: UndoStack | null, service: AnnotationService, id: string, label: string, before: Patch, after: Patch): void {
    if (!stack) return;
    const cur = this.current;
    if (cur && stack.top() === cur.cmd) {
      cur.after = after;
      return;
    }
    const state = { cmd: undefined as unknown as UndoCommand, before, after };
    state.cmd = {
      label,
      subject: id,
      undo: async () => void (await service.update(id, state.before)),
      redo: async () => void (await service.update(id, state.after)),
    };
    this.current = state;
    stack.push(state.cmd);
  }
}

/** The command for a record that was just soft-deleted: undo restores it, redo deletes it again. */
export function removalCommand(service: AnnotationService, rec: Annotation): UndoCommand {
  return {
    label: CHROME_COPY.actions.delete,
    subject: rec.id,
    undo: () => service.restore(rec),
    redo: async () => void (await service.remove(rec.id)),
  };
}
