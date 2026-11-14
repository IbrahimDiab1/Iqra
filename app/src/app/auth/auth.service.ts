import { Injectable, Signal, inject, signal } from '@angular/core';
import { environment } from '../../environments/environment';
import { CLOCK } from '../core/clock';

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
  /** The sync engine calls this on DriveAuthError. */
  abstract markExpired(): void;
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
const EXPIRY_MARGIN_MS = 60_000;
/** A silent token request that GIS has not answered by now counts as failed. */
const SILENT_TIMEOUT_MS = 10_000;

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
  requestAccessToken(options: { prompt?: string }): void;
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

interface Grant {
  token: string;
  expiresAt: number;
}

let gisLoad: Promise<void> | null = null;

/** Adds the Google Identity Services script once. Resolves at once if it is already present. */
function loadGis(): Promise<void> {
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
export class GisAuthService extends AuthApi {
  private readonly clock = inject(CLOCK);
  private readonly stateSignal = signal<AuthState>('signed-out');
  private readonly profileSignal = signal<Profile | null>(null);
  readonly state = this.stateSignal.asReadonly();
  readonly profile = this.profileSignal.asReadonly();

  private accessToken: string | null = null;
  private expiresAt = 0;
  private client: TokenClient | null = null;
  private pending: Pending | null = null;

  constructor() {
    super();
    const stored = readStoredProfile();
    if (stored) {
      this.profileSignal.set(stored);
      this.stateSignal.set('expired');
    }
  }

  token(): string | null {
    if (this.accessToken === null) return null;
    if (this.clock.now() >= this.expiresAt) {
      this.markExpired();
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

  async reconnect(): Promise<void> {
    this.commit(await this.requestGrant(''));
  }

  async trySilent(): Promise<boolean> {
    try {
      this.commit(await this.requestGrant('none', SILENT_TIMEOUT_MS));
      return true;
    } catch {
      return false;
    }
  }

  signOut(): void {
    this.accessToken = null;
    this.expiresAt = 0;
    this.profileSignal.set(null);
    writeStoredProfile(null);
    this.stateSignal.set('signed-out');
  }

  markExpired(): void {
    this.accessToken = null;
    this.expiresAt = 0;
    if (this.profileSignal()) this.stateSignal.set('expired');
  }

  private commit(grant: Grant): void {
    this.accessToken = grant.token;
    this.expiresAt = grant.expiresAt;
    this.stateSignal.set('signed-in');
  }

  /** prompt undefined leaves the prompt to GIS, which shows consent only when needed. */
  private async requestGrant(prompt: string | undefined, timeoutMs?: number): Promise<Grant> {
    const client = await this.ensureClient();
    return new Promise<Grant>((resolve, reject) => {
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
      client.requestAccessToken(prompt === undefined ? {} : { prompt });
    });
  }

  private async ensureClient(): Promise<TokenClient> {
    if (this.client) return this.client;
    await loadGis();
    this.client = window.google!.accounts.oauth2.initTokenClient({
      client_id: environment.googleClientId,
      scope: SCOPES,
      error_callback: () => {
        const pending = this.pending;
        this.pending = null;
        pending?.reject(new AuthCancelledError());
      },
      callback: (response) => {
        const pending = this.pending;
        this.pending = null;
        if (!pending) return;
        if (response.error || !response.access_token) {
          pending.reject(new Error(response.error ?? 'No access token'));
          return;
        }
        pending.resolve({
          token: response.access_token,
          expiresAt: this.clock.now() + (response.expires_in ?? 0) * 1000 - EXPIRY_MARGIN_MS,
        });
      },
    });
    return this.client;
  }

  private async fetchProfile(token: string): Promise<Profile> {
    const res = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Profile request failed: ${res.status}`);
    const json = (await res.json()) as { name?: string; email?: string; picture?: string };
    return { name: json.name ?? '', email: json.email ?? '', picture: json.picture };
  }
}
