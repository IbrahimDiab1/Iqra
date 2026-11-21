import { GisAuthService } from './auth.service';

/**
 * The real sign-in for this build: Google Identity Services in the browser and the installed web app. The Android build
 * (`ng build --configuration native`) swaps this file for auth-impl.native.ts, so each bundle carries only its own sign-in.
 */
export const AUTH_IMPL = GisAuthService;
