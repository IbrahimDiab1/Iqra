import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { DrawerComponent } from './drawer.component';

@Component({
  imports: [DrawerComponent],
  template: `
    <button id="opener" type="button">Open</button>
    <iqra-drawer [open]="open()" title="Contents" (closed)="closes = closes + 1; open.set(false)">
      <button id="first" type="button">First</button>
      <button id="last" type="button">Last</button>
    </iqra-drawer>
  `,
})
class HostComponent {
  open = signal(false);
  closes = 0;
}

describe('DrawerComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let el: HTMLElement;
  const original = window.innerWidth;
  const panel = () => el.querySelector<HTMLElement>('.panel')!;
  const scrim = () => el.querySelector<HTMLElement>('.scrim')!;

  async function create(width: number, open = true) {
    window.innerWidth = width;
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    el = fixture.nativeElement as HTMLElement;
    document.body.append(el);
    host.open.set(open);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  afterEach(() => {
    window.innerWidth = original;
    el?.remove();
  });

  it('is a dialog titled by its heading; closed, it is hidden and inert', async () => {
    await create(1280, false);
    expect(panel().getAttribute('role')).toBe('dialog');
    expect(el.querySelector('h3')!.textContent).toBe('Contents');
    expect(panel().getAttribute('aria-labelledby')).toBe(el.querySelector('h3')!.id);
    expect(panel().hasAttribute('inert')).toBe(true);
    expect(panel().getAttribute('aria-hidden')).toBe('true');
    expect(panel().classList.contains('open')).toBe(false);
  });

  it('opens, moves focus inside, and Escape or Close asks to close', async () => {
    await create(1280);
    expect(panel().classList.contains('open')).toBe(true);
    expect(panel().hasAttribute('inert')).toBe(false);
    expect(document.activeElement?.id).toBe('first');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(host.closes).toBe(1);
    host.open.set(true);
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('.close')!.click();
    expect(host.closes).toBe(2);
  });

  it('Escape does nothing while closed', async () => {
    await create(1280, false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(host.closes).toBe(0);
  });

  it('wide screens dock it: no scrim, not modal, Tab is free', async () => {
    await create(1280);
    expect(scrim().classList.contains('open')).toBe(false);
    expect(panel().hasAttribute('aria-modal')).toBe(false);
    const last = el.querySelector<HTMLElement>('#last')!;
    last.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(false);
  });

  it('narrow screens add a scrim that closes it, mark it modal and keep Tab inside', async () => {
    await create(390);
    expect(scrim().classList.contains('open')).toBe(true);
    expect(panel().getAttribute('aria-modal')).toBe('true');
    scrim().click();
    expect(host.closes).toBe(1);

    host.open.set(true);
    fixture.detectChanges();
    const last = el.querySelector<HTMLElement>('#last')!;
    last.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(el.querySelector('.close'));
    const back = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(back);
    expect(document.activeElement).toBe(last);
  });

  it('follows a resize between docked and narrow', async () => {
    await create(1280);
    window.innerWidth = 500;
    window.dispatchEvent(new Event('resize'));
    fixture.detectChanges();
    expect(scrim().classList.contains('open')).toBe(true);
  });

  it('gives focus back to what opened it', async () => {
    await create(1280, false);
    const opener = el.querySelector<HTMLElement>('#opener')!;
    opener.focus();
    host.open.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.activeElement?.id).toBe('first');
    host.open.set(false);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.activeElement).toBe(opener);
  });
});
