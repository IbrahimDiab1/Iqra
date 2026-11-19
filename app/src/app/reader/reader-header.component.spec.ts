import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { COPY } from '../ui/copy';
import { CHROME_COPY } from './chrome-copy';
import { ReaderHeaderComponent } from './reader-header.component';

@Component({
  imports: [ReaderHeaderComponent],
  template: `<iqra-reader-header
    [title]="title()"
    [chapter]="chapter()"
    [section]="section()"
    [page]="12"
    [numPages]="300"
    [canBack]="canBack()"
    [canForward]="false"
    [(gotoOpen)]="goto"
    (historyBack)="backs = backs + 1"
    (goTo)="jumps.push($event)"
  />`,
})
class HostComponent {
  title = signal('Book');
  chapter = signal<string | null>('Chapter');
  section = signal<string | null>(null);
  canBack = signal(false);
  goto = signal(false);
  backs = 0;
  jumps: number[] = [];
}

describe('ReaderHeaderComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let el: HTMLElement;

  function create() {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    el = fixture.nativeElement as HTMLElement;
    document.body.append(el);
    fixture.detectChanges();
  }
  const update = (fn: () => void) => {
    fn();
    fixture.detectChanges();
  };

  it('shows the title, then chapter and section with a separator, all dir=auto', () => {
    create();
    expect(el.querySelector('.t1')!.textContent).toBe('Book');
    expect(el.querySelector('.sep')).toBeNull();
    update(() => {
      host.title.set('كتاب الفقه');
      host.section.set('فصل');
    });
    expect(el.querySelector('.t1')!.getAttribute('dir')).toBe('auto');
    expect(el.querySelector('.t2')!.getAttribute('dir')).toBe('auto');
    expect(el.querySelector('.t2')!.textContent!.replace(/\s+/g, ' ').trim()).toBe(`Chapter ${CHROME_COPY.chapterSep} فصل`);
    update(() => host.chapter.set(null));
    expect(el.querySelector('.t2')).toBeNull();
  });

  it('has a back arrow to the library and shows the page indicator at the end', () => {
    create();
    expect(el.querySelector('a')!.getAttribute('aria-label')).toBe(COPY.reader.back);
    expect(el.querySelector('a')!.getAttribute('href')).toBe('/library');
    const children = Array.from(el.querySelector('iqra-reader-header')!.children);
    expect(children[children.length - 1].textContent!.trim()).toBe('p. 12 / 300');
  });

  it('shows Back and Forward only once there is history', () => {
    create();
    expect(el.querySelector(`button[aria-label="${COPY.reader.jumpBack}"]`)).toBeNull();
    update(() => host.canBack.set(true));
    const back = el.querySelector<HTMLButtonElement>(`button[aria-label="${COPY.reader.jumpBack}"]`)!;
    expect(back.disabled).toBe(false);
    expect(el.querySelector<HTMLButtonElement>(`button[aria-label="${COPY.reader.jumpForward}"]`)!.disabled).toBe(true);
    back.click();
    expect(host.backs).toBe(1);
  });

  it('the indicator opens Go to page with the current page selected; Enter jumps, clamped; Escape closes', () => {
    create();
    el.querySelector<HTMLButtonElement>('.pg')!.click();
    fixture.detectChanges();
    expect(host.goto()).toBe(true);
    const field = el.querySelector<HTMLInputElement>('input')!;
    expect(field.value).toBe('12');
    expect(document.activeElement).toBe(field);
    field.value = '999';
    field.form!.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
    expect(host.jumps).toEqual([300]);
    expect(el.querySelector('input')).toBeNull();

    update(() => host.goto.set(true));
    const again = el.querySelector<HTMLInputElement>('input')!;
    again.value = 'abc';
    again.form!.dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
    expect(host.jumps).toEqual([300]);

    update(() => host.goto.set(true));
    el.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(host.goto()).toBe(false);
    el.remove();
  });
});
