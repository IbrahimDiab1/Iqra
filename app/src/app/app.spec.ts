import { TestBed } from '@angular/core/testing';
import { ComponentFixture } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { App } from './app';
import { DB } from './core/db';
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

  it('shows Profile, Library, Notes, Review and Stats tabs with icons on the library route', async () => {
    await go('/library');
    const tabs = Array.from(el.querySelectorAll<HTMLElement>('nav.tabbar a.tab'));
    expect(tabs.map((t) => t.textContent?.trim())).toEqual(['Profile', 'Library', 'Notes', 'Review', 'Stats']);
    expect(tabs.every((t) => t.querySelector('svg'))).toBe(true);
  });

  it('switches route when a tab is pressed', async () => {
    await go('/library');
    el.querySelectorAll<HTMLElement>('nav.tabbar a.tab')[4].click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(router.url).toBe('/stats');
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(el.querySelector('iqra-stats-page h1')?.textContent).toBe('Stats');
    });
  });

  it('the Review tab opens /review and shows how many items are due as a badge', async () => {
    const db = TestBed.inject(DB);
    const due = { id: 'r1', text: 'a', translation: 'b', kind: 'word', sourceLang: 'en', bookId: 'x', page: 1, context: '', createdAt: 1, updatedAt: 1, deviceId: 'd', srs: { due: 1, intervalDays: 0, ease: 2.5, reps: 0, lapses: 0 } };
    await db.review.bulkPut([due as never, { ...due, id: 'r2', srs: { ...due.srs, due: Date.now() + 5 * 86_400_000 } } as never]);
    await go('/library');
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="due-badge"]')?.textContent?.trim()).toBe('1');
    });
    const tab = el.querySelectorAll<HTMLElement>('nav.tabbar a.tab')[3];
    expect(tab.textContent).toContain('Review');
    expect(el.querySelector('[data-testid="due-badge"]')?.getAttribute('aria-label')).toBe('1 due today');
    tab.click();
    await fixture.whenStable();
    expect(router.url).toBe('/review');
    await db.review.clear();
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
