import { NativeAuthService } from './native-auth.service';

/** The Android app signs in through the system account (Google blocks web sign-in inside a WebView). */
export const AUTH_IMPL = NativeAuthService;
