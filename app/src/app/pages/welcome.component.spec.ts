import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthApi } from '../auth/auth.service';
import { FakeAuthService } from '../auth/fake-auth.service';
import { DRIVE_ADAPTER } from '../sync/drive-adapter';
import { FakeDrive } from '../sync/fake-drive';
import { COPY } from '../ui/copy';
import { WelcomePage } from './welcome.component';

describe('WelcomePage', () => {
  let fixture: ComponentFixture<WelcomePage>;
  let drive: FakeDrive;
  let router: Router;
  let el: HTMLElement;

  function create(): void {
    fixture = TestBed.createComponent(WelcomePage);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  }

  beforeEach(() => {
    drive = new FakeDrive();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'library', children: [] }]),
        { provide: AuthApi, useClass: FakeAuthService },
        { provide: DRIVE_ADAPTER, useValue: drive },
      ],
    });
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  });

  it('disables the button and explains offline sign-in when offline', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    create();
    const button = el.querySelector<HTMLButtonElement>('button.cta')!;
    expect(button.disabled).toBe(true);
    expect(el.textContent).toContain(COPY.welcome.offline);
  });

  it('signs in, creates the Books folder and opens the library', async () => {
    create();
    el.querySelector<HTMLButtonElement>('button.cta')!.click();
    await fixture.whenStable();
    expect(drive.folderNames()).toEqual(['Iqra', 'Books']);
    // The first sync runs IndexedDB work that whenStable does not track, so wait for the redirect.
    await vi.waitFor(() => expect(router.url).toBe('/library'));
  });
});
