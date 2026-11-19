import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CalendarAuthError, CalendarTransientError, type CalendarEvent } from './calendar-api';
import { GoogleCalendar } from './google-calendar';

const EVENT: CalendarEvent = { id: 'iqra202611212130', startsAt: '2026-11-21T21:30:00+00:00', endsAt: '2026-11-21T21:45:00+00:00', title: 'Time to read', description: 'd' };
const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const err = (status: number, reason: string, apiStatus?: string) => json(status, { error: { code: status, status: apiStatus, errors: [{ reason }] } });

describe('GoogleCalendar', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let cal: GoogleCalendar;
  const calls = () => fetchMock.mock.calls.map(([url, init]) => `${(init as RequestInit).method} ${String(url).replace('https://www.googleapis.com/calendar/v3', '')}`);

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    cal = new GoogleCalendar(() => 'tok', () => 0);
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each(['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded'])('retries a 403 %s once and then is transient, not an auth error', async (reason) => {
    fetchMock.mockImplementation(async () => err(403, reason));
    await expect(cal.insert('c', EVENT)).rejects.toBeInstanceOf(CalendarTransientError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('succeeds when the retry after a rate limit works', async () => {
    fetchMock.mockResolvedValueOnce(err(403, 'rateLimitExceeded')).mockResolvedValueOnce(json(200, {}));
    expect(await cal.insert('c', EVENT)).toBe('created');
  });

  it.each([
    [403, 'forbidden'],
    [403, 'insufficientPermissions'],
    [403, 'authError'],
    [401, ''],
  ])('maps %s %s to CalendarAuthError', async (status, reason) => {
    fetchMock.mockImplementation(async () => err(status, reason));
    await expect(cal.listFutureEvents('c')).rejects.toBeInstanceOf(CalendarAuthError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps PERMISSION_DENIED without a reason to CalendarAuthError', async () => {
    fetchMock.mockImplementation(async () => json(403, { error: { status: 'PERMISSION_DENIED' } }));
    await expect(cal.remove('c', 'x')).rejects.toBeInstanceOf(CalendarAuthError);
  });

  describe('error details the screen can show', () => {
    const body403 = {
      error: {
        code: 403,
        message: 'Google Calendar API has not been used in project 123 before or it is disabled.',
        errors: [{ reason: 'accessNotConfigured' }],
        status: 'PERMISSION_DENIED',
      },
    };

    it('a 403 accessNotConfigured is not an auth error: it carries the status and reason', async () => {
      fetchMock.mockImplementation(async () => json(403, body403));
      const e = await cal.ensureCalendar().catch((x: unknown) => x);
      expect(e).toBeInstanceOf(CalendarTransientError);
      expect(e).toMatchObject({ status: 403, reason: 'accessNotConfigured' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('SERVICE_DISABLED found only in the error details counts as accessNotConfigured', async () => {
      fetchMock.mockImplementation(async () =>
        json(403, { error: { code: 403, status: 'PERMISSION_DENIED', details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'SERVICE_DISABLED' }] } }),
      );
      await expect(cal.listFutureEvents('c')).rejects.toMatchObject({ status: 403, reason: 'accessNotConfigured' });
    });

    it('the existing-calendar probe does not hide an API that is switched off', async () => {
      fetchMock.mockImplementation(async () => json(403, body403));
      await expect(cal.ensureCalendar('old')).rejects.toMatchObject({ reason: 'accessNotConfigured' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('auth errors carry status and reason', async () => {
      fetchMock.mockImplementation(async () => err(403, 'insufficientPermissions'));
      await expect(cal.listFutureEvents('c')).rejects.toMatchObject({ name: 'CalendarAuthError', status: 403, reason: 'insufficientPermissions' });
      fetchMock.mockImplementation(async () => err(401, 'authError'));
      await expect(cal.listFutureEvents('c')).rejects.toMatchObject({ status: 401 });
    });

    it('other failures carry the reason too, whatever the status', async () => {
      fetchMock.mockImplementation(async () => err(400, 'invalid'));
      await expect(cal.listFutureEvents('c')).rejects.toMatchObject({ name: 'CalendarTransientError', status: 400, reason: 'invalid' });
    });

    it('a network failure passes through as the TypeError fetch threw', async () => {
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
      await expect(cal.listFutureEvents('c')).rejects.toBeInstanceOf(TypeError);
    });
  });

  it('retries a 500 once then throws a transient error', async () => {
    fetchMock.mockImplementation(async () => json(500));
    await expect(cal.listFutureEvents('c')).rejects.toBeInstanceOf(CalendarTransientError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('has no token: auth error without a request', async () => {
    await expect(new GoogleCalendar(() => null).listFutureEvents('c')).rejects.toBeInstanceOf(CalendarAuthError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lists with showDeleted and reports cancelled events', async () => {
    fetchMock.mockResolvedValue(json(200, { items: [{ id: 'a', status: 'cancelled' }, { id: 'b', status: 'confirmed', summary: 'S', description: 'D', start: { dateTime: 'T' } }] }));
    expect(await cal.listFutureEvents('c')).toEqual([
      { id: 'a', start: '', status: 'cancelled', title: '', description: '' },
      { id: 'b', start: 'T', status: 'confirmed', title: 'S', description: 'D' },
    ]);
    expect(String(fetchMock.mock.calls[0][0])).toContain('showDeleted=true');
  });

  it('on a 409 for a cancelled event restores it with an update', async () => {
    fetchMock.mockResolvedValueOnce(json(409)).mockResolvedValueOnce(json(200, { status: 'cancelled' })).mockResolvedValueOnce(json(200));
    expect(await cal.insert('c', EVENT)).toBe('created');
    expect(calls()).toEqual(['POST /calendars/c/events', `GET /calendars/c/events/${EVENT.id}`, `PUT /calendars/c/events/${EVENT.id}`]);
    expect(JSON.parse((fetchMock.mock.calls[2][1] as RequestInit).body as string).status).toBe('confirmed');
  });

  it('on a 409 for a live event reports exists and changes nothing', async () => {
    fetchMock.mockResolvedValueOnce(json(409)).mockResolvedValueOnce(json(200, { status: 'confirmed' }));
    expect(await cal.insert('c', EVENT)).toBe('exists');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('ensureCalendar keeps a readable calendar and never lists the calendar list', async () => {
    fetchMock.mockResolvedValue(json(200, { id: 'mine' }));
    expect(await cal.ensureCalendar('mine')).toBe('mine');
    expect(calls()).toEqual(['GET /calendars/mine']);
  });

  it.each([403, 404, 410])('ensureCalendar creates a new calendar when the stored one answers %s', async (status) => {
    fetchMock.mockResolvedValueOnce(status === 403 ? err(403, 'forbidden') : json(status)).mockResolvedValueOnce(json(200, { id: 'new' }));
    expect(await cal.ensureCalendar('old')).toBe('new');
    expect(calls()).toEqual(['GET /calendars/old', 'POST /calendars']);
  });

  it('ensureCalendar without an id creates one without searching', async () => {
    fetchMock.mockResolvedValue(json(200, { id: 'new' }));
    expect(await cal.ensureCalendar()).toBe('new');
    expect(calls()).toEqual(['POST /calendars']);
  });
});
