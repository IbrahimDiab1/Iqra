import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { Annotation } from '../core/models';
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
    [annotations]="annotations()"
    [flashId]="flashId()"
    (annotationTap)="tapped.push($event)"
  />`,
})
class HostComponent {
  renderer = new FakeRenderer();
  page = signal(3);
  zoom = signal(1);
  changes: number[] = [];
  shown = 0;
  taps = 0;
  annotations = signal<Annotation[]>([]);
  flashId = signal<string | null>(null);
  tapped: Annotation[] = [];
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

  describe('highlights', () => {
    /** The paragraph's text before an element (skipping Angular's comment anchors). */
    const before = (m: Element): string => {
      let out = '';
      for (let n = m.previousSibling; n; n = n.previousSibling) out = (n.nodeType === Node.COMMENT_NODE ? '' : (n.textContent ?? '')) + out;
      return out;
    };

    const ann = (over: Partial<Annotation>): Annotation => ({
      id: 'h1', bookId: 'b', deviceId: 'd', updatedAt: 1, createdAt: 1, type: 'highlight', page: 3, color: 'green', tags: [],
      text: { page: 3, start: { item: 0, offset: 0 }, end: { item: 0, offset: 5 }, rects: [], quote: 'second line of the same' },
      ...over,
    });

    it('a highlighted phrase renders a colored <mark>', async () => {
      host.annotations.set([ann({})]);
      await settle();
      const m = el.querySelector<HTMLElement>('article p mark')!;
      expect(m.textContent).toBe('second line of the same');
      expect(m.classList.contains('hl-green')).toBe(true);
      expect(m.dataset['id']).toBe('h1');
    });

    it('clicking a mark emits annotationTap and does not toggle the bars', async () => {
      const a = ann({});
      host.annotations.set([a]);
      await settle();
      el.querySelector<HTMLElement>('mark')!.click();
      expect(host.tapped).toEqual([a]);
      expect(host.taps).toBe(0);
    });

    it('a note is underlined and a mark with a body shows a dot', async () => {
      host.annotations.set([ann({ type: 'note', color: undefined, body: 'thought' })]);
      await settle();
      const m = el.querySelector<HTMLElement>('mark')!;
      expect(m.classList.contains('underline')).toBe(true);
      expect(m.querySelector('.dot')).not.toBeNull();
    });

    it('ignores annotations of other pages and non-text kinds', async () => {
      host.annotations.set([ann({ text: { page: 4, start: { item: 0, offset: 0 }, end: { item: 0, offset: 1 }, rects: [], quote: 'second line' } }), ann({ id: 'x', type: 'area', text: undefined })]);
      await settle();
      expect(el.querySelector('mark')).toBeNull();
    });

    it('draws a highlight of repeated text on the annotated occurrence, not the first', async () => {
      host.renderer.pages.set(3, [item('the cat sat and the cat ran today', 700)]);
      host.annotations.set([ann({ text: { page: 3, start: { item: 0, offset: 16 }, end: { item: 0, offset: 19 }, rects: [], quote: 'cat' } })]);
      await settle();
      const marks = el.querySelectorAll('article p mark');
      expect(marks).toHaveLength(1);
      expect(before(marks[0])).toBe('the cat sat and the ');
    });

    it('two annotations with one quote each get their own occurrence', async () => {
      host.renderer.pages.set(3, [item('dog and dog and more text here', 700)]);
      const at = (id: string, offset: number) =>
        ann({ id, text: { page: 3, start: { item: 0, offset }, end: { item: 0, offset: offset + 3 }, rects: [], quote: 'dog' } });
      host.annotations.set([at('second', 8), at('first', 0)]);
      await settle();
      const ids = Array.from(el.querySelectorAll<HTMLElement>('article p mark')).map((m) => m.dataset['id']);
      expect(ids).toEqual(['first', 'second']);
    });

    it('does not draw an Arabic word inside a longer al- word; the repeated word lands on its occurrence', async () => {
      host.renderer.pages.set(3, [item('العلم نور وطلب علم ثم نشر علم نافع', 700)]);
      const start = 'العلم نور وطلب علم ثم نشر '.length;
      host.annotations.set([ann({ text: { page: 3, start: { item: 0, offset: start }, end: { item: 0, offset: start + 3 }, rects: [], quote: 'علم' } })]);
      await settle();
      const marks = el.querySelectorAll('article p mark');
      expect(marks).toHaveLength(1);
      expect(before(marks[0])).toBe('العلم نور وطلب علم ثم نشر ');
    });

    it('the article carries its page for the selection service', async () => {
      await settle();
      expect(el.querySelector<HTMLElement>('article.reflow-article')!.dataset['page']).toBe('3');
    });
  });
});
