import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ZoomGesturesDirective } from './zoom-gestures.directive';

@Component({
  imports: [ZoomGesturesDirective],
  template: `<div
    iqraZoomGestures
    [zoom]="zoom()"
    [view]="view()"
    [lastCustomZoom]="last()"
    (zoomChange)="zooms.push($event)"
  ><input /></div>`,
})
class HostComponent {
  zoom = signal(1);
  view = signal<'page' | 'reflow'>('page');
  last = signal(1);
  zooms: number[] = [];
}

function ptr(type: string, id: number, x: number, y = 0): Event {
  const init = { clientX: x, clientY: y, pointerId: id, bubbles: true, cancelable: true };
  const e = typeof PointerEvent !== 'undefined' ? new PointerEvent(type, { ...init, pointerType: 'touch' }) : new MouseEvent(type, init);
  if (!('pointerId' in e) || (e as PointerEvent).pointerId !== id) Object.defineProperty(e, 'pointerId', { value: id });
  if ((e as PointerEvent).pointerType !== 'touch') Object.defineProperty(e, 'pointerType', { value: 'touch' });
  return e;
}

const frame = () => new Promise((r) => setTimeout(r, 40));

describe('ZoomGesturesDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let box: HTMLElement;
  let now = 0;

  beforeEach(() => {
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    TestBed.configureTestingModule({ imports: [HostComponent] });
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
    box = (fixture.nativeElement as HTMLElement).querySelector('div') as HTMLElement;
  });
  afterEach(() => vi.restoreAllMocks());

  it('two-finger pinch from 100 px to 200 px at zoom 1 emits 2', async () => {
    box.dispatchEvent(ptr('pointerdown', 1, 100));
    box.dispatchEvent(ptr('pointerdown', 2, 200));
    box.dispatchEvent(ptr('pointermove', 2, 300));
    await frame();
    expect(host.zooms[host.zooms.length - 1]).toBe(2);
  });

  it('ctrl+wheel up zooms in and prevents the browser zoom', () => {
    const e = new WheelEvent('wheel', { deltaY: -10, ctrlKey: true, bubbles: true, cancelable: true });
    box.dispatchEvent(e);
    expect(host.zooms).toEqual([1.25]);
    expect(e.defaultPrevented).toBe(true);
  });

  it('plain wheel is left alone', () => {
    const e = new WheelEvent('wheel', { deltaY: -10, bubbles: true, cancelable: true });
    box.dispatchEvent(e);
    expect(host.zooms).toEqual([]);
    expect(e.defaultPrevented).toBe(false);
  });

  function tap(x: number, at: number) {
    now = at;
    box.dispatchEvent(ptr('pointerdown', 1, x, 50));
    box.dispatchEvent(ptr('pointerup', 1, x, 50));
  }

  it('double tap at zoom 1.5 (last custom 1.5) fits to width', () => {
    host.zoom.set(1.5);
    host.last.set(1.5);
    fixture.detectChanges();
    tap(100, 1000);
    tap(105, 1200);
    expect(host.zooms).toEqual([1]);
  });

  it('double tap at zoom 1 zooms to 1.5 (last custom)', () => {
    host.last.set(1.5);
    fixture.detectChanges();
    tap(100, 1000);
    tap(105, 1200);
    expect(host.zooms).toEqual([1.5]);
  });

  it('two slow taps are not a double tap', () => {
    tap(100, 1000);
    tap(100, 1500);
    expect(host.zooms).toEqual([]);
  });

  it('Ctrl+= / Ctrl+- / Ctrl+0 zoom from the keyboard', () => {
    const key = (k: string, target: Element = document.body) =>
      target.dispatchEvent(new KeyboardEvent('keydown', { key: k, ctrlKey: true, bubbles: true, cancelable: true }));
    key('=');
    expect(host.zooms).toEqual([1.25]);
    key('-');
    expect(host.zooms).toEqual([1.25, 0.75]);
    key('0');
    expect(host.zooms).toEqual([1.25, 0.75, 1]);
  });

  it('ignores zoom keys typed in an input', () => {
    const input = box.querySelector('input') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: '=', ctrlKey: true, bubbles: true, cancelable: true }));
    expect(host.zooms).toEqual([]);
  });
});
