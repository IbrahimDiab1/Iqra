import { describe, expect, it } from 'vitest';
import { normalizeWithMap, readingOrder, reverseWords, toReadingOrder } from './arabic-text';
import { findMatches, pageTextOf, snippet } from './text';

const norm = (s: string) => normalizeWithMap(s).text;
/** A text item at x on a baseline, 22 pt tall. */
const item = (str: string, x: number, y = 500, width = 40) => ({ str, transform: [22, 0, 0, 22, x, y], width, height: 22 });

describe('normalizeWithMap for Arabic', () => {
  it('turns presentation forms back into base letters (NFKC)', () => {
    expect(norm('ﺍﻟﻌﻠﻢ')).toBe('العلم');
    expect(norm('ﻻ')).toBe('لا');
    expect(norm('ﷲ')).toBe('الله');
  });

  it('strips tashkeel, tatweel and Quranic marks', () => {
    expect(norm('الْكِتَابُ')).toBe('الكتاب');
    expect(norm('كتــاب')).toBe('كتاب');
    expect(norm('بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ')).toBe('بسم الله الرحمن');
    expect(norm('قُرْآنٌۖ')).toBe('قران');
  });

  it('folds alef, ya, ta-marbuta and the Persian ya and kaf', () => {
    expect(norm('أإآٱ')).toBe('اااا');
    expect(norm('مدرسة على')).toBe('مدرسه علي');
    expect(norm('كیک')).toBe('كيك');
  });

  it('unifies Arabic-Indic, Persian and Western digits', () => {
    expect(norm('١٢٣')).toBe('123');
    expect(norm('۴۵۶')).toBe('456');
    expect(norm('page 7')).toBe('page 7');
  });

  it('ignores bidi control characters and joiners', () => {
    expect(norm('ا‏ل‎ك؜ت')).toBe('الكت');
  });

  it('keeps mapping each output character to where it came from in the original', () => {
    const { text, map } = normalizeWithMap('ﻻ ب');
    expect(text).toBe('لا ب');
    expect(map).toEqual([0, 0, 1, 2]);
  });

  it('still lowercases and strips Latin accents', () => {
    expect(norm('Café  Noël')).toBe('cafe noel');
  });
});

describe('findMatches for Arabic', () => {
  const find = (page: string, q: string) => findMatches(page, q).map((m) => page.slice(m.index, m.index + m.length));

  it('finds a base-letter query in presentation-form text and returns the original characters', () => {
    const page = 'ﺍﻟﻌﻠﻢ ﻧﻮﺭ';
    expect(find(page, 'العلم')).toEqual(['ﺍﻟﻌﻠﻢ']);
    expect(find(page, 'العلم نور')).toEqual([page]);
  });

  it('matches with and without diacritics on either side', () => {
    expect(find('الْكِتَابُ نُورٌ', 'الكتاب')).toEqual(['الْكِتَابُ']);
    expect(find('الكتاب نور', 'الْكِتَابُ')).toEqual(['الكتاب']);
  });

  it('matches digits in any script', () => {
    expect(find('صفحة ١٢٣', '123')).toEqual(['١٢٣']);
    expect(find('page 123', '١٢٣')).toEqual(['123']);
  });

  it('matches across a line break and across item boundaries with one space', () => {
    expect(find('نقرأ في الحياة\nالجميلة والهادئة', 'الحياة الجميلة')).toEqual(['الحياة\nالجميلة']);
    expect(find('الحياة   \n  الجميلة', 'الحياة الجميلة')).toHaveLength(1);
  });

  it('a hit that ends inside a ligature includes the whole ligature', () => {
    const page = 'كﻻ';
    expect(find(page, 'كل')).toEqual(['كﻻ']);
  });

  it('finds multi-word queries when the page text has the words in visual (reversed) order', () => {
    const page = 'والروح العقل غذاء القراءة';
    expect(find(page, 'القراءة غذاء')).toEqual(['غذاء القراءة']);
    expect(find(page, 'القراءة غذاء العقل')).toEqual(['العقل غذاء القراءة']);
  });

  it('prefers the normal order when it matches', () => {
    expect(find('كتاب جميل ثم جميل كتاب', 'كتاب جميل')).toEqual(['كتاب جميل']);
  });

  it('finds a word that the PDF split into pieces (no space between the letters in the layout)', () => {
    expect(find('ال كتاب جميل', 'الكتاب')).toEqual(['ال كتاب']);
  });

  it('does not split Latin words', () => {
    expect(findMatches('in the', 'inthe')).toEqual([]);
  });

  it('a query shorter than two letters finds nothing', () => {
    expect(findMatches('الكتاب', 'ا')).toEqual([]);
  });

  it('snippets show the original text, not the normalised form', () => {
    const page = 'قال ﺍﻟﻌﻠﻢ نور';
    const [m] = findMatches(page, 'العلم');
    expect(snippet(page, m)).toEqual({ before: 'قال', match: 'ﺍﻟﻌﻠﻢ', after: 'نور' });
  });
});

