import { Injectable, OnDestroy, Signal, inject, signal } from '@angular/core';
import { environment } from '../../environments/environment';
import { CLOCK } from '../core/clock';
import { COPY } from '../ui/copy';
import { ToastService } from '../ui/toast.service';

export type AuthState = 'signed-out' | 'signed-in' | 'expired';
export interface Profile {
  name: string;
  email: string;
  picture?: string;
}

export abstract class AuthApi {
  abstract state: Signal<AuthState>;
  abstract profile: Signal<Profile | null>;
  /** Null when expired or signed out. */
  abstract token(): string | null;
  /** Call only from a user gesture. */
  abstract signIn(): Promise<void>;
  /** Call only from a user gesture; prompt ''. */
  abstract reconnect(): Promise<void>;
  /** No gesture. Resolves false when a popup would be needed. */
  abstract trySilent(): Promise<boolean>;
  abstract signOut(): void;
  /**
   * The sync engine and the upload queue call this when Google rejected the token (a 401). The real service tries one
   * silent renewal first and turns the state to expired only when that fails.
   */
  abstract markExpired(rejected?: string | null): void;
  /** Counts every new token (sign-in, reconnect, silent renewal), so work that was waiting for one can retry. */
  abstract tokenVersion: Signal<number>;
  /**
   * True only when the session really lapsed: a silent renewal failed while online (or Google rejected the token and
   * renewal failed). A page that starts with a stored profile is `expired` but not yet `lapsed`, and offline it never is:
   * the Reconnect bar follows this, not `state`.
   */
  abstract lapsed: Signal<boolean>;
  /**
   * Incremental grant for one extra scope (Calendar reminders), separate from the sign-in token.
   * Call from a user gesture, or with `silent` for a no-popup attempt. Rejects AuthCancelledError
   * when the popup is closed and another Error when Google denies the scope.
   */
  abstract requestScope(scope: string, opts?: { silent?: boolean }): Promise<string>;
  /** A valid cached token for the scope, or null. Never opens a popup. */
  abstract scopeToken(scope: string): string | null;
  /** Starts loading the sign-in script, so a later popup request is not delayed by the network. */
  abstract preload(): void;
}

export const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.appdata',
].join(' ');

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
const PROFILE_KEY = 'iqra.profile';
/** The token is treated as expired this long before Google expires it. */
export const EXPIRY_MARGIN_MS = 60_000;
/** A silent token request that GIS has not answered by now counts as failed. */
export const SILENT_TIMEOUT_MS = 10_000;
const PROFILE_TIMEOUT_MS = 15_000;
/** A fresh token is requested this long before the current one reads as expired. */
export const RENEW_LEAD_MS = 5 * 60_000;
/** After a failed renewal, the next try comes this much later (while the token is still good). */
export const RENEW_RETRY_MS = 60_000;

/** The user closed or never opened the Google sign-in popup. The state is left unchanged. */
export class AuthCancelledError extends Error {
  constructor() {
    super('Sign-in was cancelled');
    this.name = 'AuthCancelledError';
  }
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}

interface TokenClient {
  requestAccessToken(options: { prompt?: string; hint?: string }): void;
}

interface GisTokenConfig {
  client_id: string;
  scope: string;
  callback: (response: TokenResponse) => void;
  error_callback: (error: { type: string }) => void;
}

interface Pending {
  resolve: (grant: Grant) => void;
  reject: (error: Error) => void;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: { initTokenClient(config: GisTokenConfig): TokenClient };
      };
    };
  }
}

export interface Grant {
  token: string;
  expiresAt: number;
}

let gisLoad: Promise<void> | null = null;

/** Adds the Google Identity Services script once. Resolves at once if it is already present. */
export function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  gisLoad ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      gisLoad = null;
      script.remove();
      reject(new Error('Could not load Google sign-in'));
    };
    document.head.appendChild(script);
  });
  return gisLoad;
}

function readStoredProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? (JSON.parse(raw) as Profile) : null;
  } catch {
    return null;
  }
}

function writeStoredProfile(profile: Profile | null): void {
  try {
    if (profile) localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    else localStorage.removeItem(PROFILE_KEY);
  } catch {
    // Storage can be blocked; the profile then lasts for this page load only.
  }
}

