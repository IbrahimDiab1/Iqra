import { Injectable, InjectionToken, OnDestroy, inject, signal } from '@angular/core';
import { CLOCK } from '../core/clock';
import { COPY } from '../ui/copy';
import { ToastService } from '../ui/toast.service';
import { AuthApi, AuthCancelledError, EXPIRY_MARGIN_MS, RENEW_LEAD_MS, RENEW_RETRY_MS, SILENT_TIMEOUT_MS, type AuthState, type Profile } from './auth.service';

/** What the Android system hands back after Google sign-in or a scope grant. */
export interface NativeGrant {
  token: string;
  /** How long the token lasts from now. */
  lifetimeMs: number;
  profile: Profile;
}

/**
 * Google sign-in and scope grants through the Android system (Credential Manager and the authorization API), because
 * Google blocks web sign-in inside a WebView. `silent` asks for the account the app already uses and no dialog.
 */
export interface NativeGoogle {
  login(scopes: string[], opts: { silent: boolean }): Promise<NativeGrant>;
  logout(): Promise<void>;
}

/** The plugin code loads on first use, so the web build never carries it. */
export const NATIVE_GOOGLE = new InjectionToken<NativeGoogle>('native-google', {
  providedIn: 'root',
  factory: () => ({
    login: async (scopes, opts) => (await import('./native-google')).nativeGoogle.login(scopes, opts),
    logout: async () => (await import('./native-google')).nativeGoogle.logout(),
  }),
});

const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/drive.appdata'];
const PROFILE_KEY = 'iqra.profile';
const CANCELLED = /cancel|dismiss|closed|interrupt|abort/i;

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
    // Storage can be blocked; the profile then lasts for this launch only.
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new AuthCancelledError()), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** AuthApi for the Android app: the same contract as the web sign-in, backed by the system account. */
@Injectable()
export class NativeAuthService extends AuthApi implements OnDestroy {
  private readonly clock = inject(CLOCK);
  private readonly google = inject(NATIVE_GOOGLE);
  private readonly toast = inject(ToastService);
  private readonly stateSignal = signal<AuthState>('signed-out');
  private readonly profileSignal = signal<Profile | null>(null);
  private readonly versionSignal = signal(0);
  private readonly lapsedSignal = signal(false);
  readonly state = this.stateSignal.asReadonly();
  readonly profile = this.profileSignal.asReadonly();
  readonly tokenVersion = this.versionSignal.asReadonly();
  readonly lapsed = this.lapsedSignal.asReadonly();

  private accessToken: string | null = null;
  private expiresAt = 0;
  private silent: Promise<boolean> | null = null;
  private renewTimer: ReturnType<typeof setTimeout> | undefined;
  private scopeGrants: Record<string, { token: string; expiresAt: number }> = {};
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

  token(): string | null {
    if (this.accessToken === null) return null;
    if (this.clock.now() >= this.expiresAt) {
      if (this.stateSignal() === 'signed-in') void this.trySilent();
      return null;
    }
    return this.accessToken;
  }

  preload(): void {
    // Nothing to load ahead of time: the system dialog needs no script.
  }

  async signIn(): Promise<void> {
    const grant = await this.request(DRIVE_SCOPES, false);
    this.profileSignal.set(grant.profile);
    writeStoredProfile(grant.profile);
    this.commit(grant);
  }

  /** Same dialog as sign-in; a token for another account than the stored one is dropped with a toast. */
  async reconnect(): Promise<void> {
    const grant = await this.request(DRIVE_SCOPES, false);
    if (!this.isStoredAccount(grant)) return;
    this.commit(grant);
  }

  trySilent(): Promise<boolean> {
    if (!navigator.onLine) return Promise.resolve(false);
    this.silent ??= this.silentRequest().finally(() => (this.silent = null));
    return this.silent;
  }