describe('reverseWords', () => {
  it('reverses the words of one line', () => {
    expect(reverseWords('a b c')).toBe('c b a');
    expect(reverseWords('  القراءة   غذاء ')).toBe('غذاء القراءة');
    expect(reverseWords('word')).toBe('word');
  });
});

describe('readingOrder', () => {
  it('leaves left-to-right lines alone', () => {
    const items = [item('one', 10), item('two', 60), item('three', 110)];
    expect(readingOrder(items)).toEqual([0, 1, 2]);
  });

  it('puts the items of a right-to-left line in right-to-left order when they were written left to right', () => {
    const items = [item('والروح', 68), item(' ', 126, 500, 30), item('العقل', 156), item(' ', 219, 500, 30), item('غذاء', 249), item(' ', 286, 500, 30), item('القراءة', 316)];
    expect(readingOrder(items)).toEqual([6, 5, 4, 3, 2, 1, 0]);
    expect(readingOrder(items).map((i) => items[i].str).filter((s) => s.trim())).toEqual(['القراءة', 'غذاء', 'العقل', 'والروح']);
  });

  it('keeps an already right-to-left line and the order of the lines', () => {
    const items = [item('القراءة', 316), item('غذاء', 249), item('العقل', 156), item('حصد', 35, 460), item('زرع', 115, 460)];
    expect(readingOrder(items)).toEqual([0, 1, 2, 4, 3]);
  });

  it('reorders each line on its own', () => {
    const items = [item('ب', 10, 500), item('أ', 60, 500), item('د', 10, 460), item('ج', 60, 460)];
    expect(readingOrder(items)).toEqual([1, 0, 3, 2]);
  });

  it('leaves a mostly Latin line alone even with an Arabic word in it', () => {
    const items = [item('see', 10), item('the', 60), item('كتاب', 110), item('page', 160)];
    expect(readingOrder(items)).toEqual([0, 1, 2, 3]);
  });

  it('is a permutation of the input indexes, and empty for no items', () => {
    expect(readingOrder([])).toEqual([]);
    const items = [item('ب', 10), item('أ', 60), item('', 100), item('ج', 120, 400)];
    expect([...readingOrder(items)].sort()).toEqual([0, 1, 2, 3]);
  });

  it('makes pageTextOf read in reading order, so multi-word searches work', () => {
    const items = [item('والروح', 68), item('العقل', 156), item('غذاء', 249), item('القراءة', 316)];
    const ordered = readingOrder(items).map((i) => items[i]);
    expect(pageTextOf(ordered)).toBe('القراءة غذاء العقل والروح');
  });
});

describe('toReadingOrder', () => {
  it('returns the items reordered with the line end moved to the new last item', () => {
    const a = { ...item('والروح', 68), hasEOL: false };
    const b = { ...item('القراءة', 316), hasEOL: true };
    const { items, order } = toReadingOrder([a, b]);
    expect(order).toEqual([1, 0]);
    expect(items.map((i) => i.str)).toEqual(['القراءة', 'والروح']);
    expect(items.map((i) => !!i.hasEOL)).toEqual([false, true]);
    expect(pageTextOf(items)).toBe('القراءة والروح');
  });

  it('hands back the very same objects when nothing needs to move', () => {
    const list = [item('one', 10), item('two', 60)];
    const { items, order } = toReadingOrder(list);
    expect(order).toEqual([0, 1]);
    expect(items[0]).toBe(list[0]);
    expect(items[1]).toBe(list[1]);
  });

  it('keeps empty items where they are', () => {
    const { items } = toReadingOrder([item('ب', 10), item('', 20), item('أ', 60)]);
    expect(items.map((i) => i.str)).toEqual(['أ', '', 'ب']);
  });
});

