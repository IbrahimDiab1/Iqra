import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOCK } from '../core/clock';
import { DB, IqraDb } from '../core/db';
import { newId } from '../core/ids';
import { ToastService } from '../ui/toast.service';
import { TranslateSheet, placePopup, type TranslateTarget } from './translate.sheet';
import { DICTIONARY, TRANSLATION_PROVIDERS, TranslationError, type TranslationProvider } from './translation';

@Component({
  imports: [TranslateSheet],
  template: `<iqra-translate-sheet [target]="target()" bookId="b1" (closed)="target.set(null)" />`,
})
class Host {
  readonly target = signal<TranslateTarget | null>(null);
}

describe('TranslateSheet', () => {
  let db: IqraDb;
  let fixture: ComponentFixture<Host>;
  let provider: TranslationProvider & { fail?: TranslationError; calls: [string, string, string][] };
  const dictionary = vi.fn(async () => ({ phonetic: '/ˌser.ənˈdɪp.ɪ.ti/', partOfSpeech: 'noun', definition: 'A happy accident.' }));
  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';
  const q = (sel: string) => (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(sel);
  const settle = async () => {
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(() => {
    db = new IqraDb(`iqra-test-${newId()}`);
    provider = {
      id: 'fake',
      calls: [],
      available: async () => true,
      translate: async (t, from, to) => {
        provider.calls.push([t, from, to]);
        if (provider.fail) throw provider.fail;
        return from === 'en' ? 'صدفة' : 'book';
      },
    };
    dictionary.mockClear();
    TestBed.configureTestingModule({
      providers: [
        { provide: DB, useValue: db },
        { provide: CLOCK, useValue: { now: () => 5 } },
        { provide: TRANSLATION_PROVIDERS, useValue: [provider] },
        { provide: DICTIONARY, useValue: dictionary },
      ],
    });
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
  });
  afterEach(async () => {
    TestBed.resetTestingModule();
    await db.delete();
  });

  it('translates English to Arabic and shows a definition for a single word', async () => {
    fixture.componentInstance.target.set({ text: 'serendipity', page: 2, context: 'A happy serendipity.' });
    await vi.waitFor(async () => {
      await settle();
      expect(q('[data-testid="translation"]')?.textContent).toBe('صدفة');
    });
    expect(provider.calls[0]).toEqual(['serendipity', 'en', 'ar']);
    expect(dictionary).toHaveBeenCalledWith('serendipity');
    await vi.waitFor(async () => {
      await settle();
      expect(q('[data-testid="definition"]')?.textContent).toContain('A happy accident.');
    });
  });

  it('translates Arabic to English by script and skips the dictionary', async () => {
    fixture.componentInstance.target.set({ text: 'كتاب', page: 1, context: '' });
    await vi.waitFor(async () => {
      await settle();
      expect(q('[data-testid="translation"]')?.textContent).toBe('book');
    });
    expect(provider.calls[0]).toEqual(['كتاب', 'ar', 'en']);
    expect(dictionary).not.toHaveBeenCalled();
  });

  it('does not look a phrase up in the dictionary', async () => {
    fixture.componentInstance.target.set({ text: 'break the ice', page: 1, context: '' });
    await vi.waitFor(async () => {
      await settle();
      expect(q('[data-testid="translation"]')).not.toBeNull();
    });
    expect(dictionary).not.toHaveBeenCalled();
  });

  it('shows a clear offline message and Try again', async () => {
    provider.fail = new TranslationError('offline');
    fixture.componentInstance.target.set({ text: 'hello', page: 1, context: '' });
    await vi.waitFor(async () => {
      await settle();
      expect(q('[data-testid="translate-error"]')?.textContent).toContain('offline');
    });
    expect(q('[data-testid="save-review"]')?.hasAttribute('disabled')).toBe(true);
    provider.fail = undefined;
    Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).find((b) => b.textContent?.includes('Try again'))!.click();
    await vi.waitFor(async () => {
      await settle();
      expect(q('[data-testid="translation"]')).not.toBeNull();
    });
  });

  it('Save to Review stores the item with the book, page and context', async () => {
    fixture.componentInstance.target.set({ text: 'serendipity', page: 7, context: 'A happy serendipity.' });
    await vi.waitFor(async () => {
      await settle();
      expect(q('[data-testid="save-review"]')?.hasAttribute('disabled')).toBe(false);
    });
    q('[data-testid="save-review"]')!.click();
    await vi.waitFor(async () => {
      await settle();
      expect(fixture.componentInstance.target()).toBeNull();
    });
    expect(TestBed.inject(ToastService).current()?.message).toBe('Saved to Review');
    const [saved] = await db.review.toArray();
    expect(saved).toMatchObject({ text: 'serendipity', translation: 'صدفة', kind: 'word', sourceLang: 'en', bookId: 'b1', page: 7, context: 'A happy serendipity.' });
  });

  it('is a compact popup next to the selection, not a sheet', async () => {
    fixture.componentInstance.target.set({ text: 'hello', page: 1, context: '', anchor: { left: 100, top: 100, right: 160, bottom: 120 } });
    await settle();
    const pop = q('.pop')!;
    expect(pop.getAttribute('role')).toBe('dialog');
    expect(q('f-sheet')).toBeNull();
    expect(parseFloat(pop.style.width)).toBeLessThanOrEqual(320);
    expect(parseFloat(pop.style.top)).toBeGreaterThan(120);
  });

  it('closes on Escape and on a press outside, but not on a press inside', async () => {
    fixture.componentInstance.target.set({ text: 'hello', page: 1, context: '' });
    await settle();
    q('.pop')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await settle();
    expect(fixture.componentInstance.target()).not.toBeNull();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await settle();
    expect(fixture.componentInstance.target()).toBeNull();
    fixture.componentInstance.target.set({ text: 'hello', page: 1, context: '' });
    await settle();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await settle();
    expect(fixture.componentInstance.target()).toBeNull();
  });

  it('keeps the text in its own scroll area and the actions (Save, Close) outside it', async () => {
    fixture.componentInstance.target.set({ text: 'hello '.repeat(400), page: 1, context: '' });
    await settle();
    const scroll = q('[data-testid="translate-scroll"]')!;
    const actions = q('[data-testid="translate-actions"]')!;
    expect(scroll.contains(q('[data-testid="source"]'))).toBe(true);
    expect(scroll.contains(actions)).toBe(false);
    expect(actions.contains(q('[data-testid="save-review"]'))).toBe(true);
    q('[data-testid="close-translate"]')!.click();
    await settle();
    expect(fixture.componentInstance.target()).toBeNull();
  });

  it('placePopup keeps it inside the viewport and flips above near the bottom', () => {
    const a = placePopup({ anchor: { left: 0, top: 700, right: 40, bottom: 720 }, vw: 390, vh: 740 });
    expect(a.left).toBeGreaterThanOrEqual(8);
    expect(a.bottom).toBeDefined();
    expect(a.top).toBeUndefined();
    expect(placePopup({ vw: 300, vh: 600 }).width).toBe(284);
  });

  it('a late context sentence does not restart the lookup', async () => {
    fixture.componentInstance.target.set({ text: 'hello', page: 1, context: '' });
    await vi.waitFor(async () => {
      await settle();
      expect(q('[data-testid="translation"]')).not.toBeNull();
    });
    fixture.componentInstance.target.set({ text: 'hello', page: 1, context: 'Hello there.' });
    await settle();
    expect(provider.calls).toHaveLength(1);
  });
});
