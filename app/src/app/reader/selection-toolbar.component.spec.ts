import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { HighlightColor } from '../annotations/annotation.service';
import { COPY } from '../ui/copy';
import { SelectionToolbarComponent, placeToolbar, TOUCH_CLEARANCE } from './selection-toolbar.component';
import type { PendingSelection } from './selection.service';

const SELECTION: PendingSelection = {
  page: 1,
  start: { item: 0, offset: 0 },
  end: { item: 0, offset: 3 },
  quote: 'abc',
  rect: { left: 100, top: 200, right: 180, bottom: 220, width: 80, height: 20, x: 100, y: 200, toJSON: () => ({}) } as DOMRect,
  source: 'page',
};

@Component({
  imports: [SelectionToolbarComponent],
  template: `<iqra-selection-toolbar
    [selection]="sel()"
    (color)="colors.push($event)"
    (note)="notes = notes + 1"
    (copy)="copies = copies + 1"
  />`,
})
class HostComponent {
  sel = signal<PendingSelection | null>(SELECTION);
  colors: HighlightColor[] = [];
  notes = 0;
  copies = 0;
}

describe('SelectionToolbarComponent', () => {
  function setup() {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    return { fixture, host: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  it('emits color when a color dot is clicked', () => {
    const { fixture, host, el } = setup();
    el.querySelector<HTMLButtonElement>(`button[aria-label="${COPY.annotations.colors.green}"]`)!.click();
    fixture.detectChanges();
    expect(host.colors).toEqual(['green']);
  });

  it('has four color buttons, each with an aria-label', () => {
    const { el } = setup();
    const dots = el.querySelectorAll<HTMLButtonElement>('button.dot');
    expect(dots).toHaveLength(4);
    dots.forEach((d) => expect(d.getAttribute('aria-label')).toBeTruthy());
  });

  it('emits copy and note', () => {
    const { host, el } = setup();
    el.querySelector<HTMLButtonElement>('button.copy')!.click();
    el.querySelector<HTMLButtonElement>('button.note')!.click();
    expect(host.copies).toBe(1);
    expect(host.notes).toBe(1);
  });

  it('renders nothing without a selection', () => {
    const { fixture, host, el } = setup();
    host.sel.set(null);
    fixture.detectChanges();
    expect(el.querySelector('[role="toolbar"]')).toBeNull();
  });
});

describe('placeToolbar', () => {
  const rect = (top: number, bottom: number, left = 100, right = 180) =>
    ({ left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
  const view = { vw: 1000, vh: 700 };

  it('sits below the selection with an 8 px gap', () => {
    expect(placeToolbar({ rect: rect(200, 220), touch: false, ...view }).top).toBe(228);
  });

  it('flips above the selection only when below would run off the bottom', () => {
    // 700 - 48 - 8 = 644 is the lowest a bar may start; a selection ending at 640 would put it at 648.
    expect(placeToolbar({ rect: rect(600, 640), touch: false, ...view }).top).toBe(600 - 48 - 8);
  });

  it('stays at the bottom edge when neither side has room', () => {
    expect(placeToolbar({ rect: rect(10, 690), touch: false, ...view }).top).toBe(700 - 48 - 8);
  });

  it('on touch it clears the system selection handles by an extra 28 px, below or above', () => {
    expect(TOUCH_CLEARANCE).toBe(28);
    expect(placeToolbar({ rect: rect(200, 220), touch: true, ...view }).top).toBe(220 + 8 + 28);
    expect(placeToolbar({ rect: rect(600, 640), touch: true, ...view }).top).toBe(600 - 48 - 8 - 28);
  });

  it('is centred on the selection and kept inside the viewport horizontally', () => {
    expect(placeToolbar({ rect: rect(200, 220, 400, 500), touch: false, ...view }).left).toBe(450 - 148);
    expect(placeToolbar({ rect: rect(200, 220, 0, 20), touch: false, ...view }).left).toBe(8);
    expect(placeToolbar({ rect: rect(200, 220, 980, 1000), touch: false, ...view }).left).toBe(1000 - 296 - 8);
  });
});
