import { TestBed } from '@angular/core/testing';
import { ComponentFixture } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { App } from './app';
import { routes } from './app.routes';

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
    TestBed.configureTestingModule({ imports: [App], providers: [provideRouter(routes)] });
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
    el.querySelectorAll<HTMLElement>('nav.tabbar a.tab')[1].click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(router.url).toBe('/notes');
    expect(el.textContent).toContain('Coming soon');
  });

  it.each(['/welcome', '/read/abc'])('hides the tab bar on %s', async (url) => {
    await go(url);
    expect(el.querySelector('nav.tabbar')).toBeNull();
  });
});
