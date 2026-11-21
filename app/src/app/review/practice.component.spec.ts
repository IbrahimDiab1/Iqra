import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOCK } from '../core/clock';
import { DB, IqraDb } from '../core/db';
import { newId } from '../core/ids';
import type { ReviewItem } from '../core/models';
import { PracticeComponent } from './practice.component';
import { ReviewService } from './review.service';

@Component({
  imports: [PracticeComponent],
  template: `<iqra-practice [cards]="cards()" (exit)="exited = exited + 1" />`,
})
class Host {
  cards = signal<ReviewItem[]>([]);
  exited = 0;
}

describe('PracticeComponent', () => {
  let db: IqraDb;
  let fixture: ComponentFixture<Host>;
  let reviews: ReviewService;
  const el = () => fixture.nativeElement as HTMLElement;
  const q = (s: string) => el().querySelector<HTMLElement>(s);
  const key = (k: string) => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    fixture.detectChanges();
  };

  async function start(items: Partial<ReviewItem>[]) {
    const saved: ReviewItem[] = [];
    for (const [i, o] of items.entries()) {
      saved.push((await reviews.add({ text: `w${i}`, translation: `t${i}`, sourceLang: 'en', bookId: 'b', page: 1, context: '', ...o })).item);
    }
    fixture.componentInstance.cards.set(saved);
    fixture.detectChanges();
    return saved;
  }

  beforeEach(() => {
    db = new IqraDb(`iqra-test-${newId()}`);
    TestBed.configureTestingModule({ providers: [{ provide: DB, useValue: db }, { provide: CLOCK, useValue: { now: () => 1000 } }] });
    reviews = TestBed.inject(ReviewService);
    fixture = TestBed.createComponent(Host);
  });
  afterEach(async () => {
    TestBed.resetTestingModule();
    await db.delete();
  });

  it('shows the saved text first and the translation only after the flip, for any source language', async () => {
    await start([{ text: 'book', translation: 'كتاب' }]);
    expect(q('[data-testid="front"]')?.textContent).toBe('book');
    expect(q('[data-testid="back"]')).toBeNull();
    expect(q('[data-testid="flip"]')).not.toBeNull();
    key(' ');
    expect(q('[data-testid="back"]')?.textContent).toBe('كتاب');
  });

  it('an Arabic source keeps Arabic in front', async () => {
    await start([{ text: 'كتاب', translation: 'book', sourceLang: 'ar' }]);
    expect(q('[data-testid="front"]')?.textContent).toBe('كتاب');
  });

  it('highlights and notes show whole, with no flip, and are graded directly', async () => {
    const note = await reviews.addAnnotation({
      id: 'n1', bookId: 'b', type: 'note', page: 4, body: 'My thought', tags: [], createdAt: 1, updatedAt: 1, deviceId: 'd',
      text: { page: 4, start: { item: 0, offset: 0 }, end: { item: 0, offset: 5 }, rects: [], quote: 'The quote' },
    });
    fixture.componentInstance.cards.set([note!.item]);
    fixture.detectChanges();
    expect(q('[data-testid="whole-text"]')?.textContent).toBe('The quote');
    expect(q('[data-testid="whole-note"]')?.textContent).toBe('My thought');
    expect(q('[data-testid="whole-source"]')?.textContent).toContain('p. 4');
    expect(q('[data-testid="flip"]')).toBeNull();
    expect(el().textContent).not.toContain('Show answer');
    expect(el().querySelectorAll('.grade')).toHaveLength(4);
    key('3');
    await vi.waitFor(async () => expect((await db.review.get(note!.item.id))!.srs.reps).toBe(1));
    expect(q('[data-testid="finished"]')).not.toBeNull();
  });

  it('keys 1-4 grade only after the flip; Good schedules the card and advances', async () => {
    const [a, b] = await start([{}, {}]);
    key('3');
    expect(q('[data-testid="progress"]')?.textContent).toBe('0 of 2');
    key(' ');
    key('3');
    await vi.waitFor(async () => expect((await db.review.get(a.id))!.srs.reps).toBe(1));
    expect(q('[data-testid="progress"]')?.textContent).toBe('1 of 2');
    expect(q('[data-testid="front"]')?.textContent).toBe('w1');
    key(' ');
    key('4');
    await vi.waitFor(async () => expect((await db.review.get(b.id))!.srs.intervalDays).toBe(4));
    expect(q('[data-testid="finished"]')).not.toBeNull();
  });

  it('Again returns the card to the end of the session and counts a lapse', async () => {
    const [a] = await start([{}, {}]);
    key(' ');
    key('1');
    await vi.waitFor(async () => expect((await db.review.get(a.id))!.srs.lapses).toBe(1));
    expect(q('[data-testid="front"]')?.textContent).toBe('w1');
    key(' ');
    key('3');
    expect(q('[data-testid="front"]')?.textContent).toBe('w0');
    expect(q('[data-testid="progress"]')?.textContent).toBe('1 of 2');
    key(' ');
    key('3');
    expect(q('[data-testid="finished"]')).not.toBeNull();
  });

  it('the grade buttons work with the pointer and the exit button emits exit', async () => {
    await start([{}]);
    q('[data-testid="flip"]')!.click();
    fixture.detectChanges();
    expect(el().querySelectorAll('.grade')).toHaveLength(4);
    el().querySelector<HTMLButtonElement>('.grade[data-grade="hard"]')!.click();
    fixture.detectChanges();
    q('[data-testid="exit-practice"]')!.click();
    expect(fixture.componentInstance.exited).toBe(1);
  });
});