  private async silentRequest(): Promise<boolean> {
    try {
      const grant = await withTimeout(this.google.login(DRIVE_SCOPES, { silent: true }), SILENT_TIMEOUT_MS * 2);
      if (!this.isStoredAccount(grant, false)) {
        this.silentFailed();
        return false;
      }
      if (!this.profileSignal()) {
        this.profileSignal.set(grant.profile);
        writeStoredProfile(grant.profile);
      }
      this.commit(grant);
      return true;
    } catch {
      this.silentFailed();
      return false;
    }
  }

  signOut(): void {
    clearTimeout(this.renewTimer);
    this.scopeGrants = {};
    this.accessToken = null;
    this.expiresAt = 0;
    this.profileSignal.set(null);
    writeStoredProfile(null);
    this.lapsedSignal.set(false);
    this.stateSignal.set('signed-out');
    this.google.logout().catch(() => undefined);
  }

  markExpired(rejected?: string | null): void {
    if (rejected && this.accessToken !== null && rejected !== this.accessToken) return;
    this.accessToken = null;
    this.expiresAt = 0;
    if (!this.profileSignal()) return;
    if (this.stateSignal() === 'signed-in' && navigator.onLine) void this.trySilent();
    else if (this.stateSignal() !== 'signed-in') this.expire();
  }

  scopeToken(scope: string): string | null {
    const g = this.scopeGrants[scope];
    return g && this.clock.now() < g.expiresAt ? g.token : null;
  }

  async requestScope(scope: string, opts?: { silent?: boolean }): Promise<string> {
    const cached = this.scopeToken(scope);
    if (cached) return cached;
    let grant: NativeGrant;
    try {
      grant = await this.google.login([scope], { silent: opts?.silent === true });
    } catch (e) {
      if (opts?.silent || CANCELLED.test(String((e as Error)?.message ?? e))) throw new AuthCancelledError();
      const { ScopeDeniedError } = await import('./scope-grant');
      throw new ScopeDeniedError((e as Error)?.message || 'Google denied the permission');
    }
    this.scopeGrants[scope] = { token: grant.token, expiresAt: this.clock.now() + grant.lifetimeMs - EXPIRY_MARGIN_MS };
    return grant.token;
  }

  /** The system dialog failed or was closed: a cancellation leaves the state unchanged, anything else is an error. */
  private async request(scopes: string[], silent: boolean): Promise<NativeGrant> {
    try {
      return await this.google.login(scopes, { silent });
    } catch (e) {
      if (e instanceof AuthCancelledError || CANCELLED.test(String((e as Error)?.message ?? e))) throw new AuthCancelledError();
      throw e;
    }
  }

  private isStoredAccount(grant: NativeGrant, warn = true): boolean {
    const stored = this.profileSignal();
    if (!stored || grant.profile.email.toLowerCase() === stored.email.toLowerCase()) return true;
    if (warn) this.toast.show(COPY.sync.wrongAccount(grant.profile.email, stored.email));
    return false;
  }

  private hasValidToken(): boolean {
    return this.accessToken !== null && this.clock.now() < this.expiresAt;
  }

  private silentFailed(): void {
    if (this.stateSignal() === 'signed-out') return;
    if (!navigator.onLine) return;
    if (this.hasValidToken()) {
      this.scheduleRenewal(RENEW_RETRY_MS);
      return;
    }
    this.expire();
  }

  private renewIfDue(): void {
    if (this.stateSignal() !== 'signed-in' || document.visibilityState !== 'visible' || !navigator.onLine) return;
    if (this.clock.now() >= this.expiresAt - RENEW_LEAD_MS) void this.trySilent();
  }

  private scheduleRenewal(delayMs: number): void {
    clearTimeout(this.renewTimer);
    this.renewTimer = setTimeout(() => this.renewIfDue(), Math.max(0, delayMs));
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

  private commit(grant: NativeGrant): void {
    this.accessToken = grant.token;
    this.expiresAt = this.clock.now() + grant.lifetimeMs - EXPIRY_MARGIN_MS;
    this.stateSignal.set('signed-in');
    this.lapsedSignal.set(false);
    this.versionSignal.update((v) => v + 1);
    this.scheduleRenewal(this.expiresAt - RENEW_LEAD_MS - this.clock.now());
  }
}
