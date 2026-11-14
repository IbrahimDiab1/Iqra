import { ApplicationConfig, inject, isDevMode, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { environment } from '../environments/environment';
import { AuthApi, GisAuthService } from './auth/auth.service';
import { FakeAuthService } from './auth/fake-auth.service';
import { routes } from './app.routes';
import { DRIVE_ADAPTER } from './sync/drive-adapter';
import { SyncEngine } from './sync/sync-engine';
import { FakeDrive } from './sync/fake-drive';
import { GoogleDrive } from './sync/google-drive';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideAppInitializer(() => {
      const auth = inject(AuthApi);
      if (auth.state() === 'signed-out') return;
      const sync = inject(SyncEngine);
      sync.start();
      void sync.syncNow();
    }),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
    { provide: AuthApi, useClass: environment.fakeDrive ? FakeAuthService : GisAuthService },
    {
      provide: DRIVE_ADAPTER,
      useFactory: () => (environment.fakeDrive ? new FakeDrive() : new GoogleDrive(inject(AuthApi))),
    },
  ],
};
