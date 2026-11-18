import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { COPY } from '../ui/copy';
import { PageRenderer, PageSize } from './pdf-session';
import { ReflowViewComponent } from './reflow-view.component';
import type { TextItem } from './text';

const item = (str: string, y: number): TextItem => ({ str, transform: [1, 0, 0, 1, 10, y], width: 100, height: 10 });

class FakeRenderer implements PageRenderer {
  numPages = 5;
  pages = new Map<number, TextItem[] | Error>();
  async pageSize(): Promise<PageSize> {
    return { widthPt: 500, heightPt: 700 };
  }
  async renderPage(): Promise<void> {}
  async renderTextLayer(): Promise<void> {}
  async textItems(page: number): Promise<TextItem[]> {
    const v = this.pages.get(page) ?? [];
    if (v instanceof Error) throw v;
    return v;
  }
  async pageText() {
    return '';
  }
}

@Component({
  imports: [ReflowViewComponent],
  template: `<iqra-reflow-view
    [renderer]="renderer"
    [page]="page()"
    [zoom]="zoom()"
    [rtl]="false"
    theme="sepia"
    (pageChange)="changes.push($event)"
    (showPage)="shown = shown + 1"
    (tap)="taps = taps + 1"
  />`,
})
class HostComponent {
  renderer = new FakeRenderer();
  page = signal(3);
  zoom = signal(1);
  changes: number[] = [];
  shown = 0;
  taps = 0;
}

describe('ReflowViewComponent', () => {
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
    host.renderer.pages.set(3, [
      item('This is the first paragraph of the page and it', 700),
      item('continues on a second line of the same block.', 688),
      item('Second paragraph starts here after a clear gap', 640),
      item('and also continues onto another line below.', 628),
    ]);
  });

  it('renders each paragraph as a <p>', async () => {
    await settle();
    expect(el.querySelectorAll('article p').length).toBe(2);
  });

  it('gives an Arabic paragraph dir="rtl" and lang="ar"', async () => {
    host.renderer.pages.set(3, [item('هذا نص عربي طويل بما يكفي لقراءته في الصفحة', 700)]);
    await settle();
    const p = el.querySelector('article p') as HTMLElement;
    expect(p.getAttribute('dir')).toBe('rtl');
    expect(p.getAttribute('lang')).toBe('ar');
  });

  it('an empty page offers to show the page instead', async () => {
    host.renderer.pages.set(3, []);
    await settle();
    expect(el.textContent).toContain(COPY.reader.noText);
    const btn = Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes(COPY.reader.showPage));
    btn?.click();
    expect(host.shown).toBe(1);
    expect(el.querySelectorAll('article p').length).toBe(0);
  });

  it('next and previous buttons emit the neighbouring page and are absent at the ends', async () => {
    await settle();
    const button = (label: string) => Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes(label));
    button(COPY.reader.nextPage)?.click();
    button(COPY.reader.prevPage)?.click();
    expect(host.changes).toEqual([4, 2]);

    host.page.set(1);
    host.renderer.pages.set(1, [item('Only the first page has this paragraph in it.', 700)]);
    await settle();
    expect(button(COPY.reader.prevPage)).toBeUndefined();
    expect(button(COPY.reader.nextPage)).toBeDefined();

    host.page.set(5);
    host.renderer.pages.set(5, [item('Only the last page has this paragraph in it.', 700)]);
    await settle();
    expect(button(COPY.reader.nextPage)).toBeUndefined();
    expect(button(COPY.reader.prevPage)).toBeDefined();
  });

  it('font size is 17px times zoom', async () => {
    host.zoom.set(1.5);
    await settle();
    expect((el.querySelector('article') as HTMLElement).style.fontSize).toBe('25.5px');
  });

  it('shows the failure message when the text cannot be read', async () => {
    host.renderer.pages.set(3, new Error('boom'));
    await settle();
    expect(el.textContent).toContain(COPY.reader.pageFailed);
  });

  it('scrolls back to the top when the page changes', async () => {
    await settle();
    const scroller = el.querySelector('.scroll') as HTMLElement;
    scroller.scrollTop = 400;
    host.page.set(4);
    host.renderer.pages.set(4, [item('Another page with enough text to count as text.', 700)]);
    await settle();
    expect(scroller.scrollTop).toBe(0);
  });

  it('ArrowRight turns to the next page unless a field has focus', async () => {
    await settle();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(host.changes).toEqual([4]);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    input.remove();
    expect(host.changes).toEqual([4]);
  });
});
