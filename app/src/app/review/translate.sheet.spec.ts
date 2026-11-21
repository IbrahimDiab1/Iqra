import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOCK } from '../core/clock';
import { DB, IqraDb } from '../core/db';
import { newId } from '../core/ids';
import { TranslateSheet, type TranslateTarget } from './translate.sheet';
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
      expect(text()).toContain('Saved to Review');
    });
    const [saved] = await db.review.toArray();
    expect(saved).toMatchObject({ text: 'serendipity', translation: 'صدفة', kind: 'word', sourceLang: 'en', bookId: 'b1', page: 7, context: 'A happy serendipity.' });
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
