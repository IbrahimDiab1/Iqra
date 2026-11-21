import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOCK } from '../core/clock';
import { DB, IqraDb } from '../core/db';
import { newId } from '../core/ids';
import type { Book } from '../core/models';
import { CHROME_COPY } from './chrome-copy';
import { COPY } from '../ui/copy';
import type { PositionService } from './position.service';
import { ReaderState } from './reader.state';
import { ReadingSettingsSheetComponent } from './reading-settings.sheet';

const BOOK = { id: 'b1', pageCount: 10, pageMode: 'swipe', progressMode: 'last-page', title: 'T', deviceId: 'd', updatedAt: 1 } as Book;

@Component({
  imports: [ReadingSettingsSheetComponent],
  template: `<iqra-reading-settings-sheet [open]="true" [book]="book" [state]="state" (closed)="closes = closes + 1" (bookChange)="changed.push($event)" (progressModeChange)="modes.push($event)" />`,
})
class HostComponent {
  book = BOOK;
  state = new ReaderState(BOOK, { schedule: () => undefined, flush: async () => undefined } as unknown as PositionService);
  closes = 0;
  changed: Book[] = [];
  modes: Book['progressMode'][] = [];
}

describe('ReadingSettingsSheetComponent', () => {
  let db: IqraDb;
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let el: HTMLElement;

  beforeEach(async () => {
    localStorage.clear();
    db = new IqraDb(`iqra-test-${newId()}`);
    await db.books.put(BOOK);
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        { provide: DB, useValue: db },
        { provide: CLOCK, useValue: { now: () => 9000 } },
      ],
    });
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    host.state.init({ place: { page: 1, offset: 0 }, zoom: 1, view: 'page', fromOtherDevice: false });
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  afterEach(async () => {
    await db.delete();
  });

  const radio = (name: string) =>
    Array.from(el.querySelectorAll<HTMLButtonElement>('[role=radio]')).find((b) => b.textContent!.trim() === name)!;
  const step = (name: string) => el.querySelector<HTMLButtonElement>(`button[data-step="${name}"]`)!;

  it('uses the reading-settings copy and shows the current choices', () => {
    expect(el.querySelector('h3')!.textContent).toBe(COPY.reader.settings);
    expect(radio(COPY.reader.pageView).getAttribute('aria-checked')).toBe('true');
    expect(radio(COPY.reader.swipe).getAttribute('aria-checked')).toBe('true');
    expect(radio(COPY.reader.paper).getAttribute('aria-checked')).toBe('true');
  });

  it('the View control switches the reader state', () => {
    radio(COPY.reader.readingMode).click();
    fixture.detectChanges();
    expect(host.state.view()).toBe('reflow');
    expect(radio(COPY.reader.readingMode).getAttribute('aria-checked')).toBe('true');
  });

  it('Turn pages by writes Book.pageMode and reports the saved book', async () => {
    radio(COPY.reader.scroll).click();
    await vi.waitFor(async () => expect((await db.books.get('b1'))!.pageMode).toBe('scroll'));
    expect(host.changed[0].pageMode).toBe('scroll');
  });

  it('Text direction starts on Auto and a choice is saved on the book', async () => {
    expect(radio(CHROME_COPY.dirAuto).getAttribute('aria-checked')).toBe('true');
    radio(CHROME_COPY.dirRtl).click();
    await vi.waitFor(async () => expect((await db.books.get('b1'))!.textDirection).toBe('rtl'));
    expect(host.changed.at(-1)!.textDirection).toBe('rtl');
    expect(host.changed.at(-1)!.pageMode).toBe('swipe');
  });

  it('Progress mode is a per-book choice here: it shows the book\u2019s mode and reports a change', () => {
    expect(el.textContent).toContain(COPY.details.progressMode);
    expect(radio(COPY.details.lastPage).getAttribute('aria-checked')).toBe('true');
    expect(radio(COPY.details.marked).getAttribute('aria-checked')).toBe('false');
    radio(COPY.details.lastPage).click();
    expect(host.modes).toEqual([]);
    radio(COPY.details.marked).click();
    expect(host.modes).toEqual(['marked']);
  });

  it('Page color writes the reader theme setting', async () => {
    radio(COPY.reader.night).click();
    await vi.waitFor(async () => expect((await db.settings.get('settings'))!.readerTheme).toBe('night'));
    fixture.detectChanges();
    expect(radio(COPY.reader.night).getAttribute('aria-checked')).toBe('true');
  });

  it('the stepper changes zoom and its label follows the view', () => {
    expect(el.textContent).toContain(COPY.reader.zoom);
    expect(el.querySelector('.pct')!.textContent!.trim()).toBe('100%');
    step('in').click();
    fixture.detectChanges();
    expect(host.state.zoom()).toBe(1.25);
    expect(el.querySelector('.pct')!.textContent!.trim()).toBe('125%');
    radio(COPY.reader.readingMode).click();
    fixture.detectChanges();
    expect(el.textContent).toContain(COPY.reader.textSize);
    step('in').click();
    fixture.detectChanges();
    expect(host.state.zoom()).toBe(1.1);
  });

  it('A+ is disabled at the maximum zoom', () => {
    host.state.setZoom(4);
    fixture.detectChanges();
    expect(step('in').disabled).toBe(true);
    expect(step('out').disabled).toBe(false);
  });
});
