import { TestBed } from '@angular/core/testing';
import { ComponentFixture } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { App } from './app';
import { routes } from './app.routes';
import { AuthApi } from './auth/auth.service';
import { FakeAuthService } from './auth/fake-auth.service';
import { DRIVE_ADAPTER } from './sync/drive-adapter';
import { FakeDrive } from './sync/fake-drive';

function signedInAuth(): FakeAuthService {
  const auth = new FakeAuthService();
  void auth.signIn();
  return auth;
}

describe('App shell', () => {
  let fixture: ComponentFixture<App>;
  let router: Router;
  let el: HTMLElement;

  async function go(url: string) {
    await router.navigateByUrl(url);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [App], providers: [provideRouter(routes), { provide: AuthApi, useFactory: signedInAuth }, { provide: DRIVE_ADAPTER, useFactory: () => new FakeDrive() }] });
    router = TestBed.inject(Router);
    fixture = TestBed.createComponent(App);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  it('shows Library, Notes and Stats tabs with icons on the library route', async () => {
    await go('/library');
    const tabs = Array.from(el.querySelectorAll<HTMLElement>('nav.tabbar a.tab'));
    expect(tabs.map((t) => t.textContent?.trim())).toEqual(['Library', 'Notes', 'Stats']);
    expect(tabs.every((t) => t.querySelector('svg'))).toBe(true);
  });

  it('switches route when a tab is pressed', async () => {
    await go('/library');
    el.querySelectorAll<HTMLElement>('nav.tabbar a.tab')[2].click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(router.url).toBe('/stats');
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(el.querySelector('iqra-stats-page h1')?.textContent).toBe('Stats');
    });
  });

  it('hides the tab bar on /read/abc', async () => {
    await go('/read/abc');
    expect(el.querySelector('nav.tabbar')).toBeNull();
  });

  it('hides the tab bar on /welcome when signed out', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter(routes),
        { provide: AuthApi, useClass: FakeAuthService },
        { provide: DRIVE_ADAPTER, useFactory: () => new FakeDrive() },
      ],
    });
    router = TestBed.inject(Router);
    fixture = TestBed.createComponent(App);
    el = fixture.nativeElement as HTMLElement;
    await go('/welcome');
    expect(router.url).toBe('/welcome');
    expect(el.querySelector('nav.tabbar')).toBeNull();
  });
});
