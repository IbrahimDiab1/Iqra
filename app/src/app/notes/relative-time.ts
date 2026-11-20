const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86_400_000],
  ['month', 30 * 86_400_000],
  ['week', 7 * 86_400_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

/** "3 days ago", "yesterday"; `justNow` under a minute (or a time in the future, from clock skew). */
export function relativeTime(then: number, now: number, justNow: string, locale?: string): string {
  const diff = now - then;
  if (!Number.isFinite(diff) || diff < 60_000) return justNow;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const [unit, ms] of UNITS) {
    if (diff >= ms) return rtf.format(-Math.floor(diff / ms), unit);
  }
  return justNow;
}
