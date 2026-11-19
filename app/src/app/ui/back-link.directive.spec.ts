import { Component, signal } from '@angular/core';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { BackLinkDirective } from './back-link.directive';
import { NavHistory } from './nav-history.service';

@Component({
  imports: [BackLinkDirective],
  template: `<a class="back" iqraBack="/library" [iqraBackBefore]="before()">Back</a>`,
})
class Host {
  before = signal<(() => Promise<unknown>) | null>(null);
}

@Component({ template: '' })
class Blank {}

describe('BackLinkDirective', () => {
  let router: Router;
  let nav: NavHistory;
  const click = (el: HTMLElement, init: MouseEventInit = {}) => {
    const e = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
    el.dispatchEvent(e);
    return e;
  };
  /** Long enough for the click's async steps and for the router's own deferred handling of a history step. */
  const settle = () => new Promise((r) => setTimeout(r, 30));

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([{ path: '**', component: Blank }]), provideLocationMocks()] });
    router = TestBed.inject(Router);
    nav = TestBed.inject(NavHistory);
    router.initialNavigation();
  });

  function create() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return { fixture, a: fixture.nativeElement.querySelector('a') as HTMLAnchorElement };
  }

  it('is a real link to the fallback page (so it can be opened in a new tab)', () => {
    const { a } = create();
    expect(a.getAttribute('href')).toBe('/library');
  });

  it('a plain click goes back through the history instead of pushing the fallback page', async () => {
    await router.navigateByUrl('/library');
    await router.navigateByUrl('/read/b1');
    const { a } = create();
    const e = click(a);
    expect(e.defaultPrevented).toBe(true);
    await settle();

    expect(router.url).toBe('/library');
    expect(nav.canGoBack()).toBe(false);
  });

  it('with no earlier page it goes to the fallback', async () => {
    await router.navigateByUrl('/read/b1');
    const { a } = create();
    click(a);
    await settle();
    expect(router.url).toBe('/library');
  });

  it('runs the before-hook first and waits for it', async () => {
    await router.navigateByUrl('/library');
    await router.navigateByUrl('/read/b1');
    const order: string[] = [];
    let release!: () => void;
    const { fixture, a } = create();
    fixture.componentInstance.before.set(() => new Promise<void>((r) => ((release = r), order.push('flush-started'))));
    fixture.detectChanges();
    click(a);
    await settle();
    expect(order).toEqual(['flush-started']);
    expect(router.url).toBe('/read/b1');
    release();
    await settle();
    expect(router.url).toBe('/library');
  });

  it('still leaves when the before-hook fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await router.navigateByUrl('/read/b1');
    const { fixture, a } = create();
    fixture.componentInstance.before.set(() => Promise.reject(new Error('db')));
    fixture.detectChanges();
    click(a);
    await settle();
    expect(router.url).toBe('/library');
  });

  it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }])('leaves a modified or middle click to the browser (%o)', (init) => {
    const { a } = create();
    expect(click(a, init).defaultPrevented).toBe(false);
  });
});
