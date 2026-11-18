/**
 * Whether a key event belongs to the focused element rather than the reader.
 * Fields and dialogs own every key; buttons and links own only their activation keys (Space, Enter).
 */
export function isReaderKeyIgnored(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  if (
    el.isContentEditable === true ||
    el.closest('input, textarea, select, [contenteditable]:not([contenteditable=false]), [role=dialog]') !== null
  ) {
    return true;
  }
  return (e.key === ' ' || e.key === 'Enter') && el.closest('button, a[href], [role=button]') !== null;
}
