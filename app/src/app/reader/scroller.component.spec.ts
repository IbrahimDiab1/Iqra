import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { Place } from './jump-history';
import { PageRenderer, PageSize } from './pdf-session';
import { ScrollerComponent } from './scroller.component';
import { currentPageAt } from './virtualize';

const VIEW_W = 400;
const VIEW_H = 800;
const RATIO = 1.5; // 600 px tall at zoom 1
const GAP = 12;

class FakeRenderer implements PageRenderer {
  numPages = 100;
  async pageSize(): Promise<PageSize> {
    return { widthPt: 400, heightPt: 600 };
  }
  renderPage(_p: number, _c: HTMLCanvasElement, _w: number, signal: AbortSignal): Promise<void> {
    return new Promise<void>((_, reject) =>
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))),
    );
  }
  async textItems() {
    return [];
  }
  async pageText() {
    return '';
  }
}

@Component({
  imports: [ScrollerComponent],
  template: `<iqra-scroller
    [renderer]="renderer"
    [startPlace]="start"
    [zoom]="zoom()"
    theme="paper"
    (placeChange)="places.push($event)"
    (zoomChange)="zooms.push($event)"
    (tap)="taps = taps + 1"
  />`,
})
class HostComponent {
  renderer = new FakeRenderer();
  start: Place = { page: 1, offset: 0 };
  zoom = signal(1);
  places: Place[] = [];
  zooms: number[] = [];
  taps = 0;
}


describe('ScrollerComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let el: HTMLElement;

  const viewport = () => el.querySelector('.viewport') as HTMLElement;
  const views = () => Array.from(el.querySelectorAll('iqra-page-view'));
  const renderedPages = () => views().map((v) => Number((v.closest('[data-page]') as HTMLElement).dataset['page']));

  async function create(start: Place = { page: 1, offset: 0 }) {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    host.start = start;
    el = fixture.nativeElement as HTMLElement;
    // Start-up is async (page sizes, then the jump to the start place): wait for the page boxes.
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(el.querySelectorAll('[data-page]').length).toBe(100);
    });
    const target = Math.max(0, start.page - 1) * (RATIO * VIEW_W + GAP);
    if (start.page > 1) await vi.waitFor(() => expect(viewport().scrollTop).toBeGreaterThanOrEqual(target));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** Scrolls and waits until the first rendered page reflects the new position (after the rAF throttle). */
  async function scrollTo(top: number) {
    viewport().scrollTop = top;
    viewport().dispatchEvent(new Event('scroll'));
    const step = RATIO * VIEW_W + GAP;
    const centre = Math.min(99, Math.floor((top + VIEW_H / 2) / step)) + 1;
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(renderedPages()).toContain(centre);
    });
  }

  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(VIEW_W);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(VIEW_H);
  });
  afterEach(() => vi.restoreAllMocks());

  it('renders only the visible pages plus one viewport of overscan', async () => {
    await create();
    // window is [-800, 1600]; tops are 0, 612, 1224, 1836...
    expect(renderedPages()).toEqual([1, 2, 3]);
    expect(el.querySelectorAll('[data-page]').length).toBe(100);
  });

  it('scrolling updates the rendered set and emits the page', async () => {
    await create();
    await scrollTo(5000);
    const pages = renderedPages();
    const expectedCentre = Math.floor((5000 + VIEW_H / 2) / (RATIO * VIEW_W + GAP)) + 1;
    expect(pages).toContain(expectedCentre);
    expect(pages).not.toContain(1);
    await vi.waitFor(() => expect(host.places[host.places.length - 1]?.page).toBe(expectedCentre));
  });

  it('a fast scroll through 50 pages never keeps more than visible + overscan canvases', async () => {
    await create();
    let max = 0;
    for (let page = 1; page <= 50; page++) {
      await scrollTo(page * (RATIO * VIEW_W + GAP));
      max = Math.max(max, views().length);
    }
    // 800 px viewport + 2 x 800 px overscan = 2400 px of 612 px pages: at most 5 pages.
    expect(max).toBeLessThanOrEqual(5);
    expect(views().length).toBeLessThanOrEqual(5);
  });

  it('starts at startPlace', async () => {
    await create({ page: 40, offset: 0.5 });
    const h = RATIO * VIEW_W;
    expect(Math.abs(viewport().scrollTop - (39 * (h + GAP) + 0.5 * h))).toBeLessThanOrEqual(1);
  });

  it('scrollTo puts the page at the top', async () => {
    await create();
    const scroller = fixture.debugElement.children[0].componentInstance as ScrollerComponent;
    scroller.scrollTo({ page: 10, offset: 0 });
    expect(viewport().scrollTop).toBeCloseTo(9 * (RATIO * VIEW_W + GAP), 0);
  });

  it('zooming keeps the page under the viewport centre', async () => {
    await create();
    await scrollTo(3000);
    const at = (zoom: number) => {
      const h = RATIO * VIEW_W * zoom;
      const n = 100;
      const tops = Array.from({ length: n }, (_, i) => i * (h + GAP));
      return currentPageAt({ scrollTop: viewport().scrollTop, viewportH: VIEW_H, tops, heights: Array(n).fill(h) }).index;
    };
    const before = at(1);
    host.zoom.set(2);
    fixture.detectChanges();
    await fixture.whenStable();
    await vi.waitFor(() => expect(Number(el.querySelector('.column')?.getAttribute('style')?.match(/height: (\d+)/)?.[1])).toBeGreaterThan(100 * 1200));
    expect(at(2)).toBe(before);
  });

  it('centres pages narrower than the viewport at zoom 0.5 and left-aligns wider ones', async () => {
    await create();
    host.zoom.set(0.5);
    fixture.detectChanges();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect((el.querySelector('[data-page="1"]') as HTMLElement).style.left).toBe('100px');
    });
    host.zoom.set(2);
    fixture.detectChanges();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect((el.querySelector('[data-page="1"]') as HTMLElement).style.left).toBe('0px');
    });
  });

  it('emits tap for a stationary press', async () => {
    await create();
    const init = { clientX: 5, clientY: 5, pointerId: 1, bubbles: true };
    viewport().dispatchEvent(new MouseEvent('pointerdown', init));
    viewport().dispatchEvent(new MouseEvent('pointerup', init));
    expect(host.taps).toBe(1);
  });
});
