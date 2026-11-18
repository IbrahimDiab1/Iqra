import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { COPY } from '../ui/copy';
import type { Annotation } from '../core/models';
import { PageRenderer, PageSize } from './pdf-session';
import { PageViewComponent } from './page-view.component';

interface Call {
  page: number;
  canvas: HTMLCanvasElement;
  cssWidthPx: number;
  signal: AbortSignal;
  resolve: () => void;
  reject: (e: unknown) => void;
}

class FakeRenderer implements PageRenderer {
  numPages = 10;
  calls: Call[] = [];
  size: PageSize = { widthPt: 500, heightPt: 700 };
  async pageSize(): Promise<PageSize> {
    return this.size;
  }
  renderPage(page: number, canvas: HTMLCanvasElement, cssWidthPx: number, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.calls.push({ page, canvas, cssWidthPx, signal, resolve, reject });
      signal.addEventListener('abort', () => {
        const e = new Error('aborted');
        e.name = 'AbortError';
        reject(e);
      });
    });
  }
  async textItems() {
    return [];
  }
  async pageText() {
    return '';
  }
  textLayerFails = false;
  renderTextLayer(): Promise<void> {
    return this.textLayerFails ? Promise.reject(new Error('no text')) : Promise.resolve();
  }
}

@Component({
  imports: [PageViewComponent],
  template: `<iqra-page-view
    [renderer]="renderer"
    [page]="page()"
    [fitWidthPx]="fit()"
    [zoom]="zoom()"
    [theme]="theme()"
    [annotations]="anns()"
    (rendered)="done.push($event)"
    (annotationTap)="taps.push($event)"
    (pageTap)="pageTaps = pageTaps + 1"
  />`,
})
class HostComponent {
  renderer = new FakeRenderer();
  page = signal(1);
  fit = signal(400);
  zoom = signal(1);
  theme = signal<'paper' | 'sepia' | 'night'>('paper');
  done: number[] = [];
  anns = signal<Annotation[]>([]);
  taps: Annotation[] = [];
  pageTaps = 0;
}

