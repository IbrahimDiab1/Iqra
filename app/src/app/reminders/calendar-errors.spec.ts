import { describe, expect, it } from 'vitest';
import { CalendarAuthError, CalendarHttpError, CalendarTransientError } from './calendar-api';
import { describeCalendarError } from './calendar-errors';

const API_OFF =
  "Google Calendar API isn't enabled for this project. Enable it in Google Cloud Console (APIs & Services → Library → Google Calendar API).";
const SCOPE = "Google didn't grant calendar access. Check the consent screen scopes.";
const NETWORK = "Couldn't reach Google. Check your connection and try again.";

describe('describeCalendarError', () => {
  it.each(['accessNotConfigured', 'SERVICE_DISABLED'])('403 %s says the Calendar API is not enabled, with the reason kept', (reason) => {
    const p = describeCalendarError(new CalendarTransientError('x', 403, reason));
    expect(p.message).toBe(API_OFF);
    expect(p).toMatchObject({ status: 403, reason });
  });

  it('an auth error with insufficientPermissions says the scope was not granted', () => {
    const p = describeCalendarError(new CalendarAuthError('refused', 403, 'insufficientPermissions'));
    expect(p.message).toBe(SCOPE);
    expect(p.reason).toBe('insufficientPermissions');
  });

  it('any other auth error (revoked, no token) says the same about permission', () => {
    expect(describeCalendarError(new CalendarAuthError()).message).toBe(SCOPE);
    expect(describeCalendarError(new CalendarAuthError('x', 401, '')).message).toBe(SCOPE);
  });

  it('an api-disabled reason wins even on an auth error', () => {
    expect(describeCalendarError(new CalendarAuthError('x', 403, 'accessNotConfigured')).message).toBe(API_OFF);
  });

  it('a network TypeError, a timeout and an abort say Google could not be reached', () => {
    expect(describeCalendarError(new TypeError('Failed to fetch')).message).toBe(NETWORK);
    expect(describeCalendarError(new DOMException('signal timed out', 'TimeoutError')).message).toBe(NETWORK);
    expect(describeCalendarError(new DOMException('aborted', 'AbortError')).message).toBe(NETWORK);
  });

  it('anything else shows the status and reason, never the "couldn\'t reach" text', () => {
    const p = describeCalendarError(new CalendarTransientError('boom', 500, 'backendError'));
    expect(p.message).toBe('Google Calendar returned an error (500 backendError).');
    expect(p.message).not.toContain("Couldn't reach");
    expect(describeCalendarError(new CalendarHttpError('x', 404, '')).message).toBe('Google Calendar returned an error (404).');
    expect(describeCalendarError(new Error('odd')).message).toBe('Google Calendar returned an error (odd).');
    expect(describeCalendarError('weird').message).toBe('Google Calendar returned an error.');
  });
});
