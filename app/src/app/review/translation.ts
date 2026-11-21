import { Injectable, InjectionToken, inject } from '@angular/core';
import { CLOCK } from '../core/clock';
import { DB } from '../core/db';
import type { ReviewLang } from '../core/models';

/** Why a translation could not be made: no connection, a text the provider cannot take, or any other failure. */
export class TranslationError extends Error {
  constructor(readonly kind: 'offline' | 'too-long' | 'failed', message: string = kind) {
    super(message);
  }
}

/** One way to translate. A paid provider can be added by providing another one in TRANSLATION_PROVIDERS. */
export interface TranslationProvider {
  readonly id: string;
  /** False when this provider cannot run here (no browser API); the chain moves on. */
  available(from: ReviewLang, to: ReviewLang): Promise<boolean>;
  translate(text: string, from: ReviewLang, to: ReviewLang): Promise<string>;
}

export interface Definition {
  phonetic: string;
  partOfSpeech: string;
  definition: string;
}

export const TRANSLATION_PROVIDERS = new InjectionToken<TranslationProvider[]>('translation-providers', {
  providedIn: 'root',
  factory: () => [new ChromeTranslatorProvider(), new MyMemoryProvider()],
});

/** The dictionary lookup, replaceable in tests. Null when the word is unknown. */
export const DICTIONARY = new InjectionToken<(word: string) => Promise<Definition | null>>('dictionary', {
  providedIn: 'root',
  factory: () => lookupDictionary,
});

interface BrowserTranslator {
  translate(text: string): Promise<string>;
}
interface TranslatorApi {
  availability(o: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
  create(o: { sourceLanguage: string; targetLanguage: string }): Promise<BrowserTranslator>;
}

/** Chrome's on-device Translator API, when the browser has it and a model for the pair. */
export class ChromeTranslatorProvider implements TranslationProvider {
  readonly id = 'chrome';
  private readonly made = new Map<string, Promise<BrowserTranslator>>();

  private api(): TranslatorApi | undefined {
    return (globalThis as { Translator?: TranslatorApi }).Translator;
  }

  async available(from: ReviewLang, to: ReviewLang): Promise<boolean> {
    const api = this.api();
    if (!api) return false;
    try {
      const a = await api.availability({ sourceLanguage: from, targetLanguage: to });
      return a === 'available' || a === 'downloadable' || a === 'readily';
    } catch {
      return false;
    }
  }

  async translate(text: string, from: ReviewLang, to: ReviewLang): Promise<string> {
    const api = this.api();
    if (!api) throw new TranslationError('failed', 'no Translator API');
    const key = `${from}>${to}`;
    let t = this.made.get(key);
    if (!t) {
      t = api.create({ sourceLanguage: from, targetLanguage: to });
      this.made.set(key, t);
      t.catch(() => this.made.delete(key));
    }
    return (await (await t).translate(text)).trim();
  }
}

const MYMEMORY = 'https://api.mymemory.translated.net/get';
/** MyMemory takes at most 500 bytes of text per request. */
const MYMEMORY_MAX = 450;

/** MyMemory's free endpoint: no key, limited per day. */
export class MyMemoryProvider implements TranslationProvider {
  readonly id = 'mymemory';

  async available(): Promise<boolean> {
    return true;
  }

