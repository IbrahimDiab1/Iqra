import { SETTINGS_COPY } from '../settings/settings-copy';
import { CalendarAuthError, CalendarHttpError } from './calendar-api';

/** What to tell the owner about a failed Calendar call, with the raw status and reason for the log. */
export interface CalendarProblem {
  message: string;
  status?: number;
  reason?: string;
}

/** Google's reasons for a Calendar API that is switched off for the Cloud project. */
const API_DISABLED = new Set(['accessNotConfigured', 'SERVICE_DISABLED']);

/** Turns any error from a Calendar call into one precise message. "Couldn't reach Google" is only for network faults. */
export function describeCalendarError(e: unknown): CalendarProblem {
  const c = SETTINGS_COPY.reminders;
  if (e instanceof CalendarHttpError) {
    const base = { status: e.status, reason: e.reason };
    if (e.reason && API_DISABLED.has(e.reason)) return { message: c.apiDisabled, ...base };
    if (e instanceof CalendarAuthError && e.status === 401) return { message: c.signInAgain, ...base };
    if (e instanceof CalendarAuthError) return { message: c.scopeNotGranted, ...base };
    return { message: c.apiError([e.status, e.reason].filter(Boolean).join(' ')), ...base };
  }
  const name = (e as { name?: string } | null)?.name;
  if (e instanceof TypeError || name === 'TimeoutError' || name === 'AbortError') return { message: c.unreachable };
  return { message: c.apiError((e as { message?: string } | null)?.message ?? '') };
}
