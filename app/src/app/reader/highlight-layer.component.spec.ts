import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Annotation } from '../core/models';
import { HighlightLayerComponent } from './highlight-layer.component';

function ann(over: Partial<Annotation>): Annotation {
  return {
    id: 'a1',
    bookId: 'b',
    type: 'highlight',
    page: 1,
    color: 'yellow',
    text: { page: 1, start: { item: 0, offset: 0 }, end: { item: 0, offset: 3 }, quote: 'abc', rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.05 }] },
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    deviceId: 'd',
    deleted: false,
    ...over,
  } as Annotation;
}

@Component({
  imports: [HighlightLayerComponent],
  template: `<iqra-highlight-layer [annotations]="anns()" [flashId]="flash()" />`,
})
class HostComponent {
  anns = signal<Annotation[]>([]);
  flash = signal<string | null>(null);
}

describe('HighlightLayerComponent', () => {
  function setup(anns: Annotation[], flash: string | null = null) {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.anns.set(anns);
    fixture.componentInstance.flash.set(flash);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('draws one percent-positioned div per rect', () => {
    const el = setup([
      ann({ text: { page: 1, start: { item: 0, offset: 0 }, end: { item: 1, offset: 1 }, quote: 'q', rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.05 }, { x: 0.5, y: 0.25, w: 0.2, h: 0.05 }] } }),
    ]);
    const fills = el.querySelectorAll<HTMLElement>('.fill');
    expect(fills).toHaveLength(2);
    expect(fills[0].style.left).toBe('10%');
    expect(fills[0].style.top).toBe('20%');
    expect(fills[0].style.width).toBe('30%');
    expect(fills[0].style.background).toContain('--hl-yellow');
  });

  it('draws an area annotation as a fill from its rect', () => {
    const el = setup([ann({ type: 'area', text: undefined, rect: { x: 0.2, y: 0.3, w: 0.4, h: 0.2 }, color: 'blue' })]);
    const fill = el.querySelector<HTMLElement>('.fill')!;
    expect(fill.style.left).toBe('20%');
    expect(fill.style.height).toBe('20%');
  });

  it('draws a note as an underline, not a fill', () => {
    const el = setup([ann({ type: 'note', color: undefined })]);
    expect(el.querySelectorAll('.underline')).toHaveLength(1);
    expect(el.querySelectorAll('.fill')).toHaveLength(0);
  });

  it('draws exactly one dot for an annotation with a body', () => {
    const rects = [{ x: 0.1, y: 0.2, w: 0.3, h: 0.05 }, { x: 0.5, y: 0.25, w: 0.2, h: 0.05 }];
    const el = setup([
      ann({ body: 'hello', text: { page: 1, start: { item: 0, offset: 0 }, end: { item: 1, offset: 1 }, quote: 'q', rects } }),
      ann({ id: 'a2' }),
    ]);
    expect(el.querySelectorAll('.dot')).toHaveLength(1);
  });

  it('flashes only the flashed annotation', () => {
    const el = setup([ann({}), ann({ id: 'a2' })], 'a2');
    const flashed = el.querySelectorAll('.flash');
    expect(flashed).toHaveLength(1);
    expect((flashed[0] as HTMLElement).dataset['id']).toBe('a2');
  });

  it('ignores side notes, summaries and bookmarks', () => {
    const el = setup([ann({ type: 'bookmark', text: undefined }), ann({ id: 'x', type: 'side-note', text: undefined })]);
    expect(el.querySelectorAll('.fill, .underline, .dot')).toHaveLength(0);
  });
});
