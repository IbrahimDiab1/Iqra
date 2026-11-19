import { describe, expect, it, vi } from 'vitest';
import { UndoStack } from '../reader/undo-stack';
import { FieldEdits, removalCommand } from './edit-undo';

function fakeService() {
  const updateIfOurs = vi.fn(async () => undefined);
  const removeIfOurs = vi.fn(async () => undefined);
  const restoreIfOurs = vi.fn(async () => undefined);
  return { updateIfOurs, removeIfOurs, restoreIfOurs } as unknown as { updateIfOurs: typeof updateIfOurs; removeIfOurs: typeof removeIfOurs; restoreIfOurs: typeof restoreIfOurs } & import('./annotation.service').AnnotationService;
}

describe('FieldEdits', () => {
  it('records one command per edit and undo/redo write the before/after patches', async () => {
    const stack = new UndoStack();
    const svc = fakeService();
    const edits = new FieldEdits();
    edits.record(stack, svc, 'a1', 'colour change', { color: 'yellow' }, { color: 'pink' });
    expect(stack.nextUndoLabel()).toBe('colour change');
    await stack.undo();
    expect(svc.updateIfOurs).toHaveBeenLastCalledWith('a1', { color: 'yellow' });
    await stack.redo();
    expect(svc.updateIfOurs).toHaveBeenLastCalledWith('a1', { color: 'pink' });
  });

  it('merges quick successive edits while the command is still the newest', async () => {
    const stack = new UndoStack();
    const svc = fakeService();
    const edits = new FieldEdits();
    edits.record(stack, svc, 'a1', 'edit', { body: '' }, { body: 'he' });
    edits.record(stack, svc, 'a1', 'edit', { body: 'he' }, { body: 'hello' });
    await stack.undo();
    expect(svc.updateIfOurs).toHaveBeenLastCalledWith('a1', { body: '' });
    expect(stack.canUndo()).toBe(false);
    await stack.redo();
    expect(svc.updateIfOurs).toHaveBeenLastCalledWith('a1', { body: 'hello' });
  });

  it('starts a new command once something else was recorded in between', async () => {
    const stack = new UndoStack();
    const svc = fakeService();
    const edits = new FieldEdits();
    edits.record(stack, svc, 'a1', 'edit', { body: '' }, { body: 'one' });
    stack.push({ label: 'other', undo: async () => undefined, redo: async () => undefined });
    edits.record(stack, svc, 'a1', 'edit', { body: 'one' }, { body: 'two' });
    const labels: string[] = [];
    for (let c = await stack.undo(); c; c = await stack.undo()) labels.push(c.label);
    expect(labels).toEqual(['edit', 'other', 'edit']);
  });

  it('does nothing without a stack (outside the reader)', () => {
    const svc = fakeService();
    expect(() => new FieldEdits().record(null, svc, 'a1', 'edit', { body: '' }, { body: 'x' })).not.toThrow();
  });
});

describe('removalCommand', () => {
  it('undo restores the record and redo removes it again', async () => {
    const svc = fakeService();
    const rec = { id: 'a1' } as never;
    const cmd = removalCommand(svc, rec);
    await cmd.undo();
    expect(svc.restoreIfOurs).toHaveBeenCalledWith(rec);
    await cmd.redo();
    expect(svc.removeIfOurs).toHaveBeenCalledWith('a1');
    expect(cmd.subject).toBe('a1');
  });
});