  async translate(text: string, from: ReviewLang, to: ReviewLang): Promise<string> {
    if (text.length > MYMEMORY_MAX) throw new TranslationError('too-long');
    let res: Response;
    try {
      res = await fetch(`${MYMEMORY}?q=${encodeURIComponent(text)}&langpair=${from}|${to}`);
    } catch {
      throw new TranslationError('offline');
    }
    if (!res.ok) throw new TranslationError('failed', `MyMemory ${res.status}`);
    const body = (await res.json()) as { responseStatus?: number | string; responseData?: { translatedText?: string } };
    const out = body.responseData?.translatedText?.trim();
    if (!out || Number(body.responseStatus) !== 200) throw new TranslationError('failed', 'MyMemory refused the text');
    return out;
  }
}

/** A short definition and phonetic from dictionaryapi.dev; null for an unknown word. */
export async function lookupDictionary(word: string): Promise<Definition | null> {
  const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new TranslationError('failed', `dictionary ${res.status}`);
  return parseDictionary(await res.json());
}

interface DictEntry {
  phonetic?: string;
  phonetics?: { text?: string }[];
  meanings?: { partOfSpeech?: string; definitions?: { definition?: string }[] }[];
}

export function parseDictionary(json: unknown): Definition | null {
  const entry = (Array.isArray(json) ? json[0] : null) as DictEntry | null;
  if (!entry) return null;
  const meaning = entry.meanings?.find((m) => m.definitions?.[0]?.definition);
  const definition = meaning?.definitions?.[0]?.definition;
  if (!meaning || !definition) return null;
  const phonetic = entry.phonetic || entry.phonetics?.find((p) => p.text)?.text || '';
  return { phonetic, partOfSpeech: meaning.partOfSpeech ?? '', definition };
}

/** The other language. */
export const otherLang = (l: ReviewLang): ReviewLang => (l === 'en' ? 'ar' : 'en');

/** Translations through the provider chain, remembered in IndexedDB so a repeat lookup works offline. */
@Injectable({ providedIn: 'root' })
export class TranslationService {
  private readonly db = inject(DB);
  private readonly clock = inject(CLOCK);
  private readonly providers = inject(TRANSLATION_PROVIDERS);
  private readonly dictionary = inject(DICTIONARY);

  private key(prefix: string, text: string): string {
    return `${prefix}:${text.trim().toLowerCase()}`;
  }

  private async cached(key: string): Promise<string | undefined> {
    try {
      return (await this.db.translationCache.get(key))?.translation;
    } catch {
      return undefined;
    }
  }

  private async remember(key: string, translation: string): Promise<void> {
    try {
      await this.db.translationCache.put({ key, translation, at: this.clock.now() });
    } catch {
      // The cache is a convenience.
    }
  }

  /** Translates `text` from `from` into the other language. Throws a TranslationError when no provider can. */
  async translate(text: string, from: ReviewLang): Promise<string> {
    const to = otherLang(from);
    const key = this.key(`${from}>${to}`, text);
    const hit = await this.cached(key);
    if (hit !== undefined) return hit;
    let last: TranslationError | undefined;
    for (const p of this.providers) {
      try {
        if (!(await p.available(from, to))) continue;
        const out = await p.translate(text, from, to);
        if (out === '') continue;
        await this.remember(key, out);
        return out;
      } catch (e) {
        last = e instanceof TranslationError ? e : new TranslationError('failed');
      }
    }
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    throw offline || last?.kind === 'offline' ? new TranslationError('offline') : (last ?? new TranslationError('failed'));
  }

  /** Definition and phonetic for an English word; null when unknown, offline, or failing (the translation still shows). */
  async define(word: string): Promise<Definition | null> {
    const key = this.key('def', word);
    const hit = await this.cached(key);
    if (hit !== undefined) return hit === '' ? null : (JSON.parse(hit) as Definition);
    try {
      const def = await this.dictionary(word.trim());
      await this.remember(key, def ? JSON.stringify(def) : '');
      return def;
    } catch {
      return null;
    }
  }
}

/** Reads text aloud with the Web Speech API; false when the browser cannot. */
export function canSpeak(): boolean {
  return typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';
}

export function speak(text: string, lang: ReviewLang): boolean {
  if (!canSpeak() || text.trim() === '') return false;
  const tag = lang === 'ar' ? 'ar' : 'en-US';
  const u = new SpeechSynthesisUtterance(text);
  u.lang = tag;
  const voice = speechSynthesis.getVoices().find((v) => v.lang === tag) ?? speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang));
  if (voice) u.voice = voice;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
  return true;
}
