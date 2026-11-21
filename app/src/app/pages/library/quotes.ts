/** Short sayings about reading for the Library greeting. One a day; each stays within QUOTE_MAX characters. */
export const QUOTE_MAX = 60;

export const QUOTES: readonly string[] = [
  'A reader lives a thousand lives.',
  'Reading is to the mind what exercise is to the body.',
  'So many books, so little time.',
  'A book is a dream you hold in your hands.',
  'Today a reader, tomorrow a leader.',
  'Read a little every day.',
  'Books are a uniquely portable magic.',
  'One page at a time.',
  'A room without books is a body without a soul.',
  'Good books reward patient readers.',
  'There is no friend as loyal as a book.',
  'Read to learn, read to wonder.',
  'The more you read, the more you know.',
  'Take a book, take a breath.',
  'Every book is a small window on the world.',
  'Slow reading is deep reading.',
  'Read the first word. The rest will follow.',
  'Curiosity begins on the first page.',
  'A few pages today beat a whole book someday.',
  'Words are small doors to big ideas.',
  'Where there is a book, there is a way.',
  'Find your quiet corner and read.',
  'Great minds start with a good page.',
  'Reading is a conversation across time.',
  'Make time for the book you keep meaning to read.',
  'اقرأ باسم ربك الذي خلق',
  'القراءة غذاء العقل.',
  'خير جليس في الزمان كتاب',
  'من قرأ كثيراً عرف كثيراً.',
];

const DAY_MS = 86_400_000;

/** Today's quote: the list rotates daily by local calendar day, and a quote never runs past QUOTE_MAX. */
export function quoteOfTheDay(now: number): string {
  const d = new Date(now);
  const dayNumber = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
  const q = QUOTES[dayNumber % QUOTES.length];
  return q.length <= QUOTE_MAX ? q : `${q.slice(0, QUOTE_MAX - 1).trimEnd()}…`;
}
