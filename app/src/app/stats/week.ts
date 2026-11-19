export type WeekStartsOn = 0 | 1 | 6;

const pad = (n: number) => String(n).padStart(2, '0');

/** Local-time 'YYYY-MM-DD' for the day containing `ms`. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local midnight of the first day of the week that contains `ms`. Day arithmetic goes through Date, so DST is safe. */
export function weekStart(ms: number, weekStartsOn: WeekStartsOn): number {
  const d = new Date(ms);
  const back = (d.getDay() - weekStartsOn + 7) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back).getTime();
}

/** The week containing `ms`: `from` is its first local midnight, `to` the exclusive next week start. */
export function weekRange(ms: number, weekStartsOn: WeekStartsOn): { from: number; to: number; days: string[] } {
  const from = weekStart(ms, weekStartsOn);
  const start = new Date(from);
  const at = (offset: number) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset);
  const days = Array.from({ length: 7 }, (_, i) => dayKey(at(i).getTime()));
  return { from, to: at(7).getTime(), days };
}

/** e.g. "Nov 14 – 20" within a month, "Nov 28 – Dec 4" across months. `to` is exclusive. */
export function formatRange(from: number, to: number, locale?: string): string {
  const short = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' });
  const last = new Date(to - 1);
  const first = new Date(from);
  if (first.getMonth() === last.getMonth() && first.getFullYear() === last.getFullYear()) {
    return `${short.format(first)} – ${last.getDate()}`;
  }
  return `${short.format(first)} – ${short.format(last)}`;
}
