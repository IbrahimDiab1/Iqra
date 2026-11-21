import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOCK } from '../core/clock';
import { AuthCancelledError, SCOPES } from './auth.service';
import { NATIVE_GOOGLE, NativeAuthService, type NativeGoogle, type NativeGrant } from './native-auth.service';

const PROFILE = { name: 'Amina', email: 'amina@example.test' };
const DRIVE = ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/drive.appdata'];
const CAL = 'https://www.googleapis.com/auth/calendar.app.created';

let now: number;
let calls: Array<{ scopes: string[]; silent: boolean }>;
let google: NativeGoogle & { fail: Error | null; logout: ReturnType<typeof vi.fn> };

function grant(n: number): NativeGrant {
  return { token: `native-${n}`, lifetimeMs: 3_600_000, profile: PROFILE };
}

function create(): NativeAuthService {
  TestBed.configureTestingModule({
    providers: [NativeAuthService, { provide: CLOCK, useValue: { now: () => now } }, { provide: NATIVE_GOOGLE, useValue: google }],
  });
  return TestBed.inject(NativeAuthService);
}

describe('NativeAuthService', () => {
  beforeEach(() => {
    now = Date.UTC(2026, 10, 14, 12);
    calls = [];
    localStorage.clear();
    google = {
      fail: null,
      login: async (scopes, opts) => {
        calls.push({ scopes, silent: opts.silent });
        if (google.fail) throw google.fail;
        return grant(calls.length);
      },
      logout: vi.fn(async () => undefined),
    };
  });
  afterEach(() => TestBed.resetTestingModule());

  it('starts signed out without a stored profile', () => {
    const auth = create();
    expect(auth.state()).toBe('signed-out');
    expect(auth.token()).toBeNull();
  });

  it('starts expired (not lapsed) with a stored profile', () => {
    localStorage.setItem('iqra.profile', JSON.stringify(PROFILE));
    const auth = create();
    expect(auth.state()).toBe('expired');
    expect(auth.lapsed()).toBe(false);
    expect(auth.profile()).toEqual(PROFILE);
  });

  it('signs in with the Drive scopes through the system dialog and stores the profile', async () => {
    const auth = create();
    await auth.signIn();
    expect(calls).toEqual([{ scopes: DRIVE, silent: false }]);
    expect(auth.state()).toBe('signed-in');
    expect(auth.token()).toBe('native-1');
    expect(auth.profile()).toEqual(PROFILE);
    expect(auth.tokenVersion()).toBe(1);
    expect(JSON.parse(localStorage.getItem('iqra.profile')!)).toEqual(PROFILE);
  });

  it('keeps the same Drive scopes as the web sign-in', () => {
    for (const s of DRIVE) expect(SCOPES).toContain(s);
  });

  it('leaves the state alone when the sign-in is cancelled', async () => {
    google.fail = new Error('User cancelled');
    const auth = create();
    await expect(auth.signIn()).rejects.toBeInstanceOf(AuthCancelledError);
    expect(auth.state()).toBe('signed-out');
  });

  it('renews without a dialog when the token has expired', async () => {
    const auth = create();
    await auth.signIn();
    now += 3_600_000;
    expect(auth.token()).toBeNull();
    await vi.waitFor(() => expect(auth.token()).toBe('native-2'));
    expect(calls[1]).toEqual({ scopes: DRIVE, silent: true });
    expect(auth.tokenVersion()).toBe(2);
  });

  it('trySilent resolves false and expires the session when the system needs the reader', async () => {
    localStorage.setItem('iqra.profile', JSON.stringify(PROFILE));
    google.fail = new Error('No credentials');
    const auth = create();
    expect(await auth.trySilent()).toBe(false);
    expect(auth.state()).toBe('expired');
    expect(auth.lapsed()).toBe(true);
  });

  it('trySilent from a stored profile signs in again', async () => {
    localStorage.setItem('iqra.profile', JSON.stringify(PROFILE));
    const auth = create();
    expect(await auth.trySilent()).toBe(true);
    expect(auth.state()).toBe('signed-in');
    expect(auth.lapsed()).toBe(false);
  });

  it('ignores a token for another account than the stored one', async () => {
    localStorage.setItem('iqra.profile', JSON.stringify(PROFILE));
    google.login = async () => ({ token: 'other', lifetimeMs: 3_600_000, profile: { name: 'Other', email: 'other@example.test' } });
    const auth = create();
    expect(await auth.trySilent()).toBe(false);
    expect(auth.token()).toBeNull();
  });

  it('gets a Calendar token for its own scope, cached, without touching the sign-in token', async () => {
    const auth = create();
    await auth.signIn();
    expect(auth.scopeToken(CAL)).toBeNull();
    const token = await auth.requestScope(CAL);
    expect(token).toBe('native-2');
    expect(calls[1].scopes).toEqual([CAL]);
    expect(auth.scopeToken(CAL)).toBe('native-2');
    expect(await auth.requestScope(CAL)).toBe('native-2');
    expect(calls).toHaveLength(2);
    expect(auth.token()).toBe('native-1');
  });

  it('requestScope passes silent through', async () => {
    const auth = create();
    await auth.requestScope(CAL, { silent: true });
    expect(calls[0].silent).toBe(true);
  });

  it('a refused scope rejects with an error that is not a cancellation', async () => {
    const auth = create();
    google.fail = new Error('Authorization denied');
    await expect(auth.requestScope(CAL)).rejects.not.toBeInstanceOf(AuthCancelledError);
  });

  it('sign out clears everything and signs out of Google', async () => {
    const auth = create();
    await auth.signIn();
    await auth.requestScope(CAL);
    auth.signOut();
    expect(auth.state()).toBe('signed-out');
    expect(auth.profile()).toBeNull();
    expect(auth.scopeToken(CAL)).toBeNull();
    expect(localStorage.getItem('iqra.profile')).toBeNull();
    expect(google.logout).toHaveBeenCalled();
  });

  it('markExpired drops the token and renews silently', async () => {
    const auth = create();
    await auth.signIn();
    auth.markExpired('native-1');
    await vi.waitFor(() => expect(auth.token()).toBe('native-2'));
  });
});
