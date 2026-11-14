import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthApi } from './auth.service';

/** Sends a signed-out user to /welcome. */
export const signedInGuard: CanActivateFn = () => {
  const auth = inject(AuthApi);
  return auth.state() === 'signed-out' ? inject(Router).createUrlTree(['/welcome']) : true;
};

/** Sends anyone who is not signed out (signed in or expired) to /library. */
export const signedOutGuard: CanActivateFn = () => {
  const auth = inject(AuthApi);
  return auth.state() === 'signed-out' ? true : inject(Router).createUrlTree(['/library']);
};
