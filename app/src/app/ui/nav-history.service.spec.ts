import { Location } from '@angular/common';
import { provideLocationMocks } from '@angular/common/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { describe, expect, it, beforeEach } from 'vitest';
import { NavHistory } from './nav-history.service';

@Component({ template: '' })
class Blank {}

describe('NavHistory', () => {
  let router: Router;
  let location: Location;
  let nav: NavHistory;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: '**', component: Blank }]), provideLocationMocks()],
    });
    router = TestBed.inject(Router);
    location = TestBed.inject(Location);
    nav = TestBed.inject(NavHistory);
    // Starts the router's listener for the browser's own Back and Forward (the app does this when it boots).
    router.initialNavigation();
  });

  /** Lets the router finish a navigation that a history step started. */
  const settle = () => new Promise((r) => setTimeout(r, 30));

  it('has nowhere to go back to on the first page, so back() goes to the fallback and replaces the entry', async () => {
    await router.navigateByUrl('/read/b1');
    expect(nav.canGoBack()).toBe(false);
    nav.back('/library');
    await settle();
    expect(router.url).toBe('/library');
    // Replaced, not pushed: there is still no in-app history behind it.
    expect(nav.canGoBack()).toBe(false);
  });

  it('goes back to the previous app page instead of pushing a new entry', async () => {
    await router.navigateByUrl('/library');
    await router.navigateByUrl('/read/b1');
    expect(nav.canGoBack()).toBe(true);
    nav.back('/library');
    await settle();
    expect(router.url).toBe('/library');
    expect(nav.canGoBack()).toBe(false);
  });

  it('Library -> book -> Settings -> back goes to the book, then back again to the Library', async () => {
    await router.navigateByUrl('/library');
    await router.navigateByUrl('/read/b1');
    await router.navigateByUrl('/settings');
    nav.back('/library');
    await settle();
    expect(router.url).toBe('/read/b1');
    expect(nav.canGoBack()).toBe(true);
    nav.back('/library');
    await settle();
    expect(router.url).toBe('/library');
  });

  it('the browser Back button is counted too', async () => {
    await router.navigateByUrl('/library');
    await router.navigateByUrl('/read/b1');
    location.back();
    await settle();
    expect(router.url).toBe('/library');
    expect(nav.canGoBack()).toBe(false);
  });

  it('a navigation that replaces the URL does not add history', async () => {
    await router.navigateByUrl('/library');
    await router.navigateByUrl('/read/b1?page=3');
    await router.navigateByUrl('/read/b1', { replaceUrl: true });
    nav.back('/library');
    await settle();
    expect(router.url).toBe('/library');
  });

  it('going forward again after a back adds history back', async () => {
    await router.navigateByUrl('/library');
    await router.navigateByUrl('/read/b1');
    location.back();
    await settle();
    location.forward();
    await settle();
    expect(router.url).toBe('/read/b1');
    expect(nav.canGoBack()).toBe(true);
  });
});
