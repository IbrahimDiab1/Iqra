import { InjectionToken } from '@angular/core';

/** Source of the current time in ms. Tests can provide a fixed clock. */
export const CLOCK = new InjectionToken<{ now(): number }>('clock', {
  factory: () => ({ now: () => Date.now() }),
});
