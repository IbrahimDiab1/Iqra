import {
  buildReflow,
  findMatches,
  hasSelectableText,
  normalizeWithMap,
  pageTextOf,
  snippet,
  type TextItem,
} from './text';

function item(str: string, x: number, y: number, extra: Partial<TextItem> = {}): TextItem {
  return { str, transform: [1, 0, 0, 10, x, y], width: str.length * 5, height: 10, ...extra };
}

describe('normalizeWithMap', () => {
  it('lowercases, strips Latin combining marks and maps each char to its original index', () => {
    const r = normalizeWithMap('Café');
    expect(r.text).toBe('cafe');
    expect(r.map).toHaveLength(4);
    expect(r.map[3]).toBe(3);
  });

  it('strips Arabic harakat and tatweel', () => {
    expect(normalizeWithMap('مُحَمَّد').text).toBe('محمد');
    expect(normalizeWithMap('مـحمد').text).toBe('محمد');
  });

  it('unifies Arabic-Indic digits with Western ones (since Plan 6) and keeps Arabic punctuation', () => {
    expect(normalizeWithMap('١٢٣').text).toBe('123');
    expect(normalizeWithMap('٪٫٬').text).toBe('٪٫٬');
  });

  it('maps alef variants, alef maksura and teh marbuta', () => {
    expect(normalizeWithMap('أإآٱ').text).toBe('اااا');
    expect(normalizeWithMap('ى').text).toBe('ي');
    expect(normalizeWithMap('ة').text).toBe('ه');
  });

  it('collapses runs of whitespace to one space', () => {
    expect(normalizeWithMap('a \t\n  b').text).toBe('a b');
  });
});

describe('findMatches', () => {
  it('finds a vowelled query in unvowelled text and returns original indexes', () => {
    expect(findMatches('قال محمد اليوم', 'مُحَمَّد')).toEqual([{ index: 4, length: 4 }]);
  });

  it('finds a bare query in vowelled text', () => {
    expect(findMatches('قال مُحَمَّد اليوم', 'محمد')).toEqual([{ index: 4, length: 8 }]);
  });

  it('matches alef variants and teh marbuta', () => {
    expect(findMatches('أحمد', 'احمد')).toEqual([{ index: 0, length: 4 }]);
    expect(findMatches('مدرسة', 'مدرسه')).toEqual([{ index: 0, length: 5 }]);
  });

  it('finds Arabic-Indic digits in text and query', () => {
    expect(findMatches('رقم ١٢٣ هنا', '١٢٣')).toEqual([{ index: 4, length: 3 }]);
    expect(findMatches('صفحة ١٢', 'صفحة ١')).toEqual([{ index: 0, length: 6 }]);
  });

  it('is case-insensitive', () => {
    expect(findMatches('The Species species', 'species')).toEqual([
      { index: 4, length: 7 },
      { index: 12, length: 7 },
    ]);
  });

  it('returns nothing for a one-character or empty query', () => {
    expect(findMatches('abc', 'a')).toEqual([]);
    expect(findMatches('abc', '')).toEqual([]);
  });

  it('caps the number of results at max', () => {
    expect(findMatches('ab ab ab ab', 'ab', 2)).toHaveLength(2);
  });
});

describe('snippet', () => {
  it('adds an ellipsis only on the sides that were cut', () => {
    const text = 'x'.repeat(50) + 'MATCH' + 'y'.repeat(50);
    const s = snippet(text, { index: 50, length: 5 }, 10);
    expect(s).toEqual({ before: '…' + 'x'.repeat(10), match: 'MATCH', after: 'y'.repeat(10) + '…' });
  });

  it('adds no ellipsis when the whole text fits', () => {
    expect(snippet('Start MATCH end', { index: 6, length: 5 })).toEqual({
      before: 'Start',
      match: 'MATCH',
      after: 'end',
    });
  });

  it('trims whitespace around the context', () => {
    expect(snippet('  a MATCH b  ', { index: 4, length: 5 })).toEqual({ before: 'a', match: 'MATCH', after: 'b' });
  });
});

describe('pageTextOf', () => {
  it('joins items with spaces and collapses whitespace', () => {
    expect(pageTextOf([item('Hello ', 0, 0), item(' world', 0, 0)])).toBe('Hello world');
  });

  it('joins an item marked hasEOL with a newline', () => {
    expect(pageTextOf([item('A', 0, 0, { hasEOL: true }), item('B', 0, 0)])).toBe('A\nB');
  });
});

