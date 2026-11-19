import { InjectionToken } from '@angular/core';

export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';

export interface CalendarEvent {
  id: string;
  startsAt: string; // ISO with offset
  endsAt: string;
  title: string;
  description: string;
}

/** An event as the calendar lists it. Deleted events stay listed as 'cancelled': Google keeps their ids reserved. */
export interface CalendarEventInfo {
  id: string;
  start: string;
  status: 'confirmed' | 'cancelled';
  title: string;
  description: string;
}

export interface CalendarApi {
  /**
   * The id of the Iqra calendar: existingId when it can still be read, otherwise a new secondary
   * calendar named 'Iqra'. It never searches the owner's calendar list (the app-created scope does
   * not allow that).
   */
  ensureCalendar(existingId?: string): Promise<string>;
  /** Future events including cancelled ones, so reserved ids are visible. */
  listFutureEvents(calendarId: string): Promise<CalendarEventInfo[]>;
  /** A 409 on a live event means another device created it: 'exists'. A cancelled one is restored. */
  insert(calendarId: string, e: CalendarEvent): Promise<'created' | 'exists'>;
  /** Rewrites an event and makes it confirmed again (restores a cancelled one). */
  update(calendarId: string, e: CalendarEvent): Promise<void>;
  /** 404 and 410 are fine: the event is already gone. */
  remove(calendarId: string, id: string): Promise<void>;
}

export const CALENDAR_API = new InjectionToken<CalendarApi>('calendar');

/** Calendar refused the request: permission missing, revoked or rejected (401/403). */
export class CalendarAuthError extends Error {
  constructor(message = 'Calendar access was refused') {
    super(message);
    this.name = 'CalendarAuthError';
  }
}

/** A rate limit, quota or server fault. Reminders stay on and the next run tries again. */
export class CalendarTransientError extends Error {
  constructor(message = 'Calendar is busy, try again later') {
    super(message);
    this.name = 'CalendarTransientError';
  }
}
