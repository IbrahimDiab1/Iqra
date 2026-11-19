import { CALENDAR_SCOPE, CalendarAuthError, CalendarTransientError, type CalendarApi, type CalendarEvent, type CalendarEventInfo } from './calendar-api';

const BASE = 'https://www.googleapis.com/calendar/v3';
const TIMEOUT_MS = 10_000;
const CALENDAR_NAME = 'Iqra';
/** 403 reasons that mean "slow down", not "no permission". */
const RATE_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'dailyLimitExceeded', 'calendarUsageLimitsExceeded']);
/** The Calendar API is switched off for the Cloud project: Google's `accessNotConfigured`, or SERVICE_DISABLED in the details. */
const API_NOT_ENABLED = 'accessNotConfigured';
/** 403 reasons that mean the permission is missing or revoked. */
const AUTH_REASONS = new Set(['forbidden', 'insufficientPermissions', 'authError']);

/** Reads the cached Calendar token; null when none is valid. */
export type TokenSource = (scope: string) => string | null;

/** Wait before the single retry: 1 to 2 seconds. */
const defaultRetryDelay = () => 1000 + Math.random() * 1000;

/** Google Calendar REST adapter. Uses its own token, never the sign-in token. */
export class GoogleCalendar implements CalendarApi {
  constructor(
    private readonly tokenFor: TokenSource,
    private readonly retryDelayMs: () => number = defaultRetryDelay,
  ) {}

  async ensureCalendar(existingId?: string): Promise<string> {
    if (existingId) {
      // 403/404/410 all mean this calendar is not usable any more (deleted, or not ours): make a new one.
      const res = await this.call(`/calendars/${encodeURIComponent(existingId)}`, 'GET', undefined, [403, 404, 410]);
      if (res.ok) return existingId;
    }
    const created = await this.call('/calendars', 'POST', {
      summary: CALENDAR_NAME,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    return ((await created.json()) as { id: string }).id;
  }

  async listFutureEvents(calendarId: string): Promise<CalendarEventInfo[]> {
    const out: CalendarEventInfo[] = [];
    let pageToken = '';
    do {
      const q = `timeMin=${encodeURIComponent(new Date().toISOString())}&singleEvents=true&maxResults=250&showDeleted=true${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
      const res = await this.call(`/calendars/${encodeURIComponent(calendarId)}/events?${q}`, 'GET');
      const json = (await res.json()) as {
        items?: { id: string; status?: string; summary?: string; description?: string; start?: { dateTime?: string; date?: string } }[];
        nextPageToken?: string;
      };
      for (const e of json.items ?? []) {
        out.push({
          id: e.id,
          start: e.start?.dateTime ?? e.start?.date ?? '',
          status: e.status === 'cancelled' ? 'cancelled' : 'confirmed',
          title: e.summary ?? '',
          description: e.description ?? '',
        });
      }
      pageToken = json.nextPageToken ?? '';
    } while (pageToken);
    return out;
  }

  async insert(calendarId: string, e: CalendarEvent): Promise<'created' | 'exists'> {
    const res = await this.call(`/calendars/${encodeURIComponent(calendarId)}/events`, 'POST', this.body(e), [409]);
    if (res.status !== 409) return 'created';
    // The id is taken. A cancelled event (deleted earlier) is brought back; a live one is another device's.
    const existing = await this.call(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(e.id)}`, 'GET');
    if (((await existing.json()) as { status?: string }).status !== 'cancelled') return 'exists';
    await this.update(calendarId, e);
    return 'created';
  }

  async update(calendarId: string, e: CalendarEvent): Promise<void> {
    await this.call(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(e.id)}`, 'PUT', { ...this.body(e), status: 'confirmed' });
  }

  async remove(calendarId: string, id: string): Promise<void> {
    await this.call(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`, 'DELETE', undefined, [404, 410]);
  }

  private body(e: CalendarEvent) {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return {
      id: e.id,
      summary: e.title,
      description: e.description,
      start: { dateTime: e.startsAt, timeZone },
      end: { dateTime: e.endsAt, timeZone },
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] },
    };
  }

  /**
   * One request with a timeout. Rate limits (429, or 403 with a rate reason) and 5xx retry once after
   * 1 to 2 s, then throw CalendarTransientError. 401 and 403 forbidden/permission reasons throw
   * CalendarAuthError. Statuses in `accept` are returned, not thrown.
   */
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
      if (res.ok) return res;
      const reason = await errorReason(res);
      const slowDown = res.status === 429 || (res.status === 403 && RATE_REASONS.has(reason)) || res.status >= 500;
      // An API that is switched off for the project is never "acceptable": it must reach the owner.
      if (!slowDown && reason !== API_NOT_ENABLED && accept.includes(res.status)) return res;
      if (res.status === 401 || (res.status === 403 && !slowDown && AUTH_REASONS.has(reason))) {
        throw new CalendarAuthError(`Calendar refused the request (${res.status}${reason ? ` ${reason}` : ''})`, res.status, reason);
      }
      if (slowDown && attempt === 0) {
        await new Promise((r) => setTimeout(r, this.retryDelayMs()));
        continue;
      }
      throw new CalendarTransientError(`Calendar request failed: ${res.status}${reason ? ` ${reason}` : ''}`, res.status, reason);
    }
  }
}

/**
 * The error reason in a Google error body ('' when unreadable). PERMISSION_DENIED counts as 'forbidden'; a SERVICE_DISABLED
 * detail (the newer way Google says the API is off) counts as accessNotConfigured.
 */
async function errorReason(res: Response): Promise<string> {
  try {
    const e = ((await res.clone().json()) as { error?: { status?: string; errors?: { reason?: string }[]; details?: { reason?: string }[] } }).error;
    if (e?.details?.some((d) => d.reason === 'SERVICE_DISABLED')) return API_NOT_ENABLED;
    return e?.errors?.[0]?.reason ?? (e?.status === 'PERMISSION_DENIED' ? 'forbidden' : '');
  } catch {
    return '';
  }
}