describe('PageViewComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let el: HTMLElement;

  async function settle() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    el = fixture.nativeElement as HTMLElement;
    await settle();
  });

  it('renders at fitWidthPx times zoom', async () => {
    expect(host.renderer.calls).toHaveLength(1);
    expect(host.renderer.calls[0].page).toBe(1);
    expect(host.renderer.calls[0].cssWidthPx).toBe(400);

    host.zoom.set(2);
    await settle();
    await vi.waitFor(() => expect(host.renderer.calls).toHaveLength(2));
    expect(host.renderer.calls[1].cssWidthPx).toBe(800);
  });

  it('sizes the page box from the page aspect ratio', async () => {
    const box = el.querySelector('.box') as HTMLElement;
    expect(box.style.width).toBe('400px');
    expect(parseFloat(box.style.height)).toBeCloseTo(560, 0);
  });

  it('aborts the previous render when the page changes', async () => {
    const first = host.renderer.calls[0];
    host.page.set(2);
    await settle();
    expect(first.signal.aborted).toBe(true);
    expect(host.renderer.calls).toHaveLength(2);
    expect(host.renderer.calls[1].page).toBe(2);
  });

  it('only the last of several rapid page changes emits rendered', async () => {
    for (const p of [2, 3, 4, 5, 6]) {
      host.page.set(p);
      await settle();
    }
    for (const c of host.renderer.calls) c.resolve();
    await settle();
    expect(host.done).toEqual([6]);
  });

  it('shows a failure with Retry, which renders again', async () => {
    host.renderer.calls[0].reject(new Error('boom'));
    await settle();
    expect(el.textContent).toContain(COPY.reader.pageFailed);
    const retry = el.querySelector('button.retry') as HTMLButtonElement;
    expect(retry.textContent).toContain(COPY.reader.retry);
    retry.click();
    await settle();
    expect(host.renderer.calls).toHaveLength(2);
    host.renderer.calls[1].resolve();
    await settle();
    expect(el.textContent).not.toContain(COPY.reader.pageFailed);
    expect(host.done).toEqual([1]);
  });

  it('clears the failure overlay when a later render succeeds', async () => {
    host.renderer.calls[0].reject(new Error('boom'));
    await settle();
    expect(el.textContent).toContain(COPY.reader.pageFailed);
    host.zoom.set(2);
    await settle();
    await vi.waitFor(() => expect(host.renderer.calls).toHaveLength(2));
    host.renderer.calls[1].resolve();
    await settle();
    expect(el.textContent).not.toContain(COPY.reader.pageFailed);
  });

  it('ignores abort rejections', async () => {
    host.page.set(2);
    await settle();
    expect(el.textContent).not.toContain(COPY.reader.pageFailed);
  });

  it('aborts and zeroes the canvas on destroy', async () => {
    const call = host.renderer.calls[0];
    call.canvas.width = 300;
    call.canvas.height = 400;
    fixture.destroy();
    expect(call.signal.aborted).toBe(true);
    expect(call.canvas.width).toBe(0);
    expect(call.canvas.height).toBe(0);
  });

  it('applies the theme filter', async () => {
    const canvas = el.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas.style.filter).toBe('');
    host.theme.set('night');
    await settle();
    expect(canvas.style.filter).toContain('invert(1)');
    host.theme.set('sepia');
    await settle();
    expect(canvas.style.filter).toContain('sepia(');
  });
  describe('taps on the text layer', () => {
    const highlight = {
      id: 'h1',
      bookId: 'b',
      type: 'highlight',
      page: 1,
      color: 'yellow',
      text: { page: 1, start: { item: 0, offset: 0 }, end: { item: 0, offset: 3 }, quote: 'abc', rects: [{ x: 0.1, y: 0.1, w: 0.3, h: 0.1 }] },
      tags: [],
      createdAt: 1,
      updatedAt: 1,
      deviceId: 'd',
      deleted: false,
    } as Annotation;

    function click(xFrac: number, yFrac: number) {
      const box = el.querySelector('.box') as HTMLElement;
      box.getBoundingClientRect = () => ({ left: 10, top: 20, width: 400, height: 560, right: 410, bottom: 580, x: 10, y: 20, toJSON: () => ({}) }) as DOMRect;
      const layer = el.querySelector('.text-layer') as HTMLElement;
      layer.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10 + 400 * xFrac, clientY: 20 + 560 * yFrac }));
    }

    beforeEach(async () => {
      host.anns.set([highlight]);
      await settle();
    });

    it('emits annotationTap for a collapsed selection over a highlight', () => {
      click(0.2, 0.15);
      expect(host.taps.map((a) => a.id)).toEqual(['h1']);
      expect(host.pageTaps).toBe(0);
    });

    it('emits pageTap elsewhere', () => {
      click(0.8, 0.8);
      expect(host.taps).toEqual([]);
      expect(host.pageTaps).toBe(1);
    });

    it('a page whose text layer failed still passes a tap through as pageTap', async () => {
      host.page.set(2);
      host.renderer.textLayerFails = true;
      await settle();
      host.renderer.calls[host.renderer.calls.length - 1].resolve();
      await settle();
      expect(el.querySelectorAll('.text-layer span')).toHaveLength(0);
      click(0.8, 0.8);
      expect(host.pageTaps).toBe(1);
      expect(host.taps).toEqual([]);
    });

    it('emits neither while text is selected', () => {
      const p = document.createElement('p');
      p.textContent = 'selected';
      el.appendChild(p);
      const range = document.createRange();
      range.selectNodeContents(p);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      click(0.2, 0.15);
      sel.removeAllRanges();
      expect(host.taps).toEqual([]);
      expect(host.pageTaps).toBe(0);
    });
  });
});
