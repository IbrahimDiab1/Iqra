/** An undo or redo found its record changed (or deleted) by another device since this device last wrote it. */
export class ChangedElsewhereError extends Error {
  constructor() {
    super('Changed on another device');
    this.name = 'ChangedElsewhereError';
  }
}
