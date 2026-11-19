import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthApi } from '../auth/auth.service';
import { FakeAuthService } from '../auth/fake-auth.service';
import { DB, IqraDb } from '../core/db';
import { newId } from '../core/ids';
import { SyncEngine, type SyncStatus } from '../sync/sync-engine';
import { AccountSection } from './account.section';
import { CLEAR_DEVICE, FULL_RELOAD } from './clear-device';

describe('AccountSection', () => {
  let db: IqraDb;
  let fixture: ComponentFixture<AccountSection>;
  let el: HTMLElement;
  let auth: FakeAuthService;
  let order: string[];
  const clear = vi.fn(async () => {
    order.push('clear');
  });
  const reload = vi.fn((path: string) => {
    order.push(`reload ${path}`);
  });
  const sync = {
    status: signal<SyncStatus>('synced'),
    lastSyncedAt: signal<number | null>(null),
    lastError: signal<string | null>(null),
    syncNow: vi.fn(async () => undefined),
    ngOnDestroy: vi.fn(),
  };

  const q = <T extends HTMLElement>(sel: string) => el.querySelector<T>(sel)!;
  const text = () => el.textContent!.replace(/\s+/g, ' ');
  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    localStorage.clear();
    order = [];
    clear.mockClear();
    reload.mockClear();
    sync.syncNow.mockClear();
    sync.ngOnDestroy.mockClear();
    sync.lastSyncedAt.set(null);
    sync.lastError.set(null);
    db = new IqraDb(`iqra-test-${newId()}`);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: DB, useValue: db },
        { provide: AuthApi, useClass: FakeAuthService },
        { provide: SyncEngine, useValue: sync },
        { provide: CLEAR_DEVICE, useValue: clear },
        { provide: FULL_RELOAD, useValue: reload },
      ],
    });
    auth = TestBed.inject(AuthApi) as FakeAuthService;
    await auth.signIn();
    vi.spyOn(auth, 'signOut').mockImplementation(() => {
      order.push('signOut');
    });
    vi.spyOn(TestBed.inject(Router), 'navigate').mockImplementation(async (c) => {
      order.push(`navigate ${(c as string[]).join('')}`);
      return true;
    });
    fixture = TestBed.createComponent(AccountSection);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  afterEach(async () => {
    fixture.destroy();
    TestBed.resetTestingModule();
    await db.delete();
  });

  it('shows the name, email and sync state', () => {
    expect(text()).toContain('Test User');
    expect(text()).toContain('reader@example.test');
    expect(text()).toContain('Synced with Google Drive');
    expect(q('[data-testid="last-synced"]').textContent).toContain('Not synced yet');
    sync.lastSyncedAt.set(new Date(2026, 10, 19, 12).getTime());
    sync.lastError.set('Quota hiccup');
    fixture.detectChanges();
    expect(q('[data-testid="last-synced"]').textContent).toContain('Last synced');
    expect(text()).toContain('Quota hiccup');
  });

  it('Sync now calls the engine', async () => {
    q('[data-testid="sync-now"]').click();
    await settle();
    expect(sync.syncNow).toHaveBeenCalledTimes(1);
  });

  it('saves Sync on mobile data as a device pref, not in the database', () => {
    const toggle = q<HTMLInputElement>('input[role="switch"]');
    expect(toggle.checked).toBe(true);
    toggle.click();
    expect(localStorage.getItem('iqra.device.syncOnMobile')).toBe('false');
  });

  it('signs out without clearing the device when the box is not ticked', async () => {
    q('[data-testid="sign-out"]').click();
    fixture.detectChanges();
    q('[data-testid="confirm-sign-out"]').click();
    await settle();
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(clear).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(order).toEqual(['signOut', 'navigate /welcome']);
  });

  it('clears the device exactly once after signing out, then reloads at /welcome', async () => {
    q('[data-testid="sign-out"]').click();
    fixture.detectChanges();
    q<HTMLInputElement>('[data-testid="clear-device"]').click();
    fixture.detectChanges();
    q('[data-testid="confirm-sign-out"]').click();
    await settle();
    expect(clear).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledWith(db);
    expect(order).toEqual(['signOut', 'clear', 'reload /welcome']);
  });

  it('cancel does nothing', async () => {
    q('[data-testid="sign-out"]').click();
    fixture.detectChanges();
    q<HTMLInputElement>('[data-testid="clear-device"]').click();
    q('[data-testid="cancel-sign-out"]').click();
    await settle();
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(order).toEqual([]);
  });

  it('a failed clear keeps going to /welcome with a message, and does not reload', async () => {
    clear.mockRejectedValueOnce(new Error('blocked'));
    q('[data-testid="sign-out"]').click();
    fixture.detectChanges();
    q<HTMLInputElement>('[data-testid="clear-device"]').click();
    fixture.detectChanges();
    q('[data-testid="confirm-sign-out"]').click();
    await settle();
    expect(reload).not.toHaveBeenCalled();
    expect(order).toEqual(['signOut', 'navigate /welcome']);
  });
});
