/** What a reader key press asks for. */
export type ShortcutAction =
  | 'bookmark'
  | 'mark'
  | 'area'
  | 'mode'
  | 'search'
  | 'contents'
  | 'notes'
  | 'fullscreen'
  | 'undo'
  | 'redo'
  | 'goto'
  | 'help'
  | 'historyBack'
  | 'historyForward';

/** The cheat-sheet: one row per action, in the order the toolbar shows them. */
export const SHORTCUT_LIST: readonly { action: ShortcutAction | 'turn'; keys: string; label: string }[] = [
  { action: 'turn', keys: '← → / PgUp PgDn / Space', label: 'Turn the page' },
  { action: 'contents', keys: 'C', label: 'Contents' },
  { action: 'notes', keys: 'N', label: 'Notes' },
  { action: 'search', keys: '/ or Ctrl+F', label: 'Search' },
  { action: 'goto', keys: 'G', label: 'Go to page' },
  { action: 'bookmark', keys: 'B', label: 'Bookmark this page' },
  { action: 'mark', keys: 'M', label: 'Mark page read' },
  { action: 'area', keys: 'A', label: 'Highlight an area' },
  { action: 'mode', keys: 'R', label: 'Reading mode' },
  { action: 'fullscreen', keys: 'F', label: 'Full screen' },
  { action: 'undo', keys: 'Ctrl+Z', label: 'Undo' },
  { action: 'redo', keys: 'Ctrl+Shift+Z / Ctrl+Y', label: 'Redo' },
  { action: 'historyBack', keys: 'Alt+← / Alt+→', label: 'Back / forward through jumps' },
  { action: 'help', keys: '?', label: 'This list' },
];

/**
 * The reader action a key press asks for, or null. Pure: whether the press belongs to a field is
 * `isReaderKeyIgnored`'s call, made first. Browser shortcuts are left alone: only Ctrl/Cmd+F, +Z, +Shift+Z and
 * +Y are taken, and only the reader calls this.
 */
export function shortcutFor(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'repeat'>): ShortcutAction | null {
  const key = e.key.toLowerCase();
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !e.altKey) {
    if (key === 'f' && !e.shiftKey) return 'search';
    if (key === 'z') return e.shiftKey ? 'redo' : 'undo';
    if (key === 'y' && !e.shiftKey) return 'redo';
    return null;
  }
  if (e.altKey) {
    if (e.key === 'ArrowLeft') return 'historyBack';
    if (e.key === 'ArrowRight') return 'historyForward';
    return null;
  }
  if (e.repeat) return null;
  if (e.key === '?') return 'help';
  if (e.key === '/') return 'search';
  switch (key) {
    case 'b': return 'bookmark';
    case 'm': return 'mark';
    case 'a': return 'area';
    case 'r': return 'mode';
    case 'c': return 'contents';
    case 'n': return 'notes';
    case 'f': return 'fullscreen';
    case 'g': return 'goto';
    default: return null;
  }
}
