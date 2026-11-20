import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthApi } from '../auth/auth.service';
import { FakeAuthService } from '../auth/fake-auth.service';
import { signedInGuard } from '../auth/auth.guard';
import { routes } from '../app.routes';
import { DB, IqraDb } from '../core/db';
import { newId } from '../core/ids';
import { DRIVE_ADAPTER } from '../sync/drive-adapter';
import { SyncEngine } from '../sync/sync-engine';
import { ProfilePage } from './profile.page';

describe('profile routes', () => {
  it('has a lazy Profile page behind the signed-in guard', () => {
    const route = routes.find((r) => r.path === 'profile')!;
    expect(route.component).toBeUndefined();
    expect(typeof route.loadComponent).toBe('function');
    expect(route.canActivate).toEqual([signedInGuard]);
  });

  it('keeps /settings and /settings/downloads working by redirecting', () => {
    expect(routes.find((r) => r.path === 'settings')).toMatchObject({ redirectTo: 'profile', pathMatch: 'full' });
    expect(routes.find((r) => r.path === 'settings/downloads')).toMatchObject({ redirectTo: 'profile/downloads', pathMatch: 'full' });
  });
});

describe('ProfilePage', () => {
  let db: IqraDb;
  let fixture: ComponentFixture<ProfilePage>;

  beforeEach(() => {
    localStorage.clear();
    db = new IqraDb(`iqra-test-${newId()}`);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: DB, useValue: db },
        { provide: AuthApi, useClass: FakeAuthService },
        { provide: DRIVE_ADAPTER, useValue: { storageQuota: async () => ({ limit: 100, usage: 10 }) } },
        {
          provide: SyncEngine,
          useValue: { status: signal('synced'), lastSyncedAt: signal(null), lastError: signal(null), syncNow: vi.fn(), ngOnDestroy: vi.fn() },
        },
      ],
    });
  });

  afterEach(async () => {
    fixture.destroy();
    TestBed.resetTestingModule();
    await db.delete();
  });

  async function create(): Promise<HTMLElement> {
    await TestBed.inject(AuthApi).signIn();
    fixture = TestBed.createComponent(ProfilePage);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows the name, email and an initial when there is no photo, then the settings sections', async () => {
    const el = await create();
    expect(el.querySelector('[data-testid="profile-name"]')!.textContent).toBe('Test User');
    expect(el.querySelector('[data-testid="profile-email"]')!.textContent).toBe('reader@example.test');
    expect(el.querySelector('[data-testid="avatar"]')!.textContent).toContain('T');
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(el.querySelector('[data-section="account"] iqra-account-section')).not.toBeNull();
      expect(el.querySelector('[data-section="storage"] iqra-storage-section')).not.toBeNull();
      expect(el.querySelector('[data-section="reminders"] iqra-reminders-section')).not.toBeNull();
      expect(el.querySelector('[data-section="data"] iqra-data-section')).not.toBeNull();
    });
    expect(Array.from(el.querySelectorAll('h2')).map((h) => h.textContent)).toEqual(['Sync and account', 'Storage', 'Reminders', 'Your data']);
  });

  it('no longer has the categories, defaults or quote sections, and signing out is reachable', async () => {
    const el = await create();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="sign-out"]')).not.toBeNull();
    });
    expect(el.querySelector('[data-section="categories"]')).toBeNull();
    expect(el.querySelector('[data-section="defaults"]')).toBeNull();
  });

  it('shows the Google photo when the profile has one', async () => {
    const auth = TestBed.inject(AuthApi) as FakeAuthService;
    await auth.signIn();
    vi.spyOn(auth, 'profile').mockReturnValue({ name: 'Ada', email: 'a@b.c', picture: 'https://example.test/a.png' });
    fixture = TestBed.createComponent(ProfilePage);
    fixture.detectChanges();
    const img = (fixture.nativeElement as HTMLElement).querySelector<HTMLImageElement>('img.avatar')!;
    expect(img.getAttribute('src')).toBe('https://example.test/a.png');
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
  });
});
