import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOCK } from '../core/clock';
import { DB, IqraDb } from '../core/db';
import { newId } from '../core/ids';
import { OnboardingSheet } from './onboarding.sheet';
import { ONBOARDING_COPY } from './onboarding-copy';

@Component({
  imports: [OnboardingSheet],
  template: `<iqra-onboarding-sheet [open]="open()" (closed)="closes = closes + 1; open.set(false)" (addBookRequested)="adds = adds + 1" />`,
})
class Host {
  open = signal(true);
  closes = 0;
  adds = 0;
}

describe('OnboardingSheet', () => {
  let db: IqraDb;
  let fixture: ComponentFixture<Host>;
  let el: HTMLElement;
  const c = ONBOARDING_COPY;
  const tid = (id: string) => el.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
  const stepIndex = () => el.querySelector('[data-testid="onboarding-step"]')!.getAttribute('data-step');
  const title = () => el.querySelector('h3')!.textContent!.trim();

  beforeEach(() => {
    db = new IqraDb(`iqra-test-${newId()}`);
    TestBed.configureTestingModule({ providers: [{ provide: DB, useValue: db }, { provide: CLOCK, useValue: { now: () => 5000 } }] });
    fixture = TestBed.createComponent(Host);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  afterEach(async () => {
    fixture.destroy();
    TestBed.resetTestingModule();
    await db.delete();
  });

  it('walks through the steps with Next and Back, and shows progress dots', () => {
    expect(title()).toBe(c.steps[0].title);
    expect(el.querySelectorAll('.dot')).toHaveLength(c.steps.length);
    expect(el.querySelector('.dots')!.getAttribute('aria-label')).toBe(c.progress(1, c.steps.length));
    expect(tid('onboarding-back')).toBeNull();
    tid('onboarding-next')!.click();
    fixture.detectChanges();
    expect(stepIndex()).toBe('1');
    expect(tid('onboarding-back')).not.toBeNull();
    expect(el.querySelectorAll('.dot.on')).toHaveLength(1);
    tid('onboarding-back')!.click();
    fixture.detectChanges();
    expect(stepIndex()).toBe('0');
  });

  it('Skip closes and records that the intro was seen, so it is shown once', async () => {
    tid('onboarding-skip')!.click();
    await vi.waitFor(async () => expect((await db.settings.get('settings'))?.introSeen).toBe(true));
    expect(fixture.componentInstance.closes).toBe(1);
  });

  it('the last step says Done and finishing records the flag', async () => {
    for (let i = 0; i < c.steps.length - 1; i++) {
      tid('onboarding-next')!.click();
      fixture.detectChanges();
    }
    expect(tid('onboarding-next')!.textContent!.trim()).toBe(c.done);
    tid('onboarding-next')!.click();
    await vi.waitFor(async () => expect((await db.settings.get('settings'))?.introSeen).toBe(true));
    expect(fixture.componentInstance.closes).toBe(1);
  });

  it('the book step offers to add a book and closes the intro first', async () => {
    tid('onboarding-next')!.click();
    tid('onboarding-next')!.click();
    fixture.detectChanges();
    tid('onboarding-add')!.click();
    await vi.waitFor(() => expect(fixture.componentInstance.adds).toBe(1));
    expect(fixture.componentInstance.closes).toBe(1);
  });

  it('the goal step saves an optional goal with the chosen period', async () => {
    for (let i = 0; i < c.steps.length - 1; i++) {
      tid('onboarding-next')!.click();
      fixture.detectChanges();
    }
    const save = [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent!.trim() === c.saveGoal)!;
    expect(save.disabled).toBe(true);
    el.querySelector<HTMLButtonElement>('[data-period=week]')!.click();
    const input = el.querySelector<HTMLInputElement>('#onb-target')!;
    input.value = '30';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    save.click();
    await vi.waitFor(async () => expect(await db.goals.toArray()).toMatchObject([{ categoryId: null, measure: 'pages', target: 30, period: 'week' }]));
  });

  it('opens again from the first step', () => {
    tid('onboarding-next')!.click();
    fixture.detectChanges();
    fixture.componentInstance.open.set(false);
    fixture.detectChanges();
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    expect(stepIndex()).toBe('0');
  });

  it('a goal is not created unless the user chooses to: finishing without saving leaves none', async () => {
    tid('onboarding-skip')!.click();
    await vi.waitFor(() => expect(fixture.componentInstance.closes).toBe(1));
    expect(await db.goals.count()).toBe(0);
  });
});
