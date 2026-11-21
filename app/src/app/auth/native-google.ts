import { SocialLogin, type GoogleLoginResponseOnline } from '@capgo/capacitor-social-login';
import { environment } from '../../environments/environment';
import type { NativeGoogle, NativeGrant } from './native-auth.service';

/** Tokens last an hour; used when the plugin does not say when the one it returned ends. */
const DEFAULT_LIFETIME_MS = 3_600_000;

let ready: Promise<void> | null = null;

function initialize(): Promise<void> {
  // The Web client id: Android Credential Manager checks the app's package and SHA-1 against the Android client of the same project.
  ready ??= SocialLogin.initialize({ google: { webClientId: environment.googleClientId } }).catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

function lifetimeOf(expires: string | undefined): number {
  const at = expires ? Date.parse(expires) : NaN;
  const left = at - Date.now();
  return Number.isFinite(left) && left > 0 ? left : DEFAULT_LIFETIME_MS;
}

/** Google sign-in and scope grants through the Android system (Credential Manager and the authorization API). */
export const nativeGoogle: NativeGoogle = {
  async login(scopes, opts): Promise<NativeGrant> {
    await initialize();
    const res = await SocialLogin.login({
      provider: 'google',
      options: {
        scopes,
        // Silent: reuse the account this app already used, never ask which one.
        ...(opts.silent ? { filterByAuthorizedAccounts: true, autoSelectEnabled: true, style: 'bottom' as const } : {}),
      },
    });
    const result = res.result as GoogleLoginResponseOnline;
    const token = result.accessToken?.token;
    if (!token) throw new Error('Google did not return an access token');
    return {
      token,
      lifetimeMs: lifetimeOf(result.accessToken?.expires),
      profile: { name: result.profile.name ?? '', email: result.profile.email ?? '', picture: result.profile.imageUrl ?? undefined },
    };
  },
  async logout(): Promise<void> {
    await initialize();
    await SocialLogin.logout({ provider: 'google' });
  },
};
