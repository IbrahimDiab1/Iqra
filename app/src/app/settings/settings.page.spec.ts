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
import { SettingsPage } from './settings.page';

describe('settings route', () => {
  it('is lazy and behind the signed-in guard', () => {
    const route = routes.find((r) => r.path === 'settings')!;
    expect(route.component).toBeUndefined();
    expect(typeof route.loadComponent).toBe('function');
    expect(route.canActivate).toEqual([signedInGuard]);
  });
});

describe('SettingsPage', () => {
  let db: IqraDb;
  let fixture: ComponentFixture<SettingsPage>;

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
    fixture = TestBed.createComponent(SettingsPage);
    fixture.detectChanges();
  });

  afterEach(async () => {
    fixture.destroy();
    TestBed.resetTestingModule();
    await db.delete();
  });

  it('has a back link to the library and loads the account and defaults sections', async () => {
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')!.textContent).toBe('Settings');
    expect(el.querySelector('a.back')!.getAttribute('href')).toBe('/library');
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(el.querySelector('[data-section="account"] iqra-account-section')).not.toBeNull();
      expect(el.querySelector('[data-section="defaults"] iqra-defaults-section')).not.toBeNull();
      expect(el.querySelector('[data-section="storage"] iqra-storage-section')).not.toBeNull();
      expect(el.querySelector('[data-section="data"] iqra-data-section')).not.toBeNull();
      expect(el.querySelector('[data-section="categories"] iqra-categories-section')).not.toBeNull();
    });
    expect(Array.from(el.querySelectorAll('h2')).map((h) => h.textContent)).toEqual(['Account', 'Categories', 'Reading defaults', 'Storage', 'Reminders', 'Your data']);
  });
});
