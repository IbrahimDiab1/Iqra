import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthApi, AuthCancelledError } from '../auth/auth.service';
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

  it('renders the Arabic word as rtl Arabic text', () => {
    create();
    const word = el.querySelector('[lang="ar"]')!;
    expect(word.getAttribute('dir')).toBe('rtl');
    expect(word.textContent!.trim()).toBe('اقرأ');
  });

  it('uses the welcome title as the h1', () => {
    create();
    expect(el.querySelector('h1')!.textContent!.trim()).toBe(COPY.welcome.title);
  });

  it('shows a polite message and re-enables the button when sign-in fails', async () => {
    create();
    const auth = TestBed.inject(AuthApi);
    vi.spyOn(auth, 'signIn').mockRejectedValue(new AuthCancelledError());
    const button = el.querySelector<HTMLButtonElement>('button.cta')!;
    button.click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(el.querySelector('[role="status"]')!.textContent).toContain(COPY.welcome.cancelled);
    });
    expect(button.disabled).toBe(false);
    expect(button.getAttribute('aria-busy')).toBe('false');
  });

  it('shows the busy label and aria-busy while signing in', () => {
    create();
    const auth = TestBed.inject(AuthApi);
    vi.spyOn(auth, 'signIn').mockReturnValue(new Promise(() => {}));
    const button = el.querySelector<HTMLButtonElement>('button.cta')!;
    button.click();
    fixture.detectChanges();
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain(COPY.welcome.busy);
  });

  it('explains the Google warning in a disclosure', () => {
    create();
    const details = el.querySelector('details')!;
    expect(details.textContent).toContain(COPY.welcome.warningTitle);
    expect(details.textContent).toContain(COPY.welcome.warningBody);
  });

  it('opens the source link safely', () => {
    create();
    const link = el.querySelector<HTMLAnchorElement>('footer a[href^="https://github.com"]')!;
    expect(link.href).toBe('https://github.com/IbrahimDiab1/Iqra');
    expect(link.rel).toContain('noopener');
  });

  it('links to the privacy policy and the terms of use', () => {
    create();
    const privacy = el.querySelector<HTMLAnchorElement>('footer a[href="privacy.html"]')!;
    const terms = el.querySelector<HTMLAnchorElement>('footer a[href="terms.html"]')!;
    expect(privacy.textContent).toContain(COPY.welcome.privacy);
    expect(terms.textContent).toContain(COPY.welcome.terms);
  });

  it('shows the logo in the brand row', () => {
    create();
    const logo = el.querySelector<HTMLImageElement>('.brand img.mark')!;
    expect(logo.getAttribute('src')).toBe('favicon.svg');
  });
});
