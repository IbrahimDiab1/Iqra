import type { ReminderSettings } from '../core/models';

export const REMINDER_DEFAULTS = {
  days: [6, 0, 1, 2, 3, 4] as (0 | 1 | 2 | 3 | 4 | 5 | 6)[], // Saturday to Thursday
  time: '21:30',
  quoteSource: 'both' as 'highlights' | 'builtin' | 'both',
};

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Local date and time of each reminder in the next horizon days, strictly in the future. */
export function reminderSlots(now: Date, r: ReminderSettings, horizonDays = 14): Date[] {
  const match = TIME.exec(r.time ?? REMINDER_DEFAULTS.time);
  if (!match) return [];
  const days = r.days ?? REMINDER_DEFAULTS.days;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const end = new Date(y, m, d + horizonDays, now.getHours(), now.getMinutes(), now.getSeconds());
  const slots: Date[] = [];
  for (let i = 0; i <= horizonDays; i++) {
    const slot = new Date(y, m, d + i, hour, minute);
    if (days.includes(slot.getDay() as 0) && slot > now && slot <= end) slots.push(slot);
  }
  return slots;
}

/** Deterministic Calendar event id from the local slot. Calendar ids allow only a-v and 0-9. */
export function eventId(slot: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `iqra${slot.getFullYear()}${two(slot.getMonth() + 1)}${two(slot.getDate())}${two(slot.getHours())}${two(slot.getMinutes())}`;
}

/** The ids that reminderSlots produces; other Iqra events (such as a test reminder) never match. */
export const SLOT_EVENT_ID = /^iqra\d{12}$/;
