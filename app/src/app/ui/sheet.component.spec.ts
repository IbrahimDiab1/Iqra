import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SheetComponent } from './sheet.component';

@Component({
  imports: [SheetComponent],
  template: `
    <f-sheet [open]="open()" [title]="'Filter'" [tall]="tall()" (closed)="closedCount = closedCount + 1">
      <p class="content"><button type="button">First action</button></p>
      <button sheet-foot type="button">Apply</button>
    </f-sheet>
  `,
})
class HostComponent {
  readonly open = signal(true);
  readonly tall = signal(false);
  closedCount = 0;
}

describe('SheetComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let el: HTMLElement;
  const originalWidth = window.innerWidth;

  function setup(width: number) {
    window.innerWidth = width;
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
  });

  afterEach(() => {
    window.innerWidth = originalWidth;
  });

  it('renders projected content and the footer slot when open', () => {
    setup(400);
    expect(el.querySelector('.content')?.textContent).toContain('First action');
    expect(el.querySelector('[sheet-foot]')?.textContent).toContain('Apply');
    expect(el.querySelector('[role="dialog"]')?.getAttribute('aria-modal')).toBe('true');
  });

  it('emits closed on Escape', () => {
    setup(400);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(host.closedCount).toBe(1);
  });

  it('emits closed when the scrim is clicked', () => {
    setup(400);
    (el.querySelector('.scrim') as HTMLElement).click();
    expect(host.closedCount).toBe(1);
  });

  it('uses the centered dialog layout at 720 px and wider', () => {
    setup(720);
    expect(el.querySelector('.panel')?.classList).toContain('dialog');
  });

  it('uses the bottom sheet layout below 720 px', () => {
    setup(719);
    expect(el.querySelector('.panel')?.classList).not.toContain('dialog');
  });

  it('focuses the first focusable element in the body when opened', async () => {
    setup(400);
    await fixture.whenStable();
    expect(document.activeElement?.textContent).toContain('First action');
  });
});
