import { environment } from '../../environments/environment';
import { AuthCancelledError, EXPIRY_MARGIN_MS, SILENT_TIMEOUT_MS, loadGis, type Grant } from './auth.service';

/**
 * One Google token request for a single extra scope, on its own token client so the sign-in
 * request and its state are untouched. Lazy: only reminders use it.
 */
export async function requestScopeGrant(scope: string, now: () => number, silent: boolean, hint?: string): Promise<Grant> {
  await loadGis();
  return new Promise<Grant>((resolve, reject) => {
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
          else resolve({ token: response.access_token, expiresAt: now() + (response.expires_in ?? 0) * 1000 - EXPIRY_MARGIN_MS });
        }),
    });
    if (silent) timer = setTimeout(() => reject(new AuthCancelledError()), SILENT_TIMEOUT_MS);
    client.requestAccessToken({ ...(silent ? { prompt: 'none' } : {}), ...(hint ? { hint } : {}) });
  });
}
