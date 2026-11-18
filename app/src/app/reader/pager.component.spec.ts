import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PageRenderer, PageSize } from './pdf-session';
import { PagerComponent } from './pager.component';

class FakeRenderer implements PageRenderer {
  numPages = 10;
  async pageSize(): Promise<PageSize> {
    return { widthPt: 500, heightPt: 700 };
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
  imports: [PagerComponent],
  template: `<iqra-pager
    [renderer]="renderer"
    [page]="page()"
    [zoom]="zoom()"
    [rtl]="rtl()"
    theme="paper"
    (pageChange)="changes.push($event)"
    (zoomChange)="zooms.push($event)"
    (tap)="taps = taps + 1"
  />`,
})
class HostComponent {
  renderer = new FakeRenderer();
  page = signal(5);
  zoom = signal(1);
  rtl = signal(false);
  changes: number[] = [];
  zooms: number[] = [];
  taps = 0;
}

function pointer(type: string, x: number, y = 0): Event {
  const init = { clientX: x, clientY: y, pointerId: 1, bubbles: true, cancelable: true };
  if (typeof PointerEvent !== 'undefined') return new PointerEvent(type, init);
  const e = new MouseEvent(type, init);
  Object.defineProperty(e, 'pointerId', { value: 1 });
  return e;
}

describe('PagerComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let el: HTMLElement;
  let now = 0;

  const track = () => el.querySelector('.track') as HTMLElement;
  const viewport = () => el.querySelector('.viewport') as HTMLElement;

  /** Drags from x=200 by dx over dtMs. */
  async function drag(dx: number, dtMs: number, dy = 0) {
    const t = viewport();
    now = 1000;
    t.dispatchEvent(pointer('pointerdown', 200, 100));
    now = 1000 + dtMs / 2;
    t.dispatchEvent(pointer('pointermove', 200 + dx / 2, 100 + dy / 2));
    now = 1000 + dtMs;
    t.dispatchEvent(pointer('pointermove', 200 + dx, 100 + dy));
    t.dispatchEvent(pointer('pointerup', 200 + dx, 100 + dy));
    fixture.detectChanges();
  }

  const settle = () => new Promise((r) => setTimeout(r, 300));

  beforeEach(async () => {
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400);
    TestBed.configureTestingModule({ imports: [HostComponent] });
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => vi.restoreAllMocks());

  it('a long left drag goes to the next page', async () => {
    await drag(-120, 400);
    await settle();
    expect(host.changes).toEqual([6]);
  });

  it('rtl: dragging left goes to the previous page, right to the next', async () => {
    host.rtl.set(true);
    fixture.detectChanges();
    await drag(-120, 400);
    await settle();
    expect(host.changes).toEqual([4]);
    await drag(120, 400);
    await settle();
    expect(host.changes).toEqual([4, 6]);
  });

  it('a short slow drag stays and the track returns to 0', async () => {
    await drag(-40, 400);
    await settle();
    expect(host.changes).toEqual([]);
    expect(track().style.transform).toContain('-400px');
  });

  it('does not page past the first or last page', async () => {
    host.page.set(1);
    fixture.detectChanges();
    await drag(120, 400);
    await settle();
    host.page.set(10);
    fixture.detectChanges();
    await drag(-120, 400);
    await settle();
    expect(host.changes).toEqual([]);
  });

  it('does not page when zoomed in', async () => {
    host.zoom.set(2);
    fixture.detectChanges();
    await drag(-200, 200);
    await settle();
    expect(host.changes).toEqual([]);
  });

  it('arrow keys page, swapped for rtl', async () => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await settle();
    expect(host.changes).toEqual([6]);
    host.rtl.set(true);
    fixture.detectChanges();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await settle();
    expect(host.changes).toEqual([6, 4]);
  });

  it('space and shift+space page; ignored in inputs', async () => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    await settle();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', shiftKey: true, bubbles: true }));
    await settle();
    expect(host.changes).toEqual([6, 4]);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }));
    await settle();
    input.remove();
    expect(host.changes).toEqual([6, 4]);
  });

  it('a short quick press is a tap, once', async () => {
    await drag(2, 100);
    expect(host.taps).toBe(1);
    expect(host.changes).toEqual([]);
  });

  it('a drag is not a tap', async () => {
    await drag(-120, 100);
    expect(host.taps).toBe(0);
  });

  it('rtl puts the next slot on the left', async () => {
    const roles = () => Array.from(el.querySelectorAll('[data-slot]')).map((s) => s.getAttribute('data-slot'));
    expect(roles()).toEqual(['prev', 'cur', 'next']);
    host.rtl.set(true);
    fixture.detectChanges();
    expect(roles()).toEqual(['next', 'cur', 'prev']);
  });
});
