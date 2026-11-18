import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { COPY } from '../ui/copy';
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
}

@Component({
  imports: [PageViewComponent],
  template: `<iqra-page-view
    [renderer]="renderer"
    [page]="page()"
    [fitWidthPx]="fit()"
    [zoom]="zoom()"
    [theme]="theme()"
    (rendered)="done.push($event)"
  />`,
})
class HostComponent {
  renderer = new FakeRenderer();
  page = signal(1);
  fit = signal(400);
  zoom = signal(1);
  theme = signal<'paper' | 'sepia' | 'night'>('paper');
  done: number[] = [];
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
});
