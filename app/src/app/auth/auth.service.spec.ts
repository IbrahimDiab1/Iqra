import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOCK } from '../core/clock';
import { AuthCancelledError, GisAuthService } from './auth.service';

const T0 = Date.UTC(2026, 10, 14, 12);
const PROFILE_KEY = 'iqra.profile';
const PROFILE = { name: 'Amina', email: 'amina@example.test' };

interface TokenConfig {
  callback: (response: { access_token?: string; expires_in?: number; error?: string }) => void;
  error_callback: (error: { type: string }) => void;
}

let now: number;
const clock = { now: () => now };
/** Per-test behaviour of the GIS stub: fail with an error_callback type, or never answer. */
let gis: { failWith: string | null; hang: boolean };
let prompts: Array<string | undefined>;

/** Stands in for the GIS script: window.google exists, so the loader adds no script tag. */
function stubGis(): void {
  prompts = [];
  gis = { failWith: null, hang: false };
  (window as unknown as { google: unknown }).google = {
    accounts: {
      oauth2: {
        initTokenClient: (config: TokenConfig) => ({
          requestAccessToken: (options: { prompt?: string } = {}) => {
            prompts.push(options.prompt);
            if (gis.hang) return;
            if (gis.failWith) {
              config.error_callback({ type: gis.failWith });
              return;
            }
            config.callback({ access_token: `token-${prompts.length}`, expires_in: 3600 });
          },
        }),
      },
    },
  };
}

function createService(): GisAuthService {
  TestBed.configureTestingModule({ providers: [GisAuthService, { provide: CLOCK, useValue: clock }] });
  return TestBed.inject(GisAuthService);
}

describe('GisAuthService', () => {
  beforeEach(() => {
    now = T0;
    stubGis();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(PROFILE), { status: 200, headers: { 'Content-Type': 'application/json' } })),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (window as unknown as { google?: unknown }).google;
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('returns the token after signIn resolves and stores the profile', async () => {
    const auth = createService();
    await auth.signIn();
    expect(auth.token()).toBe('token-1');
    expect(auth.state()).toBe('signed-in');
    expect(auth.profile()).toEqual(PROFILE);
    expect(JSON.parse(localStorage.getItem(PROFILE_KEY) ?? 'null')).toEqual(PROFILE);
    expect(prompts).toEqual([undefined]);
  });

  it('expires the token 60 s before its lifetime ends', async () => {
    const auth = createService();
    await auth.signIn();
    now += 3541_000;
    expect(auth.token()).toBeNull();
    expect(auth.state()).toBe('expired');
  });

  it('starts expired when a profile is stored', () => {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(PROFILE));
    const auth = createService();
    expect(auth.state()).toBe('expired');
    expect(auth.profile()).toEqual(PROFILE);
    expect(auth.token()).toBeNull();
  });

  it('signOut clears the profile and sets signed-out', async () => {
    const auth = createService();
    await auth.signIn();
    auth.signOut();
    expect(auth.profile()).toBeNull();
    expect(auth.state()).toBe('signed-out');
    expect(auth.token()).toBeNull();
    expect(localStorage.getItem(PROFILE_KEY)).toBeNull();
  });

  it('reconnect requests a token with an empty prompt and restores signed-in', async () => {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(PROFILE));
    const auth = createService();
    await auth.reconnect();
    expect(prompts).toEqual(['']);
    expect(auth.token()).toBe('token-1');
    expect(auth.state()).toBe('signed-in');
  });

  it('signIn rejects with AuthCancelledError when the popup is closed, and the state stays signed-out', async () => {
    gis.failWith = 'popup_closed';
    const auth = createService();
    await expect(auth.signIn()).rejects.toBeInstanceOf(AuthCancelledError);
    expect(auth.state()).toBe('signed-out');
    expect(auth.token()).toBeNull();
    expect(auth.profile()).toBeNull();
  });

  it('trySilent resolves false when GIS reports an error, and the state is unchanged', async () => {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(PROFILE));
    gis.failWith = 'unknown';
    const auth = createService();
    await expect(auth.trySilent()).resolves.toBe(false);
    expect(prompts).toEqual(['none']);
    expect(auth.state()).toBe('expired');
  });

  it('trySilent resolves false after 10 s when GIS never answers', async () => {
    vi.useFakeTimers();
    localStorage.setItem(PROFILE_KEY, JSON.stringify(PROFILE));
    gis.hang = true;
    const auth = createService();
    const result = auth.trySilent();
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(result).resolves.toBe(false);
    expect(auth.state()).toBe('expired');
  });
});