/** Google Identity Services token client. The access token is kept in memory only. */
@Injectable()
export class GisAuthService extends AuthApi implements OnDestroy {
  private readonly clock = inject(CLOCK);
  private readonly toast = inject(ToastService);
  private readonly stateSignal = signal<AuthState>('signed-out');
  private readonly profileSignal = signal<Profile | null>(null);
  private readonly versionSignal = signal(0);
  private readonly lapsedSignal = signal(false);
  readonly lapsed = this.lapsedSignal.asReadonly();
  readonly state = this.stateSignal.asReadonly();
  readonly profile = this.profileSignal.asReadonly();
  readonly tokenVersion = this.versionSignal.asReadonly();

  private accessToken: string | null = null;
  private expiresAt = 0;
  private pending: Pending | null = null;
  private silent: Promise<boolean> | null = null;
  private renewTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly onVisible = (): void => {
    if (document.visibilityState === 'visible') this.renewIfDue();
  };
  private readonly onOnline = (): void => this.renewIfDue();

  constructor() {
    super();
    const stored = readStoredProfile();
    if (stored) {
      this.profileSignal.set(stored);
      this.stateSignal.set('expired');
    }
    document.addEventListener('visibilitychange', this.onVisible);
    window.addEventListener('online', this.onOnline);
  }

  ngOnDestroy(): void {
    clearTimeout(this.renewTimer);
    document.removeEventListener('visibilitychange', this.onVisible);
    window.removeEventListener('online', this.onOnline);
  }

  /**
   * The access token, or null when there is none or it reads as expired. An expired token starts one silent
   * renewal, so the state never has to flip just because the clock ran out; it turns expired only if the renewal fails.
   */
  token(): string | null {
    if (this.accessToken === null) return null;
    if (this.clock.now() >= this.expiresAt) {
      if (this.stateSignal() === 'signed-in') void this.trySilent();
      return null;
    }
    return this.accessToken;
  }

  async signIn(): Promise<void> {
    const grant = await this.requestGrant(undefined);
    const profile = await this.fetchProfile(grant.token);
    this.profileSignal.set(profile);
    writeStoredProfile(profile);
    this.commit(grant);
  }

  preload(): void {
    loadGis().catch(() => undefined);
  }

  /**
   * Asks for the stored account. A token for another account is discarded: the state stays
   * expired and a toast says which account Iqra is linked to.
   */
  async reconnect(): Promise<void> {
    const stored = this.profileSignal();
    const grant = await this.requestGrant('', undefined, stored?.email);
    if (stored && !(await this.isStoredAccount(grant.token, stored))) return;
    this.commit(grant);
  }

  /**
   * A token without a popup (prompt 'none', the stored account as hint). Offline it does nothing. A failure changes the
   * state only when there is no usable token any more; while the current token is still good it changes nothing.
   */
  trySilent(): Promise<boolean> {
    if (!navigator.onLine) return Promise.resolve(false);
    this.silent ??= this.silentRequest().finally(() => (this.silent = null));
    return this.silent;
  }

  private async silentRequest(): Promise<boolean> {
    const stored = this.profileSignal();
    try {
      const grant = await this.requestGrant('none', SILENT_TIMEOUT_MS, stored?.email);
      if (stored && !(await this.isStoredAccount(grant.token, stored))) {
        this.silentFailed();
        return false;
      }
      this.commit(grant);
      return true;
    } catch {
      this.silentFailed();
      return false;
    }
  }

  private hasValidToken(): boolean {
    return this.accessToken !== null && this.clock.now() < this.expiresAt;
  }

  /** A renewal failed: expired only when the token is really gone, otherwise try again soon. */
  private silentFailed(): void {
    if (this.stateSignal() === 'signed-out') return;
    // Failing because the connection dropped says nothing about the session.
    if (!navigator.onLine) return;
    if (this.hasValidToken()) {
      this.scheduleRenewal(RENEW_RETRY_MS);
      return;
    }
    this.expire();
  }

  /** Renews now when the token is near its end (or gone), the tab is visible and the device is online. */
  private renewIfDue(): void {
    if (this.stateSignal() !== 'signed-in' || document.visibilityState !== 'visible' || !navigator.onLine) return;
    if (this.clock.now() >= this.expiresAt - RENEW_LEAD_MS) void this.trySilent();
  }

  private scheduleRenewal(delayMs: number): void {
    clearTimeout(this.renewTimer);
    this.renewTimer = setTimeout(() => this.renewIfDue(), Math.max(0, delayMs));
  }

  /** The scope code and its token cache load on first use; before that no scope token exists. */
  private scopes?: typeof import('./scope-grant');

  scopeToken(scope: string): string | null {
    return this.scopes?.peek(scope, this.clock) ?? null;
  }

