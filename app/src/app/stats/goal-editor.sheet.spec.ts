import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOCK } from '../core/clock';
import { DB, IqraDb } from '../core/db';
import { newId } from '../core/ids';
import type { Category, Goal } from '../core/models';
import { Repo } from '../core/repo';
import { ToastService } from '../ui/toast.service';
import { GoalEditorSheet } from './goal-editor.sheet';
import { STATS_COPY } from './stats-copy';

@Component({
  imports: [GoalEditorSheet],
  template: `<iqra-goal-editor-sheet [open]="open()" [goal]="goal()" [categories]="categories" (closed)="closes = closes + 1; open.set(false)" />`,
})
class Host {
  open = signal(true);
  goal = signal<Goal | null>(null);
  categories: Category[] = [{ id: 'c1', name: 'Fiqh', order: 0, deviceId: 'd', updatedAt: 1 }];
  closes = 0;
}

describe('GoalEditorSheet', () => {
  let db: IqraDb;
  let fixture: ComponentFixture<Host>;
  let el: HTMLElement;
  const c = STATS_COPY.goals;

  const btn = (text: string) => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent!.trim() === text)!;
  const field = () => el.querySelector<HTMLInputElement>('#goal-target')!;
  function type(value: string): void {
    field().value = value;
    field().dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

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

  it('will not save a target that is empty, zero or negative', () => {
    expect(btn(c.save).disabled).toBe(true);
    type('0');
    expect(btn(c.save).disabled).toBe(true);
    type('-5');
    expect(btn(c.save).disabled).toBe(true);
    type('30');
    expect(btn(c.save).disabled).toBe(false);
  });

  it('saves a new goal for the chosen category and measure', async () => {
    btn('Fiqh').click();
    btn(c.pages).click();
    type('40');
    btn(c.save).click();
    await vi.waitFor(async () => expect(await db.goals.toArray()).toHaveLength(1));
    expect(await db.goals.toArray()).toMatchObject([{ categoryId: 'c1', measure: 'pages', target: 40 }]);
    expect(fixture.componentInstance.closes).toBe(1);
  });

  it('shows hours and minutes as helper text for time goals', () => {
    btn(c.time).click();
    type('125');
    fixture.detectChanges();
    expect(el.textContent).toContain('2 h 05 min');
  });

  it('edits an existing goal', async () => {
    const g: Goal = { id: 'g1', deviceId: 'd', updatedAt: 1, categoryId: null, measure: 'time', target: 60 };
    await db.goals.put(g);
    fixture.componentInstance.goal.set(g);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(field().value).toBe('60');
    type('90');
    btn(c.save).click();
    await vi.waitFor(async () => expect((await db.goals.get('g1'))!.target).toBe(90));
  });

  it('deleting shows an Undo toast that restores the goal', async () => {
    const g: Goal = { id: 'g1', deviceId: 'd', updatedAt: 1, categoryId: null, measure: 'time', target: 60 };
    await db.goals.put(g);
    fixture.componentInstance.goal.set(g);
    fixture.detectChanges();
    btn(c.delete).click();
    const toast = TestBed.inject(ToastService);
    await vi.waitFor(() => expect(toast.current()?.undo).toBeTypeOf('function'));
    expect((await db.goals.get('g1'))!.deleted).toBe(true);
    toast.undo();
    await vi.waitFor(async () => expect((await db.goals.get('g1'))!.deleted).toBeUndefined());
  });

  it('has no Delete button for a new goal', () => {
    expect([...el.querySelectorAll('button')].some((b) => b.textContent!.trim() === c.delete)).toBe(false);
  });

  it('a failed save keeps the sheet open and shows the error toast', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(TestBed.inject(Repo), 'put').mockRejectedValue(new Error('disk full'));
    type('30');
    btn(c.save).click();
    const toast = TestBed.inject(ToastService);
    await vi.waitFor(() => expect(toast.current()?.message).toBe(c.saveFailed));
    expect(fixture.componentInstance.closes).toBe(0);
    warn.mockRestore();
  });

  it('a failed delete keeps the sheet open and shows the error toast', async () => {
    const g: Goal = { id: 'g1', deviceId: 'd', updatedAt: 1, categoryId: null, measure: 'time', target: 60 };
    await db.goals.put(g);
    fixture.componentInstance.goal.set(g);
    fixture.detectChanges();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(TestBed.inject(Repo), 'softDelete').mockRejectedValue(new Error('disk full'));
    btn(c.delete).click();
    const toast = TestBed.inject(ToastService);
    await vi.waitFor(() => expect(toast.current()?.message).toBe(c.saveFailed));
    expect(fixture.componentInstance.closes).toBe(0);
    warn.mockRestore();
  });
});
