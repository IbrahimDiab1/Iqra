import { describe, expect, it, vi } from 'vitest';
import { ChangedElsewhereError } from '../core/changed-elsewhere';
import { MAX_UNDO, UndoStack, type UndoCommand } from './undo-stack';

function cmd(label: string, log: string[] = []): UndoCommand {
  return {
    label,
    undo: async () => void log.push(`undo ${label}`),
    redo: async () => void log.push(`redo ${label}`),
  };
}

describe('UndoStack', () => {
  it('starts empty: nothing to undo or redo', async () => {
    const s = new UndoStack();
    expect(s.canUndo()).toBe(false);
    expect(s.canRedo()).toBe(false);
    expect(await s.undo()).toBeNull();
    expect(await s.redo()).toBeNull();
  });

  it('undoes the newest command first and redoes it again', async () => {
    const log: string[] = [];
    const s = new UndoStack();
    s.push(cmd('a', log));
    s.push(cmd('b', log));
    expect((await s.undo())?.label).toBe('b');
    expect((await s.undo())?.label).toBe('a');
    expect(s.canUndo()).toBe(false);
    expect(s.canRedo()).toBe(true);
    expect((await s.redo())?.label).toBe('a');
    expect((await s.redo())?.label).toBe('b');
    expect(log).toEqual(['undo b', 'undo a', 'redo a', 'redo b']);
    expect(s.canRedo()).toBe(false);
    expect(s.canUndo()).toBe(true);
  });

  it('a new push clears what could be redone', async () => {
    const s = new UndoStack();
    s.push(cmd('a'));
    await s.undo();
    expect(s.canRedo()).toBe(true);
    s.push(cmd('b'));
    expect(s.canRedo()).toBe(false);
  });

  it('keeps at most 100 commands, dropping the oldest', async () => {
    const s = new UndoStack();
    for (let i = 0; i < MAX_UNDO + 5; i++) s.push(cmd(`c${i}`));
    let n = 0;
    let last = '';
    for (let c = await s.undo(); c; c = await s.undo()) {
      n++;
      last = c.label;
    }
    expect(n).toBe(MAX_UNDO);
    expect(last).toBe('c5');
  });

  it('clear forgets both directions', async () => {
    const s = new UndoStack();
    s.push(cmd('a'));
    s.push(cmd('b'));
    await s.undo();
    s.clear();
    expect(s.canUndo()).toBe(false);
    expect(s.canRedo()).toBe(false);
  });

  it('a command that fails stays where it was and the error reaches the caller', async () => {
    const s = new UndoStack();
    const bad: UndoCommand = { label: 'bad', undo: vi.fn().mockRejectedValue(new Error('db')), redo: async () => undefined };
    s.push(bad);
    await expect(s.undo()).rejects.toThrow('db');
    expect(s.canUndo()).toBe(true);
    expect(s.canRedo()).toBe(false);
  });

  it('runs two quick undos one after the other, never the same command twice', async () => {
    const log: string[] = [];
    const s = new UndoStack();
    s.push({
      label: 'slow',
      undo: () => new Promise<void>((r) => setTimeout(() => (log.push('undo slow'), r()), 10)),
      redo: async () => undefined,
    });
    const [a, b] = await Promise.all([s.undo(), s.undo()]);
    expect(a?.label).toBe('slow');
    expect(b).toBeNull();
    expect(log).toEqual(['undo slow']);
  });

  describe('undoCommand (the toast Undo)', () => {
    it('undoes that command once; a second press, or Ctrl+Z after it, does nothing more', async () => {
      const log: string[] = [];
      const s = new UndoStack();
      const a = cmd('a', log);
      s.push(a);
      expect(await s.undoCommand(a)).toBe(true);
      expect(await s.undoCommand(a)).toBe(false);
      expect(await s.undo()).toBeNull();
      expect(log).toEqual(['undo a']);
    });

    it('does nothing when Ctrl+Z already undid it', async () => {
      const log: string[] = [];
      const s = new UndoStack();
      const a = cmd('a', log);
      s.push(a);
      await s.undo();
      expect(await s.undoCommand(a)).toBe(false);
      expect(log).toEqual(['undo a']);
    });

    it('can undo an older command out of order and leaves the newer ones in place', async () => {
      const log: string[] = [];
      const s = new UndoStack();
      const a = cmd('a', log);
      const b = cmd('b', log);
      s.push(a);
      s.push(b);
      expect(await s.undoCommand(a)).toBe(true);
      expect((await s.undo())?.label).toBe('b');
      expect(log).toEqual(['undo a', 'undo b']);
    });

    it('a failed undo leaves the command on the stack', async () => {
      const s = new UndoStack();
      const bad: UndoCommand = { label: 'bad', undo: vi.fn().mockRejectedValue(new Error('db')), redo: async () => undefined };
      s.push(bad);
      await expect(s.undoCommand(bad)).rejects.toThrow('db');
      expect(s.canUndo()).toBe(true);
    });
  });

  it('top is the newest command that can be undone', async () => {
    const s = new UndoStack();
    expect(s.top()).toBeUndefined();
    const a = cmd('a');
    const b = cmd('b');
    s.push(a);
    s.push(b);
    expect(s.top()).toBe(b);
    await s.undo();
    expect(s.top()).toBe(a);
  });

  it('exposes the label of what Undo and Redo would do', async () => {
    const s = new UndoStack();
    s.push(cmd('a'));
    expect(s.nextUndoLabel()).toBe('a');
    expect(s.nextRedoLabel()).toBeNull();
    await s.undo();
    expect(s.nextUndoLabel()).toBeNull();
    expect(s.nextRedoLabel()).toBe('a');
  });

  describe('discardSubject', () => {
    it('forgets every command about one record, in both directions, and keeps the rest', async () => {
      const s = new UndoStack();
      s.push({ ...cmd('add note'), subject: 'n1' });
      s.push(cmd('other'));
      s.push({ ...cmd('edit note'), subject: 'n1' });
      await s.undo();
      s.discardSubject('n1');
      expect(s.canRedo()).toBe(false);
      expect(s.nextUndoLabel()).toBe('other');
      await s.undo();
      expect(s.canUndo()).toBe(false);
    });
  });

  describe('a command whose record changed elsewhere', () => {
    const conflicting = (label: string): UndoCommand => ({
      label,
      undo: async () => {
        throw new ChangedElsewhereError();
      },
      redo: async () => {
        throw new ChangedElsewhereError();
      },
    });

    it('is dropped, reported once, and undo says nothing happened', async () => {
      const s = new UndoStack();
      const seen: string[] = [];
      s.onConflict = (c) => seen.push(c.label);
      s.push(cmd('ok'));
      s.push(conflicting('stale'));
      expect(await s.undo()).toBeNull();
      expect(seen).toEqual(['stale']);
      expect(s.canRedo()).toBe(false);
      expect(s.nextUndoLabel()).toBe('ok');
      expect((await s.undo())?.label).toBe('ok');
    });

    it('a redo that conflicts is dropped too', async () => {
      const s = new UndoStack();
      let fail = false;
      s.push({ label: 'x', undo: async () => undefined, redo: async () => { if (fail) throw new ChangedElsewhereError(); } });
      await s.undo();
      fail = true;
      expect(await s.redo()).toBeNull();
      expect(s.canRedo()).toBe(false);
      expect(s.canUndo()).toBe(false);
    });

    it('the toast Undo reports false and drops it', async () => {
      const s = new UndoStack();
      const c = conflicting('stale');
      s.push(c);
      expect(await s.undoCommand(c)).toBe(false);
      expect(s.canUndo()).toBe(false);
    });
  });

  it('a push while an undo is running clears redo for good: the finished undo is not redoable', async () => {
    const s = new UndoStack();
    let release!: () => void;
    s.push({ label: 'slow', undo: () => new Promise<void>((r) => (release = r)), redo: async () => undefined });
    const running = s.undo();
    await Promise.resolve();
    s.push(cmd('newer'));
    release();
    await running;
    expect(s.canRedo()).toBe(false);
    expect(s.nextUndoLabel()).toBe('newer');
  });
});
