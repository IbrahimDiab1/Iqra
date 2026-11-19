import { COPY } from '../ui/copy';
import { CHROME_COPY } from './chrome-copy';

export type ContextActionId = 'note' | 'copySelection' | 'sideNote' | 'bookmark' | 'mark' | 'area' | 'summary' | 'goto' | 'copyPage';

/** Everything the menu's contents depend on. */
export interface ContextSituation {
  page: number;
  bookmarked: boolean;
  pageMarked: boolean;
  markedMode: boolean;
  hasSelection: boolean;
  reflow: boolean;
}

export interface ContextMenuItem {
  id: ContextActionId;
  label: string;
  /** Items of one group sit together; a divider is drawn between groups. */
  group: number;
  shortcut?: string;
  /** `off`: cannot be used here (disabled). `soft`: looks unavailable but takes the press to explain itself. */
  disabled?: 'off' | 'soft';
  hint?: string;
}

export interface ContextMenuModel {
  /** The four colour dots come first (a text selection exists). */
  colors: boolean;
  items: ContextMenuItem[];
}

/** The items of the right-click / long-press menu for the current situation. */
export function contextMenuModel(s: ContextSituation): ContextMenuModel {
  const a = COPY.annotations;
  const items: ContextMenuItem[] = [];
  if (s.hasSelection) {
    items.push({ id: 'note', label: a.note, group: 0 }, { id: 'copySelection', label: a.copy, group: 0 });
  }
  items.push(
    { id: 'sideNote', label: CHROME_COPY.addSideNoteOn(s.page), group: 1 },
    { id: 'bookmark', label: s.bookmarked ? a.removeBookmark : a.addBookmark, group: 1, shortcut: 'B' },
    s.markedMode
      ? { id: 'mark', label: s.pageMarked ? CHROME_COPY.unmarkPageAsRead : CHROME_COPY.markPageAsRead, group: 1, shortcut: 'M' }
      : { id: 'mark', label: CHROME_COPY.markPageAsRead, group: 1, shortcut: 'M', disabled: 'soft', hint: CHROME_COPY.markDisabled },
    { id: 'area', label: a.area, group: 1, shortcut: 'A', ...(s.reflow ? { disabled: 'off' as const } : {}) },
    { id: 'summary', label: CHROME_COPY.addRangeSummary, group: 2 },
    { id: 'goto', label: CHROME_COPY.goToPageEllipsis, group: 2, shortcut: 'G' },
    { id: 'copyPage', label: CHROME_COPY.copyPageText, group: 2 },
  );
  return { colors: s.hasSelection, items };
}

const MARGIN = 8;

/** The top-left corner for a menu opened at (x, y): kept inside the viewport with a margin. */
export function clampMenu(o: { x: number; y: number; w: number; h: number; vw: number; vh: number }): { left: number; top: number } {
  const left = Math.max(MARGIN, Math.min(o.x, o.vw - o.w - MARGIN));
  const top = Math.max(MARGIN, Math.min(o.y, o.vh - o.h - MARGIN));
  return { left, top };
}
