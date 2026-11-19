import { CALENDAR_SCOPE, CalendarAuthError, type CalendarApi, type CalendarEvent } from './calendar-api';

const BASE = 'https://www.googleapis.com/calendar/v3';
const TIMEOUT_MS = 10_000;
const RETRY_DELAY_MS = 1_000;
const CALENDAR_NAME = 'Iqra';

/** Reads the cached Calendar token; null when none is valid. */
export type TokenSource = (scope: string) => string | null;

/** Google Calendar REST adapter. Uses its own token, never the sign-in token. */
export class GoogleCalendar implements CalendarApi {
  constructor(private readonly tokenFor: TokenSource) {}

  async ensureCalendar(existingId?: string): Promise<string> {
    if (existingId) {
      const res = await this.call(`/calendars/${encodeURIComponent(existingId)}`, 'GET', undefined, [404, 410]);
      if (res.ok) return existingId;
    }
    const list = await this.call('/users/me/calendarList?minAccessRole=owner', 'GET');
    const items = ((await list.json()) as { items?: { id: string; summary?: string }[] }).items ?? [];
    const found = items.find((c) => c.summary === CALENDAR_NAME);
    if (found) return found.id;
    const created = await this.call('/calendars', 'POST', {
      summary: CALENDAR_NAME,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    return ((await created.json()) as { id: string }).id;
  }

  async listFutureEvents(calendarId: string): Promise<{ id: string; start: string }[]> {
    const out: { id: string; start: string }[] = [];
    let pageToken = '';
    do {
      const q = `timeMin=${encodeURIComponent(new Date().toISOString())}&singleEvents=true&maxResults=250&showDeleted=false${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
      const res = await this.call(`/calendars/${encodeURIComponent(calendarId)}/events?${q}`, 'GET');
      const json = (await res.json()) as { items?: { id: string; start?: { dateTime?: string; date?: string } }[]; nextPageToken?: string };
      for (const e of json.items ?? []) out.push({ id: e.id, start: e.start?.dateTime ?? e.start?.date ?? '' });
      pageToken = json.nextPageToken ?? '';
    } while (pageToken);
    return out;
  }

  async insert(calendarId: string, e: CalendarEvent): Promise<'created' | 'exists'> {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const res = await this.call(
      `/calendars/${encodeURIComponent(calendarId)}/events`,
      'POST',
      {
        id: e.id,
        summary: e.title,
        description: e.description,
        start: { dateTime: e.startsAt, timeZone },
        end: { dateTime: e.endsAt, timeZone },
        reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] },
      },
      [409],
    );
    return res.status === 409 ? 'exists' : 'created';
  }

  async remove(calendarId: string, id: string): Promise<void> {
    await this.call(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`, 'DELETE', undefined, [404, 410]);
  }

  /** One request with a timeout; 429 and 5xx retry once after a second. Statuses in `accept` are returned, not thrown. */
  private async call(path: string, method: string, body?: unknown, accept: number[] = []): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const token = this.tokenFor(CALENDAR_SCOPE);
      if (!token) throw new CalendarAuthError('No Calendar permission');
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok || accept.includes(res.status)) return res;
      if (res.status === 401 || res.status === 403) throw new CalendarAuthError(`Calendar refused the request (${res.status})`);
      if ((res.status === 429 || res.status >= 500) && attempt === 0) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
      throw new Error(`Calendar request failed: ${res.status}`);
    }
  }
}
