/**
 * Whether the intro opens by itself on the Library: only for someone who has not seen it and has no books yet.
 * The e2e build (fake Drive) keeps it closed unless asked (?intro=1), so the specs are not covered by a dialog.
 */
export function introDue(introSeen: boolean | undefined, bookCount: number, suppressed: boolean): boolean {
  return !suppressed && !introSeen && bookCount === 0;
}
