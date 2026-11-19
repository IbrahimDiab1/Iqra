import { ApplicationConfig, inject, isDevMode, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { FAKE_DRIVE } from '../environments/environment';
import { AuthApi, GisAuthService } from './auth/auth.service';
import { FakeAuthService } from './auth/fake-auth.service';
import { routes } from './app.routes';
import { DRIVE_ADAPTER } from './sync/drive-adapter';
import { SyncEngine } from './sync/sync-engine';
import { FakeDrive } from './sync/fake-drive';
import { GoogleDrive } from './sync/google-drive';
import { exposeE2eHandles } from './e2e-hooks';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideAppInitializer(() => {
      const auth = inject(AuthApi);
      const sync = inject(SyncEngine);
      if (FAKE_DRIVE) {
        // e2e only: start signed in, and expose the engine and fake Drive to the tests.
        // ?signed-out leaves it signed out so /welcome can be opened.
        if (!location.search.includes('signed-out')) void auth.signIn();
        exposeE2eHandles({ __iqraSync: sync, __iqraDrive: inject(DRIVE_ADAPTER) as FakeDrive });
      }
      auth.preload();
      if (auth.state() === 'signed-out') return;
      sync.start();
      void sync.resume();
    }),
    provideServiceWorker('ngsw-worker.js', {
      // The e2e build runs in dev mode for Angular but has no real Drive; keep the worker out of its way.
      enabled: !isDevMode() && !FAKE_DRIVE,
      registrationStrategy: 'registerWhenStable:30000',
    }),
    { provide: AuthApi, useClass: FAKE_DRIVE ? FakeAuthService : GisAuthService },
    {
      provide: DRIVE_ADAPTER,
      useFactory: () => (FAKE_DRIVE ? new FakeDrive() : new GoogleDrive(inject(AuthApi))),
    },
  ],
};
