/** Copy for the Library's greeting and Continue reading row. Lazy, with the component that uses it. */
export const TOP_COPY = {
  welcome: (name: string) => `Welcome, ${name}`,
  welcomeAnon: 'Welcome',
  streakDays: (n: number) => (n === 1 ? '1-day streak' : `${n}-day streak`),
  streakNone: 'No streak yet',
  timeRead: (t: string) => `${t} read`,
  finishedCount: (n: number) => (n === 1 ? '1 book finished' : `${n} books finished`),
  continue: 'Continue reading',
  percentRead: (n: number) => `${n}% read`,
  openBook: (title: string) => `Open ${title}`,
} as const;