  async requestScope(scope: string, opts?: { silent?: boolean }): Promise<string> {
    this.scopes ??= await import('./scope-grant');
    return this.scopes.token(scope, this.clock, opts?.silent, this.profileSignal()?.email);
  }

  signOut(): void {
    clearTimeout(this.renewTimer);
    this.scopes?.clear();
    this.accessToken = null;
    this.expiresAt = 0;
    this.profileSignal.set(null);
    writeStoredProfile(null);
    this.lapsedSignal.set(false);
    this.stateSignal.set('signed-out');
  }

  /** Google rejected the token: drop it and try one silent renewal; the state turns expired only if that fails. */
  markExpired(rejected?: string | null): void {
    // A 401 for a token that has since been replaced (a renewal landed meanwhile) says nothing about the current one.
    if (rejected && this.accessToken !== null && rejected !== this.accessToken) return;
    this.accessToken = null;
    this.expiresAt = 0;
    if (!this.profileSignal()) return;
    if (this.stateSignal() === 'signed-in' && navigator.onLine) void this.trySilent();
    else if (this.stateSignal() !== 'signed-in') this.expire();
  }

  private expire(): void {
    clearTimeout(this.renewTimer);
    this.accessToken = null;
    this.expiresAt = 0;
    if (this.profileSignal()) {
      this.stateSignal.set('expired');
      this.lapsedSignal.set(true);
    }
  }

  private commit(grant: Grant): void {
    this.accessToken = grant.token;
    this.expiresAt = grant.expiresAt;
    this.stateSignal.set('signed-in');
    this.lapsedSignal.set(false);
    this.versionSignal.update((v) => v + 1);
    this.scheduleRenewal(grant.expiresAt - RENEW_LEAD_MS - this.clock.now());
  }

  /** prompt undefined leaves the prompt to GIS, which shows consent only when needed. */
  private async requestGrant(prompt: string | undefined, timeoutMs?: number, hint?: string): Promise<Grant> {
    await loadGis();
    return new Promise<Grant>((resolve, reject) => {
      // A new request settles the one before it, so no promise is left hanging.
      const previous = this.pending;
      this.pending = null;
      previous?.reject(new AuthCancelledError());
      let timer: ReturnType<typeof setTimeout> | undefined;
      const pending: Pending = {
        resolve: (grant) => {
          clearTimeout(timer);
          resolve(grant);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      this.pending = pending;
      if (timeoutMs !== undefined) {
        timer = setTimeout(() => {
          if (this.pending === pending) this.pending = null;
          reject(new AuthCancelledError());
        }, timeoutMs);
      }
      // One client per request, its callbacks bound to this request: a late reply to an
      // abandoned request cannot settle or cancel a newer one.
      const settle = (fn: (p: Pending) => void): void => {
        if (this.pending !== pending) return;
        this.pending = null;
        fn(pending);
      };
      const client = window.google!.accounts.oauth2.initTokenClient({
        client_id: environment.googleClientId,
        scope: SCOPES,
        error_callback: () => settle((p) => p.reject(new AuthCancelledError())),
        callback: (response) =>
          settle((p) => {
            if (response.error || !response.access_token) {
              p.reject(new Error(response.error ?? 'No access token'));
              return;
            }
            p.resolve({
              token: response.access_token,
              expiresAt: this.clock.now() + (response.expires_in ?? 0) * 1000 - EXPIRY_MARGIN_MS,
            });
          }),
      });
      const options: { prompt?: string; hint?: string } = {};
      if (prompt !== undefined) options.prompt = prompt;
      if (hint) options.hint = hint;
      client.requestAccessToken(options);
    });
  }

  /** False, with a toast, when the token belongs to another account than the stored profile. */
  private async isStoredAccount(token: string, stored: Profile): Promise<boolean> {
    const picked = await this.fetchProfile(token);
    if (picked.email.toLowerCase() === stored.email.toLowerCase()) return true;
    this.toast.show(COPY.sync.wrongAccount(picked.email, stored.email));
    return false;
  }

  private async fetchProfile(token: string): Promise<Profile> {
    // Bounded: a silent renewal waits on this check, and a request a phone dropped never settles by itself.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), PROFILE_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${token}` }, signal: abort.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`Profile request failed: ${res.status}`);
    const json = (await res.json()) as { name?: string; email?: string; picture?: string };
    return { name: json.name ?? '', email: json.email ?? '', picture: json.picture };
  }
}
