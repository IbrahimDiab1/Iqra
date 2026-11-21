/** Copy for the Library's greeting and Continue reading row. Lazy, with the component that uses it. */
export const TOP_COPY = {
  welcome: (name: string) => `Welcome, ${name}`,
  welcomeAnon: 'Welcome',
  streakDays: (n: number) => (n === 1 ? '1-day streak' : `${n}-day streak`),
  streakNone: 'No streak yet',
  timeRead: (t: string) => `${t} read`,
  finishedCount: (n: number) => (n === 1 ? '1 book finished' : `${n} books finished`),
  timeToday: (t: string) => `${t} read today`,
  pagesToday: (n: number) => (n === 1 ? '1 page today' : `${n} pages today`),
  pagesLeft: (n: number, period: 'day' | 'week' | 'month') =>
    `${n === 1 ? '1 page' : `${n} pages`} to go ${period === 'day' ? 'today' : period === 'week' ? 'this week' : 'this month'}`,
  timeLeft: (t: string, period: 'day' | 'week' | 'month') =>
    `${t} to go ${period === 'day' ? 'today' : period === 'week' ? 'this week' : 'this month'}`,
  goalReached: 'Goal reached',
  pagesAll: (n: number) => (n === 1 ? '1 page read in total' : `${n} pages read in total`),
  timeAll: (t: string) => `${t} read in total`,
  todaysQuote: 'Today\u2019s quote',
  closeQuote: 'Close',
  continue: 'Continue reading',
  percentRead: (n: number) => `${n}% read`,
  openBook: (title: string) => `Open ${title}`,
} as const;
