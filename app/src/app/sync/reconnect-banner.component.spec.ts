import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthApi, AuthCancelledError } from '../auth/auth.service';
import { FakeAuthService } from '../auth/fake-auth.service';
import { COPY } from '../ui/copy';
import { ToastService } from '../ui/toast.service';
import { ReconnectBannerComponent } from './reconnect-banner.component';

@Component({ template: '' })
class Blank {}

describe('ReconnectBannerComponent', () => {
  let fixture: ComponentFixture<ReconnectBannerComponent>;
  let auth: FakeAuthService;
  let router: Router;
  const banner = () => (fixture.nativeElement as HTMLElement).querySelector('[role=status]');
  const button = () => (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button');

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: '**', component: Blank }]), { provide: AuthApi, useClass: FakeAuthService }],
    });
    auth = TestBed.inject(AuthApi) as FakeAuthService;
    router = TestBed.inject(Router);
    await auth.signIn();
    await router.navigateByUrl('/library');
    fixture = TestBed.createComponent(ReconnectBannerComponent);
    fixture.detectChanges();
  });
  afterEach(() => fixture.destroy());

  const update = async () => {
    await fixture.whenStable();
    fixture.detectChanges();
  };

  it('shows nothing while signed in, and one non-modal bar once the session has lapsed', async () => {
    expect(banner()).toBeNull();
    auth.markExpired();
    await update();
    expect(banner()!.textContent).toContain(COPY.sync.reconnectBanner);
    expect(fixture.nativeElement.querySelectorAll('[role=status]')).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('[role=dialog], [aria-modal]')).toBeNull();
  });

  it('is not shown on the welcome screen or while reading', async () => {
    auth.markExpired();
    await router.navigateByUrl('/read/b1');
    await update();
    expect(banner()).toBeNull();
    await router.navigateByUrl('/welcome');
    await update();
    expect(banner()).toBeNull();
    await router.navigateByUrl('/stats');
    await update();
    expect(banner()).not.toBeNull();
  });

  it('one click reconnects, the bar goes away, and no toast is raised', async () => {
    auth.markExpired();
    await update();
    const toast = TestBed.inject(ToastService);
    const reconnect = vi.spyOn(auth, 'reconnect');
    button()!.click();
    await vi.waitFor(async () => {
      await update();
      expect(banner()).toBeNull();
    });
    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(toast.current()).toBeNull();
  });

  it('a closed popup leaves the bar in place and says nothing more', async () => {
    auth.markExpired();
    await update();
    vi.spyOn(auth, 'reconnect').mockRejectedValue(new AuthCancelledError());
    button()!.click();
    await update();
    await vi.waitFor(async () => {
      await update();
      expect(button()!.disabled).toBe(false);
    });
    expect(banner()).not.toBeNull();
    expect(TestBed.inject(ToastService).current()).toBeNull();
  });

  it('ignores a second click while the popup is open', async () => {
    auth.markExpired();
    await update();
    let finish!: () => void;
    const reconnect = vi.spyOn(auth, 'reconnect').mockImplementation(() => new Promise<void>((r) => (finish = r)));
    button()!.click();
    await update();
    button()!.click();
    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(button()!.disabled).toBe(true);
    finish();
  });
});

describe('ReconnectBannerComponent timing', () => {
  const state = signal<'signed-in' | 'expired'>('expired');
  const lapsed = signal(false);
  let fixture: ComponentFixture<ReconnectBannerComponent>;
  const banner = () => (fixture.nativeElement as HTMLElement).querySelector('[role=status]');
  const setOnline = (online: boolean) => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online);
    window.dispatchEvent(new Event(online ? 'online' : 'offline'));
    fixture.detectChanges();
  };

  beforeEach(async () => {
    state.set('expired');
    lapsed.set(false);
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: '**', component: Blank }]), { provide: AuthApi, useValue: { state, lapsed, reconnect: async () => undefined } }],
    });
    await TestBed.inject(Router).navigateByUrl('/library');
    fixture = TestBed.createComponent(ReconnectBannerComponent);
    fixture.detectChanges();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fixture.destroy();
  });

  it('a page that starts with a stored profile is expired but shows no bar until a silent renewal has failed', () => {
    expect(banner()).toBeNull();
    lapsed.set(true);
    fixture.detectChanges();
    expect(banner()).not.toBeNull();
  });

  it('never shows offline, however lapsed, and appears when the connection returns', () => {
    lapsed.set(true);
    setOnline(false);
    expect(banner()).toBeNull();
    setOnline(true);
    expect(banner()).not.toBeNull();
  });

  it('is already hidden when the page starts offline', () => {
    fixture.destroy();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    lapsed.set(true);
    fixture = TestBed.createComponent(ReconnectBannerComponent);
    fixture.detectChanges();
    expect(banner()).toBeNull();
  });
});
