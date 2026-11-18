import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { HighlightColor } from '../annotations/annotation.service';
import { COPY } from '../ui/copy';
import { SelectionToolbarComponent } from './selection-toolbar.component';
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
