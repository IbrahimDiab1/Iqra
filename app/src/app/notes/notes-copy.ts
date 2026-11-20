/** Strings for the Notes hub filters and cards. Lives with the page so the eager copy.ts stays small. */
export const NOTES_COPY = {
  filters: { all: 'All', highlights: 'Highlights', notes: 'Notes', summaries: 'Summaries', bookmarks: 'Bookmarks' },
  typeGroup: 'Type',
  categoryGroup: 'Category',
  uncategorized: 'Uncategorized',
  books: 'Books',
  booksCount: (n: number) => `Books · ${n}`,
  chooseBooks: 'Choose books',
  clearBooks: 'Show all books',
  done: 'Done',
  removeBook: (title: string) => `Remove filter: ${title}`,
  openInBook: 'Open in book',
  edit: 'Edit',
  showMore: 'Show more',
  showLess: 'Show less',
  justNow: 'Just now',
} as const;
