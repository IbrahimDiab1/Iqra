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
  async textItems(page: number) {
    this.itemsAsked.push(page);
    return [];
  }
  async pageText() {
    return '';
  }
  textLayerFails = false;
  textLayers: { page: number; container: HTMLElement; signal: AbortSignal }[] = [];
  itemsAsked: number[] = [];
  renderTextLayer(page: number, container: HTMLElement, _w: number, signal: AbortSignal): Promise<void> {
    this.textLayers.push({ page, container, signal });
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
    [withText]="withText()"
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
  withText = signal(true);
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
  describe('text layer on demand', () => {
    const paint = async () => {
      host.renderer.calls.at(-1)!.resolve();
      await settle();
    };

    it('lays a text layer once the page is painted', async () => {
      await paint();
      expect(host.renderer.textLayers).toHaveLength(1);
      expect(host.renderer.textLayers[0].page).toBe(1);
    });

    it('builds no text layer for a page that does not need one, but reads its words ahead', async () => {
      host.withText.set(false);
      host.page.set(2);
      await settle();
      await paint();
      expect(host.renderer.textLayers).toHaveLength(0);
      expect(host.renderer.itemsAsked).toContain(2);
    });

    it('adds the layer when the page becomes the one being read, without drawing the page again', async () => {
      host.withText.set(false);
      host.page.set(2);
      await settle();
      await paint();
      const draws = host.renderer.calls.length;
      host.withText.set(true);
      await settle();
      expect(host.renderer.textLayers).toHaveLength(1);
      expect(host.renderer.calls).toHaveLength(draws);
    });

    it('drops the layer (and stops building it) when the page no longer needs it', async () => {
      await paint();
      const layer = host.renderer.textLayers[0];
      layer.container.append(document.createElement('span'));
      host.withText.set(false);
      await settle();
      expect(layer.signal.aborted).toBe(true);
      expect(layer.container.children).toHaveLength(0);
    });
  });
  describe('copy', () => {
    function selectWords(words: string[]) {
      const layer = el.querySelector('.text-layer') as HTMLElement;
      words.forEach((w, i) => {
        const span = document.createElement('span');
        span.textContent = w;
        span.dataset['item'] = String(i * 2);
        layer.append(span);
      });
      const spans = layer.querySelectorAll('span');
      const range = document.createRange();
      range.setStart(spans[0].firstChild!, 0);
      range.setEnd(spans[spans.length - 1].firstChild!, words[words.length - 1].length);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      return layer;
    }
    function copyEvent(layer: HTMLElement) {
      const store = new Map<string, string>();
      const data = { setData: (t: string, v: string) => store.set(t, v), getData: (t: string) => store.get(t) ?? '' };
      const e = new Event('copy', { bubbles: true, cancelable: true });
      Object.defineProperty(e, 'clipboardData', { value: data });
      layer.dispatchEvent(e);
      return { e, data };
    }

    it('copies the selected words with a space between them (the layer has no span for the gap)', () => {
      const layer = selectWords(['كلمة', 'أخرى', 'ثالثة']);
      const { e, data } = copyEvent(layer);
      expect(data.getData('text/plain')).toBe('كلمة أخرى ثالثة');
      expect(e.defaultPrevented).toBe(true);
      window.getSelection()?.removeAllRanges();
    });

    it('leaves a copy alone when nothing is selected', () => {
      const layer = el.querySelector('.text-layer') as HTMLElement;
      window.getSelection()?.removeAllRanges();
      const { e, data } = copyEvent(layer);
      expect(data.getData('text/plain')).toBe('');
      expect(e.defaultPrevented).toBe(false);
    });
  });
});
