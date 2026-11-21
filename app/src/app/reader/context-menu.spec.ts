import { describe, expect, it } from 'vitest';
import { clampMenu, contextMenuModel, type ContextSituation } from './context-menu';

const base: ContextSituation = { page: 12, bookmarked: false, pageMarked: false, markedMode: true, hasSelection: false, reflow: false };
const ids = (s: Partial<ContextSituation>) => contextMenuModel({ ...base, ...s }).items.map((i) => i.id);

describe('contextMenuModel', () => {
  it('lists the page actions in order when nothing is selected', () => {
    const m = contextMenuModel(base);
    expect(m.colors).toBe(false);
    expect(m.items.map((i) => i.id)).toEqual(['sideNote', 'bookmark', 'mark', 'area', 'summary', 'goto', 'copyPage']);
    expect(m.items[0].label).toBe('Add side note on p. 12');
    expect(m.items.find((i) => i.id === 'goto')!.label).toBe('Go to page…');
  });

  it('with a selection it adds the colour dots, Note, Copy and Translate before the page actions', () => {
    const m = contextMenuModel({ ...base, hasSelection: true });
    expect(m.colors).toBe(true);
    expect(m.items.map((i) => i.id)).toEqual(['note', 'copySelection', 'translate', 'sideNote', 'bookmark', 'mark', 'area', 'summary', 'goto', 'copyPage']);
    expect(m.items.find((i) => i.id === 'note')!.group).toBe(0);
    expect(m.items.find((i) => i.id === 'sideNote')!.group).toBe(1);
  });

  it('bookmark and mark flip their wording with the page state', () => {
    const on = contextMenuModel({ ...base, bookmarked: true, pageMarked: true }).items;
    expect(on.find((i) => i.id === 'bookmark')!.label).toBe('Remove bookmark');
    expect(on.find((i) => i.id === 'mark')!.label).toBe('Unmark page as read');
    const off = contextMenuModel(base).items;
    expect(off.find((i) => i.id === 'bookmark')!.label).toBe('Bookmark this page');
    expect(off.find((i) => i.id === 'mark')!.label).toBe('Mark page as read');
  });

  it('in last-page mode Mark is soft-disabled and says why', () => {
    const mark = contextMenuModel({ ...base, markedMode: false }).items.find((i) => i.id === 'mark')!;
    expect(mark.disabled).toBe('soft');
    expect(mark.hint).toBe('Switch to marked mode to mark pages');
  });

  it('Area highlight is off in reading mode only', () => {
    expect(contextMenuModel({ ...base, reflow: true }).items.find((i) => i.id === 'area')!.disabled).toBe('off');
    expect(contextMenuModel(base).items.find((i) => i.id === 'area')!.disabled).toBeUndefined();
    expect(ids({ reflow: true })).toContain('area');
  });
});

describe('clampMenu', () => {
  const view = { vw: 1000, vh: 700 };
  it('keeps a menu that fits where the pointer is', () => {
    expect(clampMenu({ x: 100, y: 100, w: 200, h: 300, ...view })).toEqual({ left: 100, top: 100 });
  });
  it('pulls it back from the right and bottom edges with an 8 px margin', () => {
    expect(clampMenu({ x: 950, y: 650, w: 200, h: 300, ...view })).toEqual({ left: 792, top: 392 });
  });
  it('never goes past the left or top edge, even when larger than the viewport', () => {
    expect(clampMenu({ x: -20, y: -5, w: 200, h: 300, ...view })).toEqual({ left: 8, top: 8 });
    expect(clampMenu({ x: 10, y: 10, w: 200, h: 900, ...view }).top).toBe(8);
  });
});
