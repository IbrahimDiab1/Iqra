/** Strings for reading progress. Lives with the reader so the eager copy.ts stays small. */
export const PROGRESS_COPY = {
  markRead: 'Mark read',
  markedRead: 'Marked as read',
  finishPrompt: 'You reached the end. Mark as finished?',
  markFinished: 'Mark finished',
  chapterPct: (n: number) => `${n}%`,
  chaptersDone: (done: number, total: number) => `${done} of ${total} chapters done`,
} as const;
