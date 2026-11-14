import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOCK } from '../core/clock';
import { GisAuthService } from './auth.service';

const T0 = Date.UTC(2026, 10, 14, 12);
const PROFILE_KEY = 'iqra.profile';
const PROFILE = { name: 'Amina', email: 'amina@example.test' };

interface TokenConfig {
  callback: (response: { access_token?: string; expires_in?: number; error?: string }) => void;
}

let now: number;
const clock = { now: () => now };
let prompts: string[];

/** Stands in for the GIS script: window.google exists, so the loader adds no script tag. */
function stubGis(): void {
  prompts = [];
  (window as unknown as { google: unknown }).google = {
    accounts: {
      oauth2: {
        initTokenClient: (config: TokenConfig) => ({
          requestAccessToken: (options: { prompt?: string }) => {
            prompts.push(options.prompt ?? '');
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
    expect(prompts).toEqual(['consent']);
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
});
