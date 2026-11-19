import { describe, expect, it } from 'vitest';
import { eventId, reminderSlots } from './schedule';

describe('reminderSlots', () => {
  const now = new Date(2026, 10, 18, 22, 0); // Wed 2026-11-18 22:00 local
  const days = [6, 0, 1, 2, 3, 4] as (0 | 1 | 2 | 3 | 4 | 5 | 6)[];

  it('starts on the first selected weekday after now and skips Friday', () => {
    const slots = reminderSlots(now, { days, time: '21:30' });
    expect(slots[0]).toEqual(new Date(2026, 10, 19, 21, 30)); // Thursday
    expect(slots.some((s) => s.getDay() === 5)).toBe(false);
    expect(slots.map((s) => s.getDate()).slice(0, 3)).toEqual([19, 21, 22]);
  });

  it('has one slot per selected weekday in the next 14 days, all in the future', () => {
    const slots = reminderSlots(now, { days, time: '21:30' });
    let expected = 0;
    for (let i = 0; i <= 14; i++) {
      const slot = new Date(2026, 10, 18 + i, 21, 30);
      if (days.includes(slot.getDay() as 0) && slot > now && slot <= new Date(2026, 10, 18 + 14, 22, 0)) expected++;
    }
    expect(slots).toHaveLength(expected);
    expect(slots.every((s) => s > now)).toBe(true);
  });

  it('keeps the chosen local time on every day, including across a DST change', () => {
    const slots = reminderSlots(new Date(2026, 2, 1, 8, 0), { days: [0, 1, 2, 3, 4, 5, 6], time: '21:30' });
    expect(slots.length).toBeGreaterThan(10);
    expect(slots.every((s) => s.getHours() === 21 && s.getMinutes() === 30)).toBe(true);
    const nov = reminderSlots(new Date(2026, 9, 28, 8, 0), { days: [0, 1, 2, 3, 4, 5, 6], time: '21:30' });
    expect(nov.every((s) => s.getHours() === 21 && s.getMinutes() === 30)).toBe(true);
  });

  it('returns nothing for an invalid time', () => {
    expect(reminderSlots(now, { days, time: '25:99' })).toEqual([]);
    expect(reminderSlots(now, { days, time: 'abc' })).toEqual([]);
  });

  it('skips a slot that is not strictly in the future', () => {
    const slots = reminderSlots(new Date(2026, 10, 19, 21, 30), { days: [4], time: '21:30' });
    expect(slots[0]).toEqual(new Date(2026, 10, 26, 21, 30));
  });
});

describe('eventId', () => {
  it('encodes local date and time with the iqra prefix', () => {
    expect(eventId(new Date(2026, 10, 21, 21, 30))).toBe('iqra202611212130');
  });
});
