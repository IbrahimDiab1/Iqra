import { InjectionToken } from '@angular/core';

export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';

export interface CalendarEvent {
  id: string;
  startsAt: string; // ISO with offset
  endsAt: string;
  title: string;
  description: string;
}

export interface CalendarApi {
  /** Creates a secondary calendar named 'Iqra' (with the device time zone) when it is missing. */
  ensureCalendar(existingId?: string): Promise<string>;
  listFutureEvents(calendarId: string): Promise<{ id: string; start: string }[]>;
  /** A 409 means another device already created the same event: that is success. */
  insert(calendarId: string, e: CalendarEvent): Promise<'created' | 'exists'>;
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
