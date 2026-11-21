import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOCK } from '../core/clock';
import { DB, IqraDb } from '../core/db';
import { newId } from '../core/ids';
import {
  ChromeTranslatorProvider,
  DICTIONARY,
  MyMemoryProvider,
  TRANSLATION_PROVIDERS,
  TranslationError,
  TranslationService,
  parseDictionary,
  type TranslationProvider,
} from './translation';

function provider(id: string, behaviour: { available?: boolean; result?: string; error?: TranslationError }): TranslationProvider & { calls: number } {
  const p = {
    id,
    calls: 0,
    available: async () => behaviour.available ?? true,
    translate: async () => {
      p.calls++;
      if (behaviour.error) throw behaviour.error;
      return behaviour.result ?? '';
    },
  };
  return p;
}

describe('TranslationService', () => {
  let db: IqraDb;
  const setup = (providers: TranslationProvider[], dictionary = async () => null as never) => {
    db = new IqraDb(`iqra-test-${newId()}`);
    TestBed.configureTestingModule({
      providers: [
        { provide: DB, useValue: db },
        { provide: CLOCK, useValue: { now: () => 1 } },
        { provide: TRANSLATION_PROVIDERS, useValue: providers },
        { provide: DICTIONARY, useValue: dictionary },
      ],
    });
    return TestBed.inject(TranslationService);
  };
  afterEach(async () => {
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
    await db.delete();
  });

  it('uses the first provider that is available and caches the result', async () => {
    const skipped = provider('chrome', { available: false });
    const mm = provider('mm', { result: 'كتاب' });
    const svc = setup([skipped, mm]);
    expect(await svc.translate('Book', 'en')).toBe('كتاب');
    expect(await svc.translate('book', 'en')).toBe('كتاب');
    expect(mm.calls).toBe(1);
    expect(skipped.calls).toBe(0);
  });

  it('falls through to the next provider when one fails', async () => {
    const bad = provider('a', { error: new TranslationError('failed') });
    const good = provider('b', { result: 'ok' });
    expect(await setup([bad, good]).translate('x', 'en')).toBe('ok');
    expect(bad.calls).toBe(1);
  });

  it('translates the other way for Arabic text', async () => {
    const seen: string[] = [];
    const p: TranslationProvider = { id: 'p', available: async () => true, translate: async (_t, from, to) => (seen.push(`${from}>${to}`), 'book') };
    expect(await setup([p]).translate('كتاب', 'ar')).toBe('book');
    expect(seen).toEqual(['ar>en']);
  });

  it('reports offline when every provider fails and the browser is offline', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const svc = setup([provider('a', { error: new TranslationError('failed') })]);
    await expect(svc.translate('x', 'en')).rejects.toMatchObject({ kind: 'offline' });
  });

  it('reports failure when no provider can run', async () => {
    const svc = setup([provider('a', { available: false })]);
    await expect(svc.translate('x', 'en')).rejects.toMatchObject({ kind: 'failed' });
  });

  it('a cached translation still works offline', async () => {
    const svc = setup([provider('a', { result: 'y' })]);
    await svc.translate('x', 'en');
    vi.stubGlobal('navigator', { onLine: false });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: DB, useValue: db }, { provide: CLOCK, useValue: { now: () => 1 } }, { provide: TRANSLATION_PROVIDERS, useValue: [provider('dead', { error: new TranslationError('offline') })] }],
    });
    expect(await TestBed.inject(TranslationService).translate('x', 'en')).toBe('y');
  });

  it('define caches a found definition and never throws', async () => {
    const dict = vi.fn(async () => ({ phonetic: '/b/', partOfSpeech: 'noun', definition: 'd' }));
    const svc = setup([], dict as never);
    expect(await svc.define('book')).toMatchObject({ definition: 'd' });
    expect(await svc.define('Book')).toMatchObject({ definition: 'd' });
    expect(dict).toHaveBeenCalledTimes(1);
    TestBed.resetTestingModule();
    const failing = setup([], (async () => { throw new Error('x'); }) as never);
    expect(await failing.define('zzz')).toBeNull();
  });
});

describe('MyMemoryProvider', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('reads the translated text', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ responseStatus: 200, responseData: { translatedText: 'مرحبا' } })));
    vi.stubGlobal('fetch', fetchMock);
    expect(await new MyMemoryProvider().translate('hello world', 'en', 'ar')).toBe('مرحبا');
    expect(String(fetchMock.mock.calls[0]?.[0 as never])).toContain('langpair=en|ar');
  });
  it('maps a network failure to offline and a bad status to failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('net'); }));
    await expect(new MyMemoryProvider().translate('a', 'en', 'ar')).rejects.toMatchObject({ kind: 'offline' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 429 })));
    await expect(new MyMemoryProvider().translate('a', 'en', 'ar')).rejects.toMatchObject({ kind: 'failed' });
  });
  it('refuses text that is too long', async () => {
    await expect(new MyMemoryProvider().translate('a'.repeat(600), 'en', 'ar')).rejects.toMatchObject({ kind: 'too-long' });
  });
});

describe('ChromeTranslatorProvider', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('is unavailable without the Translator API', async () => {
    expect(await new ChromeTranslatorProvider().available('en', 'ar')).toBe(false);
  });
  it('translates through Translator.create when the model is available', async () => {
    const create = vi.fn(async () => ({ translate: async (t: string) => `ar:${t}` }));
    vi.stubGlobal('Translator', { availability: async () => 'available', create });
    const p = new ChromeTranslatorProvider();
    expect(await p.available('en', 'ar')).toBe(true);
    expect(await p.translate('hi', 'en', 'ar')).toBe('ar:hi');
    await p.translate('again', 'en', 'ar');
    expect(create).toHaveBeenCalledTimes(1);
  });
  it('is unavailable when the pair is not supported', async () => {
    vi.stubGlobal('Translator', { availability: async () => 'unavailable', create: vi.fn() });
    expect(await new ChromeTranslatorProvider().available('en', 'ar')).toBe(false);
  });
});

describe('parseDictionary', () => {
  it('takes the phonetic and the first definition', () => {
    const json = [{ phonetic: '/bʊk/', meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'A set of pages.' }] }] }];
    expect(parseDictionary(json)).toEqual({ phonetic: '/bʊk/', partOfSpeech: 'noun', definition: 'A set of pages.' });
  });
  it('falls back to a phonetics entry and returns null for nothing usable', () => {
    const json = [{ phonetics: [{}, { text: '/x/' }], meanings: [{ definitions: [{ definition: 'd' }] }] }];
    expect(parseDictionary(json)?.phonetic).toBe('/x/');
    expect(parseDictionary({ title: 'No Definitions Found' })).toBeNull();
    expect(parseDictionary([{ meanings: [] }])).toBeNull();
  });
});