describe('mixed Arabic and Latin on one line', () => {
  const texts = (items: ReturnType<typeof item>[]) => readingOrder(items).map((i) => items[i].str).filter((s) => s.trim());

  it('keeps a Latin phrase written as separate items in its own left-to-right order inside an Arabic line', () => {
    // Visual, left to right: ثالث | Hello World | ثاني | أول  (read right to left: أول ثاني Hello World ثالث)
    const items = [item('ثالث', 10), item('Hello', 60), item('World', 110), item('ثاني', 160), item('أول', 210)];
    expect(texts(items)).toEqual(['أول', 'ثاني', 'Hello', 'World', 'ثالث']);
  });

  it('a space item between the Latin words stays between them', () => {
    const items = [item('ثالث', 10), item('Hello', 60), item(' ', 100, 500, 10), item('World', 110), item('ثاني', 160), item('أول', 210)];
    const order = readingOrder(items).map((i) => items[i].str);
    expect(order).toEqual(['أول', 'ثاني', 'Hello', ' ', 'World', 'ثالث']);
  });

  it('numbers inside an Arabic line keep the right-to-left position between the Arabic items', () => {
    const items = [item('ثالث', 10), item('2024', 60), item('ثاني', 110), item('أول', 160)];
    expect(texts(items)).toEqual(['أول', 'ثاني', '2024', 'ثالث']);
  });

  it('a bilingual line with an English column left of an Arabic column reads the Arabic column right to left and the English left to right', () => {
    const items = [item('Hello', 10), item('world', 60), item('ظلام', 150), item('والجهل', 200), item('نور', 250), item('العلم', 300)];
    expect(texts(items)).toEqual(['العلم', 'نور', 'والجهل', 'ظلام', 'Hello', 'world']);
  });

  it('page text and search then work for both the Latin phrase and the Arabic one', () => {
    const items = [item('ثالث', 10), item('Hello', 60), item('World', 110), item('ثاني', 160), item('أول', 210)];
    const text = pageTextOf(toReadingOrder(items).items);
    expect(text).toBe('أول ثاني Hello World ثالث');
    expect(findMatches(text, 'Hello World')).toHaveLength(1);
    expect(findMatches(text, 'ثاني Hello')).toHaveLength(1);
  });

  it('a mostly Latin line is still left alone', () => {
    const items = [item('see', 10), item('the', 60), item('كتاب', 110), item('page', 160)];
    expect(readingOrder(items)).toEqual([0, 1, 2, 3]);
  });
});

describe('the reader\'s own text direction overrides detection', () => {
  const arabicLtr = () => [item('والروح', 68), item('العقل', 156), item('غذاء', 249), item('القراءة', 316)];
  const latin = () => [item('one', 10), item('two', 60), item('three', 110)];
  const digits = () => [item('1', 10), item('2', 60), item('3', 110)];

  it('Auto (no choice) keeps today\'s detection', () => {
    expect(readingOrder(arabicLtr())).toEqual([3, 2, 1, 0]);
    expect(readingOrder(latin())).toEqual([0, 1, 2]);
  });

  it('Left to right keeps the PDF order even for an Arabic line', () => {
    expect(readingOrder(arabicLtr(), 'ltr')).toEqual([0, 1, 2, 3]);
    expect(toReadingOrder(arabicLtr(), 'ltr').items.map((i) => i.str)).toEqual(['والروح', 'العقل', 'غذاء', 'القراءة']);
  });

  it('Right to left reads a line with no letters (numbers) from the right, and keeps a Latin phrase in its own order', () => {
    expect(readingOrder(digits(), 'rtl')).toEqual([2, 1, 0]);
    expect(readingOrder(digits())).toEqual([0, 1, 2]);
    expect(readingOrder(latin(), 'rtl')).toEqual([0, 1, 2]);
  });

  it('search: left to right never tries the reversed words, right to left tries them for any script', () => {
    const text = 'بسم الله الرحمن';
    expect(findMatches(text, 'الرحمن الله').length).toBe(1);
    expect(findMatches(text, 'الرحمن الله', 10, 'ltr')).toEqual([]);
    expect(findMatches('world hello', 'hello world')).toEqual([]);
    expect(findMatches('world hello', 'hello world', 10, 'rtl')).toHaveLength(1);
  });
});
