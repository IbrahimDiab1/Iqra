import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOCK } from '../core/clock';
import { DB, IqraDb } from '../core/db';
import { newId } from '../core/ids';
import type { ReviewItem } from '../core/models';
import type { CardDirection } from './review-logic';
import { PracticeComponent } from './practice.component';
import { ReviewService } from './review.service';

@Component({
  imports: [PracticeComponent],
  template: `<iqra-practice [cards]="cards()" [direction]="dir()" (exit)="exited = exited + 1" />`,
})
class Host {
  cards = signal<ReviewItem[]>([]);
  dir = signal<CardDirection>('en-ar');
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

  async function start(dir: CardDirection, items: Partial<ReviewItem>[]) {
    const saved: ReviewItem[] = [];
    for (const [i, o] of items.entries()) {
      saved.push((await reviews.add({ text: `w${i}`, translation: `t${i}`, sourceLang: 'en', bookId: 'b', page: 1, context: '', ...o })).item);
    }
    fixture.componentInstance.dir.set(dir);
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

  it('shows the English side first for en-ar and the Arabic side first for ar-en', async () => {
    await start('en-ar', [{ text: 'book', translation: 'كتاب' }]);
    expect(q('[data-testid="front"]')?.textContent).toBe('book');
  });

  it('Arabic first for ar-en, answer hidden until flipped', async () => {
    await start('ar-en', [{ text: 'book', translation: 'كتاب' }]);
    expect(q('[data-testid="front"]')?.textContent).toBe('كتاب');
    expect(q('[data-testid="back"]')).toBeNull();
    key(' ');
    expect(q('[data-testid="back"]')?.textContent).toBe('book');
  });

  it('a card from an Arabic source swaps sides to keep English in front', async () => {
    await start('en-ar', [{ text: 'كتاب', translation: 'book', sourceLang: 'ar' }]);
    expect(q('[data-testid="front"]')?.textContent).toBe('book');
  });

  it('keys 1-4 grade only after the flip; Good schedules the card and advances', async () => {
    const [a, b] = await start('en-ar', [{}, {}]);
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
    const [a] = await start('en-ar', [{}, {}]);
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
    await start('en-ar', [{}]);
    q('[data-testid="flip"]')!.click();
    fixture.detectChanges();
    expect(el().querySelectorAll('.grade')).toHaveLength(4);
    el().querySelector<HTMLButtonElement>('.grade[data-grade="hard"]')!.click();
    fixture.detectChanges();
    q('[data-testid="exit-practice"]')!.click();
    expect(fixture.componentInstance.exited).toBe(1);
  });

  it('mixed picks a direction per card', async () => {
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.9).mockReturnValueOnce(0.1);
    await start('mixed', [{ text: 'a', translation: 'أ' }, { text: 'b', translation: 'ب' }]);
    expect(q('[data-testid="front"]')?.textContent).toBe('أ');
    key(' ');
    key('3');
    expect(q('[data-testid="front"]')?.textContent).toBe('b');
  });
});
