import { environment } from '../../environments/environment';
import { AuthCancelledError, EXPIRY_MARGIN_MS, SILENT_TIMEOUT_MS, loadGis, type Grant } from './auth.service';

/** Tokens for extra scopes (Calendar reminders), kept in memory with their expiry. Lazy: only reminders load this. */
type Clock = { now(): number };
let grants: Record<string, Grant> = {};

export function peek(scope: string, clock: Clock): string | null {
  const grant = grants[scope];
  return grant && clock.now() < grant.expiresAt ? grant.token : null;
}

export function clear(): void {
  grants = {};
}

/**
 * A token for one extra scope, from the cache or from Google. It uses its own token client, so the
 * sign-in request and its state are untouched. Rejects AuthCancelledError when the popup is closed
 * and a plain Error when Google denies the scope.
 */
export async function token(scope: string, clock: Clock, silent = false, hint?: string): Promise<string> {
  const cached = peek(scope, clock);
  if (cached) return cached;
  await loadGis();
  const grant = await new Promise<Grant>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = (fn: () => void): void => {
      clearTimeout(timer);
      fn();
    };
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: environment.googleClientId,
      scope,
      error_callback: () => done(() => reject(new AuthCancelledError())),
      callback: (response) =>
        done(() => {
          if (response.error || !response.access_token) reject(new Error(response.error ?? 'No access token'));
          else resolve({ token: response.access_token, expiresAt: clock.now() + (response.expires_in ?? 0) * 1000 - EXPIRY_MARGIN_MS });
        }),
    });
    if (silent) timer = setTimeout(() => reject(new AuthCancelledError()), SILENT_TIMEOUT_MS);
    client.requestAccessToken({ ...(silent ? { prompt: 'none' } : {}), ...(hint ? { hint } : {}) });
  });
  grants[scope] = grant;
  return grant.token;
}
