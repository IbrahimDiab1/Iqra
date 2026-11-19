import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import type { Rect } from '../core/models';
import { AreaToolDirective } from './area-tool.directive';

@Component({
  imports: [AreaToolDirective],
  template: `<div class="box" iqraAreaTool [enabled]="enabled()" [page]="4" (areaDrawn)="drawn.push($event)"></div><p class="outside"></p>`,
})
class HostComponent {
  enabled = signal(true);
  drawn: { page: number; rect: Rect }[] = [];
}

function ptr(type: string, x: number, y: number, id = 1): Event {
  const init = { clientX: x, clientY: y, pointerId: id, isPrimary: true, bubbles: true, cancelable: true };
  const e = typeof PointerEvent !== 'undefined' ? new PointerEvent(type, init) : new MouseEvent(type, init);
  if ((e as PointerEvent).pointerId !== id) Object.defineProperty(e, 'pointerId', { value: id });
  return e;
}

describe('AreaToolDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let box: HTMLElement;
  let outside: HTMLElement;

  beforeEach(() => {
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
    box = fixture.nativeElement.querySelector('.box');
    outside = fixture.nativeElement.querySelector('.outside');
    // The box is 200 x 400 at the viewport origin.
    box.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 400, width: 200, height: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  });

  function drag(from: [number, number], to: [number, number], target: HTMLElement = box) {
    target.dispatchEvent(ptr('pointerdown', from[0], from[1]));
    box.dispatchEvent(ptr('pointermove', (from[0] + to[0]) / 2, (from[1] + to[1]) / 2));
    box.dispatchEvent(ptr('pointermove', to[0], to[1]));
    box.dispatchEvent(ptr('pointerup', to[0], to[1]));
  }

  it('emits the normalized rect of a drag, with the page', () => {
    drag([50, 40], [150, 100]);
    expect(host.drawn).toHaveLength(1);
    expect(host.drawn[0].page).toBe(4);
    const r = host.drawn[0].rect;
    expect(r.x).toBeCloseTo(0.25);
    expect(r.y).toBeCloseTo(0.1);
    expect(r.w).toBeCloseTo(0.5);
    expect(r.h).toBeCloseTo(0.15);
  });

  it('works when dragging up and to the left', () => {
    drag([150, 100], [50, 40]);
    expect(host.drawn[0].rect.x).toBeCloseTo(0.25);
    expect(host.drawn[0].rect.h).toBeCloseTo(0.15);
  });

  it('shows a rubber band while dragging and removes it afterwards', () => {
    box.dispatchEvent(ptr('pointerdown', 50, 40));
    box.dispatchEvent(ptr('pointermove', 150, 100));
    const band = box.querySelector<HTMLElement>('.area-preview')!;
    expect(band).not.toBeNull();
    expect(band.style.width).toBe('100px');
    expect(band.style.height).toBe('60px');
    box.dispatchEvent(ptr('pointerup', 150, 100));
    expect(box.querySelector('.area-preview')).toBeNull();
  });

  it('ignores a drag smaller than 12 px in either dimension', () => {
    drag([50, 40], [55, 45]);
    drag([50, 40], [150, 48]);
    drag([50, 40], [58, 200]);
    expect(host.drawn).toEqual([]);
    expect(box.querySelector('.area-preview')).toBeNull();
  });

  it('ignores a drag that started outside the box', () => {
    drag([50, 40], [150, 100], outside);
    expect(host.drawn).toEqual([]);
    box.dispatchEvent(ptr('pointerdown', 300, 40));
    box.dispatchEvent(ptr('pointerup', 150, 100));
    expect(host.drawn).toEqual([]);
  });

  it('clamps a drag past the box to 0..1', () => {
    drag([150, 300], [500, 900]);
    const r = host.drawn[0].rect;
    expect(r.x).toBeCloseTo(0.75);
    expect(r.y).toBeCloseTo(0.75);
    expect(r.w).toBeCloseTo(0.25);
    expect(r.h).toBeCloseTo(0.25);
    drag([50, 40], [-100, -50]);
    const q = host.drawn[1].rect;
    expect(q.x).toBe(0);
    expect(q.y).toBe(0);
    expect(q.w).toBeCloseTo(0.25);
    expect(q.h).toBeCloseTo(0.1);
  });

  it('emits nothing while disabled', () => {
    host.enabled.set(false);
    fixture.detectChanges();
    drag([50, 40], [150, 100]);
    expect(host.drawn).toEqual([]);
    expect(box.querySelector('.area-preview')).toBeNull();
  });

  it('a cancelled drag emits nothing and removes the band', () => {
    box.dispatchEvent(ptr('pointerdown', 50, 40));
    box.dispatchEvent(ptr('pointermove', 150, 100));
    box.dispatchEvent(ptr('pointercancel', 150, 100));
    box.dispatchEvent(ptr('pointerup', 150, 100));
    expect(host.drawn).toEqual([]);
    expect(box.querySelector('.area-preview')).toBeNull();
  });
});
