import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOCK } from '../core/clock';
import { COPY } from '../ui/copy';
import { ToastService } from '../ui/toast.service';
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
let hints: Array<string | undefined>;
let configs: TokenConfig[];

/** Stands in for the GIS script: window.google exists, so the loader adds no script tag. */
function stubGis(): void {
  prompts = [];
  hints = [];
  configs = [];
  gis = { failWith: null, hang: false };
  (window as unknown as { google: unknown }).google = {
    accounts: {
      oauth2: {
        initTokenClient: (config: TokenConfig) => {
          configs.push(config);
          return {
            requestAccessToken: (options: { prompt?: string; hint?: string } = {}) => {
              prompts.push(options.prompt);
              hints.push(options.hint);
              if (gis.hang) return;
              if (gis.failWith) {
                config.error_callback({ type: gis.failWith });
                return;
              }
              config.callback({ access_token: `token-${prompts.length}`, expires_in: 3600 });
            },
          };
        },
      },
    },
  };
}

function createService(): GisAuthService {
  TestBed.configureTestingModule({
    providers: [GisAuthService, { provide: CLOCK, useValue: clock }],
  });
  return TestBed.inject(GisAuthService);
}

describe('GisAuthService', () => {
  beforeEach(() => {
    now = T0;
    stubGis();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(PROFILE), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
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

  it('a token reads as gone 60 s before its lifetime ends, and the state stays signed-in while a silent renewal can still work', async () => {
    const auth = createService();
    await auth.signIn();
    now += 3541_000;
    expect(auth.token()).toBeNull();
    expect(auth.state()).toBe('signed-in');
    // Reading the expired token starts one silent renewal; it works here, so the state never flips.
    await vi.waitFor(() => expect(auth.token()).toBe('token-2'));
    expect(auth.state()).toBe('signed-in');
    expect(prompts).toEqual([undefined, 'none']);
  });

  it('a token that expired and could not be renewed silently turns the state to expired', async () => {
    const auth = createService();
    await auth.signIn();
    gis.failWith = 'popup_failed_to_open';
    now += 3541_000;
    expect(auth.token()).toBeNull();
    await vi.waitFor(() => expect(auth.state()).toBe('expired'));
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

  it('reconnect passes the stored email as hint', async () => {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(PROFILE));
    const auth = createService();
    await auth.reconnect();
    expect(hints).toEqual([PROFILE.email]);
  });

  it('reconnect discards a token for another account, stays expired and toasts', async () => {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(PROFILE));
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ name: 'Other', email: 'other@example.test' }), {
            status: 200,
          }),
      ),
    );
    const auth = createService();
    const toast = TestBed.inject(ToastService);

    await auth.reconnect();

    expect(auth.token()).toBeNull();
    expect(auth.state()).toBe('expired');
    expect(auth.profile()).toEqual(PROFILE);
    expect(toast.current()?.message).toBe(
      COPY.sync.wrongAccount('other@example.test', PROFILE.email),
    );
  });

  it('a new token request rejects the one still pending', async () => {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(PROFILE));
    gis.hang = true;
    const auth = createService();
    const first = auth.reconnect();
    const firstSettled = first.then(
      () => 'resolved',
      (e: unknown) => (e instanceof AuthCancelledError ? 'cancelled' : 'other'),
    );
    await vi.waitFor(() => expect(prompts).toHaveLength(1));
    gis.hang = false;

    await auth.reconnect();

    expect(await firstSettled).toBe('cancelled');
    expect(auth.state()).toBe('signed-in');
  });

  it('a late reply to an abandoned silent request does not cancel a newer reconnect', async () => {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(PROFILE));
    gis.hang = true;
    const auth = createService();
    const silent = auth.trySilent();
    await vi.waitFor(() => expect(configs).toHaveLength(1));
    const reconnect = auth.reconnect();
    const reconnectSettled = reconnect.then(
      () => 'resolved',
      () => 'rejected',
    );
    await vi.waitFor(() => expect(configs).toHaveLength(2));
    await expect(silent).resolves.toBe(false);

    // The abandoned silent request answers late, first with an error, then with a token.
    configs[0].error_callback({ type: 'popup_closed' });
    configs[0].callback({ access_token: 'stale', expires_in: 3600 });
    // The user's popup then answers.
    configs[1].callback({ access_token: 'fresh', expires_in: 3600 });

    expect(await reconnectSettled).toBe('resolved');
    expect(auth.token()).toBe('fresh');
    expect(auth.state()).toBe('signed-in');
  });

  it('trySilent discards a token for another account, stays expired and toasts', async () => {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(PROFILE));
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ name: 'Other', email: 'other@example.test' }), {
            status: 200,
          }),
      ),
    );
    const auth = createService();
    const toast = TestBed.inject(ToastService);

    await expect(auth.trySilent()).resolves.toBe(false);

    expect(auth.token()).toBeNull();
    expect(auth.state()).toBe('expired');
    expect(toast.current()?.message).toBe(
      COPY.sync.wrongAccount('other@example.test', PROFILE.email),
    );
  });

  it('trySilent accepts a token for the stored account', async () => {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(PROFILE));
    const auth = createService();
    await expect(auth.trySilent()).resolves.toBe(true);
    expect(auth.state()).toBe('signed-in');
  });

  describe('lapsed (the reconnect bar condition)', () => {
    const setOnline = (online: boolean) => vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online);
    afterEach(() => vi.restoreAllMocks());

    it('a stored profile starts expired but not lapsed: nothing has been tried yet', () => {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(PROFILE));
      const auth = createService();
      expect(auth.state()).toBe('expired');
      expect(auth.lapsed()).toBe(false);
    });

    it('stays not lapsed while the page starts offline, however long it waits', async () => {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(PROFILE));
      setOnline(false);
      const auth = createService();
      await expect(auth.trySilent()).resolves.toBe(false);
      expect(auth.lapsed()).toBe(false);
      expect(prompts).toEqual([]);
    });

    it('becomes lapsed only after a silent renewal failed while online, and clears on the next token', async () => {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(PROFILE));
      const auth = createService();
      gis.failWith = 'popup_failed_to_open';
      await auth.trySilent();
      expect(auth.lapsed()).toBe(true);
      gis.failWith = null;
      await auth.reconnect();
      expect(auth.lapsed()).toBe(false);
      expect(auth.state()).toBe('signed-in');
    });

    it('a silent request that failed because the device went offline does not lapse', async () => {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(PROFILE));
      const auth = createService();
      gis.failWith = 'popup_failed_to_open';
      const original = configs.length;
      const attempt = auth.trySilent();
      setOnline(false);
      await attempt;
      expect(configs.length).toBeGreaterThan(original);
      expect(auth.lapsed()).toBe(false);
    });

    it('a rejected token that cannot be renewed lapses; sign-out clears it', async () => {
      const auth = createService();
      await auth.signIn();
      gis.failWith = 'popup_failed_to_open';
      auth.markExpired();
      await vi.waitFor(() => expect(auth.lapsed()).toBe(true));
      auth.signOut();
      expect(auth.lapsed()).toBe(false);
    });
  });

  describe('silent renewal', () => {
    const RENEW_AT_MS = (3541 - 300 - 1) * 1000; // 5 minutes before the token reads as gone
    /** Moves the app clock and the timers together. */
    async function advance(ms: number): Promise<void> {
      now += ms;
      await vi.advanceTimersByTimeAsync(ms);
    }
    const setVisible = (visible: boolean) => {
      Object.defineProperty(document, 'visibilityState', { value: visible ? 'visible' : 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    const setOnline = (online: boolean) => vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online);

    beforeEach(() => {
      vi.useFakeTimers();
      localStorage.setItem(PROFILE_KEY, JSON.stringify(PROFILE));
      setVisible(true);
    });
    afterEach(() => {
      setVisible(true);
      vi.restoreAllMocks();
    });

    it('asks for a fresh token about five minutes before expiry, silently and with the account hint', async () => {
      const auth = createService();
      await auth.signIn();
      await advance(RENEW_AT_MS - 1000);
      expect(prompts).toEqual([undefined]);
      await advance(2000);
      expect(prompts).toEqual([undefined, 'none']);
      expect(hints.at(-1)).toBe(PROFILE.email);
      expect(auth.token()).toBe('token-2');
      expect(auth.state()).toBe('signed-in');
      // ...and the new token is renewed in turn.
      await advance(RENEW_AT_MS + 1000);
      expect(prompts).toHaveLength(3);
    });

    it('waits while the tab is hidden and renews as soon as it is visible again', async () => {
      const auth = createService();
      await auth.signIn();
      setVisible(false);
      await advance(RENEW_AT_MS + 5000);
      expect(prompts).toEqual([undefined]);
      expect(auth.state()).toBe('signed-in');
      setVisible(true);
      await advance(0);
      expect(prompts).toEqual([undefined, 'none']);
    });

    it('a failed renewal while the token is still good changes nothing visible, and tries again a minute later', async () => {
      const auth = createService();
      const toast = TestBed.inject(ToastService);
      await auth.signIn();
      gis.failWith = 'popup_failed_to_open';
      await advance(RENEW_AT_MS + 1000);
      expect(prompts).toHaveLength(2);
      expect(auth.state()).toBe('signed-in');
      expect(auth.token()).toBe('token-1');
      expect(toast.current()).toBeNull();
      gis.failWith = null;
      await advance(60_000);
      expect(prompts).toHaveLength(3);
      expect(auth.token()).toBe('token-3');
    });

    it('only when renewal kept failing until the token ran out does the state turn expired', async () => {
      const auth = createService();
      await auth.signIn();
      gis.failWith = 'popup_failed_to_open';
      await advance(RENEW_AT_MS + 1000);
      expect(auth.state()).toBe('signed-in');
      await advance(5 * 60_000);
      expect(auth.state()).toBe('expired');
      expect(auth.token()).toBeNull();
      expect(TestBed.inject(ToastService).current()).toBeNull();
    });

    it('offline it neither asks nor flips the state, and renews when the connection returns', async () => {
      const auth = createService();
      await auth.signIn();
      setOnline(false);
      await advance(3541_000 + 120_000);
      expect(prompts).toEqual([undefined]);
      expect(auth.token()).toBeNull();
      expect(auth.state()).toBe('signed-in');
      setOnline(true);
      window.dispatchEvent(new Event('online'));
      await advance(0);
      expect(prompts).toEqual([undefined, 'none']);
      expect(auth.token()).toBe('token-2');
    });

    it('a rejected token (a 401 from Google) tries one silent renewal first and keeps the state if it works', async () => {
      const auth = createService();
      await auth.signIn();
      auth.markExpired();
      expect(auth.state()).toBe('signed-in');
      await advance(0);
      expect(prompts).toEqual([undefined, 'none']);
      expect(auth.token()).toBe('token-2');
      expect(auth.state()).toBe('signed-in');
    });

    it('a 401 for a token that was already replaced leaves the newer token alone', async () => {
      const auth = createService();
      await auth.signIn();
      await advance(RENEW_AT_MS + 1000);
      expect(auth.token()).toBe('token-2');
      auth.markExpired('token-1');
      await advance(0);
      expect(auth.token()).toBe('token-2');
      expect(prompts).toEqual([undefined, 'none']);
      auth.markExpired('token-2');
      await advance(0);
      expect(prompts).toEqual([undefined, 'none', 'none']);
    });

    it('a rejected token that cannot be renewed turns the state to expired', async () => {
      const auth = createService();
      await auth.signIn();
      gis.failWith = 'popup_failed_to_open';
      auth.markExpired();
      await advance(0);
      expect(auth.state()).toBe('expired');
    });

    it('counts every new token, so waiting work can retry', async () => {
      const auth = createService();
      const before = auth.tokenVersion();
      await auth.signIn();
      expect(auth.tokenVersion()).toBe(before + 1);
      await auth.reconnect();
      expect(auth.tokenVersion()).toBe(before + 2);
    });

    it('never asks while signed out', async () => {
      localStorage.clear();
      const auth = createService();
      setVisible(false);
      setVisible(true);
      await advance(10 * 3600_000);
      expect(prompts).toEqual([]);
      expect(auth.state()).toBe('signed-out');
    });

    it('stops renewing after sign out', async () => {
      const auth = createService();
      await auth.signIn();
      auth.signOut();
      await advance(RENEW_AT_MS + 10_000);
      expect(prompts).toEqual([undefined]);
    });
  });
});