describe('hasSelectableText', () => {
  it('is false for no items or whitespace only', () => {
    expect(hasSelectableText([])).toBe(false);
    expect(hasSelectableText([item('  ', 0, 0)])).toBe(false);
  });

  it('is true from 10 non-whitespace characters', () => {
    expect(hasSelectableText([item('abcdefghi', 0, 0)])).toBe(false);
    expect(hasSelectableText([item('abcdefghij', 0, 0)])).toBe(true);
  });
});

describe('buildReflow with the reader\'s own direction', () => {
  const arabicLine = () => [item('القراءة', 316, 700), item('غذاء', 249, 700), item('العقل', 156, 700)];

  it('Auto reads an Arabic line right to left whatever the book says', () => {
    expect(buildReflow(arabicLine(), { rtl: false })[0].text).toBe('القراءة غذاء العقل');
  });

  it('a chosen left to right wins even for an Arabic line', () => {
    expect(buildReflow(arabicLine(), { rtl: false, forced: true })[0].text).toBe('العقل غذاء القراءة');
  });

  it('a chosen right to left wins for a line of numbers, and a Latin phrase keeps its own order', () => {
    expect(buildReflow([item('1', 10, 700), item('2', 60, 700)], { rtl: true, forced: true })[0].text).toBe('2 1');
    expect(buildReflow([item('Hello', 10, 700), item('world', 60, 700)], { rtl: true, forced: true })[0].text).toBe('Hello world');
  });
});

describe('buildReflow', () => {
  it('returns no paragraphs for no items', () => {
    expect(buildReflow([], { rtl: false })).toEqual([]);
  });

  it('puts items on the same line in one paragraph, left to right', () => {
    const r = buildReflow(
      [item('Hello', 10, 700), item('world', 60, 700)],
      { rtl: false },
    );
    expect(r).toEqual([{ text: 'Hello world', rtl: false }]);
  });

  it('joins lines 12 apart into one paragraph', () => {
    const r = buildReflow([item('First line', 10, 700), item('second line', 10, 688)], { rtl: false });
    expect(r).toEqual([{ text: 'First line second line', rtl: false }]);
  });

  it('starts a new paragraph after a gap of 40 when the median line spacing is 12', () => {
    // Gaps between lines: 12, 12, 40. Median 12; 40 > 1.6 * 12.
    const r = buildReflow(
      [
        item('one', 10, 700),
        item('two', 10, 688),
        item('three', 10, 676),
        item('four', 10, 636),
      ],
      { rtl: false },
    );
    expect(r.map((p) => p.text)).toEqual(['one two three', 'four']);
  });

  it('joins a hyphenated word split across lines', () => {
    const r = buildReflow([item('exam-', 10, 700), item('ple text', 10, 688)], { rtl: false });
    expect(r).toEqual([{ text: 'example text', rtl: false }]);
  });

  it('orders items right to left on an rtl page', () => {
    const r = buildReflow([item('second', 100, 700), item('first', 300, 700)], { rtl: true });
    expect(r[0].text.startsWith('first')).toBe(true);
    expect(r[0].text).toBe('first second');
  });

  it('orders the items of an Arabic line right to left even when the book is not marked rtl', () => {
    const r = buildReflow([item('العقل', 100, 700), item('غذاء', 200, 700), item('القراءة', 300, 700), item('Hello', 10, 600), item('world', 60, 600)], { rtl: false });
    expect(r.map((p) => p.text)).toEqual(['القراءة غذاء العقل Hello world']);
  });

  it('reflow keeps a Latin phrase in its own order inside an Arabic line, in a book that is not marked rtl', () => {
    const r = buildReflow([item('ثالث', 10, 700), item('Hello', 60, 700), item('World', 110, 700), item('ثاني', 160, 700), item('أول', 210, 700)], { rtl: false });
    expect(r.map((p) => p.text)).toEqual(['أول ثاني Hello World ثالث']);
  });

  it('marks Arabic paragraphs rtl and Latin paragraphs not rtl', () => {
    const r = buildReflow(
      // Gaps 100 and 12: median 56, so the 100 gap starts a new paragraph.
      [item('قال محمد اليوم', 10, 700), item('Hello world', 10, 600), item('more text', 10, 588)],
      { rtl: false },
    );
    expect(r).toEqual([
      { text: 'قال محمد اليوم', rtl: true },
      { text: 'Hello world more text', rtl: false },
    ]);
  });
});
