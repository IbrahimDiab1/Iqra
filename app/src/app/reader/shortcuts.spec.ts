import { describe, expect, it } from 'vitest';
import { shortcutFor, SHORTCUT_LIST } from './shortcuts';

const press = (key: string, init: Partial<Parameters<typeof shortcutFor>[0]> = {}) =>
  shortcutFor({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, ...init });

describe('shortcutFor', () => {
  it('maps the plain letters to their actions, whatever the case', () => {
    expect(press('b')).toBe('bookmark');
    expect(press('M')).toBe('mark');
    expect(press('a')).toBe('area');
    expect(press('r')).toBe('mode');
    expect(press('c')).toBe('contents');
    expect(press('n')).toBe('notes');
    expect(press('f')).toBe('fullscreen');
    expect(press('g')).toBe('goto');
    expect(press('/')).toBe('search');
    expect(press('?', { shiftKey: true })).toBe('help');
  });

  it('takes Ctrl or Cmd with F, Z, Shift+Z and Y only', () => {
    expect(press('f', { ctrlKey: true })).toBe('search');
    expect(press('f', { metaKey: true })).toBe('search');
    expect(press('z', { ctrlKey: true })).toBe('undo');
    expect(press('Z', { ctrlKey: true, shiftKey: true })).toBe('redo');
    expect(press('y', { ctrlKey: true })).toBe('redo');
  });

  it('leaves every other browser shortcut alone', () => {
    for (const k of ['a', 'b', 'c', 'r', 'm', 'n', 'g', 'p', 's', 'w', 't']) {
      expect(press(k, { ctrlKey: true })).toBeNull();
      expect(press(k, { metaKey: true })).toBeNull();
    }
    expect(press('f', { ctrlKey: true, shiftKey: true })).toBeNull();
    expect(press('b', { altKey: true })).toBeNull();
  });

  it('maps Alt+arrows to jump history', () => {
    expect(press('ArrowLeft', { altKey: true })).toBe('historyBack');
    expect(press('ArrowRight', { altKey: true })).toBe('historyForward');
    expect(press('ArrowLeft')).toBeNull();
  });

  it('ignores a held key so a toggle does not flicker', () => {
    expect(press('b', { repeat: true })).toBeNull();
    expect(press('z', { ctrlKey: true, repeat: true })).toBe('undo');
  });

  it('opens the context menu with the Menu key or Shift+F10', () => {
    expect(press('ContextMenu')).toBe('menu');
    expect(press('F10', { shiftKey: true })).toBe('menu');
    expect(press('F10')).toBeNull();
    expect(press('F10', { shiftKey: true, ctrlKey: true })).toBeNull();
  });

  it('lists every action the reader answers to', () => {
    const listed = new Set(SHORTCUT_LIST.map((r) => r.action));
    for (const a of ['bookmark', 'mark', 'area', 'mode', 'search', 'contents', 'notes', 'fullscreen', 'undo', 'redo', 'goto', 'help', 'menu']) {
      expect(listed.has(a as never)).toBe(true);
    }
  });
});
