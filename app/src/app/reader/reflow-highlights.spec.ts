import { describe, expect, it } from 'vitest';
import { splitPageRuns, splitRuns } from './reflow-highlights';

const mark = (id: string, quote: string, extra: Partial<Parameters<typeof splitRuns>[1][number]> = {}) => ({
  id,
  quote,
  color: 'yellow' as const,
  underline: false,
  hasDetail: false,
  ...extra,
});

describe('splitRuns', () => {
  it('splits plain text around one mark into three runs', () => {
    expect(splitRuns('Before the quote after.', [mark('a', 'the quote')])).toEqual([
      { text: 'Before ' },
      { text: 'the quote', annotationId: 'a', color: 'yellow' },
      { text: ' after.' },
    ]);
  });

  it('handles two marks in order', () => {
    const runs = splitRuns('one two three four', [mark('b', 'three'), mark('a', 'one', { color: 'blue' })]);
    expect(runs.map((r) => r.text)).toEqual(['one', ' two ', 'three', ' four']);
    expect(runs[0]).toMatchObject({ annotationId: 'a', color: 'blue' });
    expect(runs[2]).toMatchObject({ annotationId: 'b' });
  });

  it('finds an Arabic quote with diacritics inside an Arabic paragraph', () => {
    const para = 'قَالَ الشَّيْخُ إِنَّ الْعِلْمَ نُورٌ وَالْجَهْلَ ظُلْمَةٌ';
    const runs = splitRuns(para, [mark('ar', 'الْعِلْمَ نُورٌ')]);
    expect(runs.map((r) => r.text)).toEqual(['قَالَ الشَّيْخُ إِنَّ ', 'الْعِلْمَ نُورٌ', ' وَالْجَهْلَ ظُلْمَةٌ']);
    expect(runs[1].annotationId).toBe('ar');
  });

  it('a quote that is not present yields only the plain run', () => {
    expect(splitRuns('Nothing here', [mark('a', 'absent words')])).toEqual([{ text: 'Nothing here' }]);
    expect(splitRuns('', [mark('a', 'x')])).toEqual([]);
  });

  it('ignores whitespace differences between the quote and the text', () => {
    const runs = splitRuns('a  big   dog barked', [mark('a', 'big dog')]);
    expect(runs.map((r) => r.text)).toEqual(['a  ', 'big   dog', ' barked']);
  });

  it('puts the dot on the last run of a mark with detail only', () => {
    const runs = splitRuns('x note y plain z', [mark('a', 'note', { hasDetail: true }), mark('b', 'plain')]);
    expect(runs.find((r) => r.annotationId === 'a')).toMatchObject({ dot: true });
    expect(runs.find((r) => r.annotationId === 'b')?.dot).toBeUndefined();
  });

  it('a note mark is underlined without a color', () => {
    const runs = splitRuns('see this here', [mark('n', 'this', { color: undefined, underline: true })]);
    expect(runs[1]).toEqual({ text: 'this', annotationId: 'n', underline: true });
  });

  it('overlapping marks never overlap: the earlier one wins', () => {
    const runs = splitRuns('alpha beta gamma', [mark('a', 'alpha beta'), mark('b', 'beta gamma')]);
    expect(runs.map((r) => r.text).join('')).toBe('alpha beta gamma');
    expect(runs.filter((r) => r.annotationId === 'a').map((r) => r.text).join('')).toBe('alpha beta');
    expect(runs.some((r) => r.annotationId === 'b')).toBe(false);
  });

  it('a second mark with the same quote takes the next uncovered occurrence', () => {
    const runs = splitRuns('cat and cat', [mark('a', 'cat'), mark('b', 'cat')]);
    expect(runs.map((r) => [r.text, r.annotationId])).toEqual([
      ['cat', 'a'],
      [' and ', undefined],
      ['cat', 'b'],
    ]);
  });

  describe('a quote spanning two paragraphs', () => {
    const quote = 'the end of one and the start of next';
    it('marks the tail of the first paragraph and the head of the second; the dot is on the last piece', () => {
      const runs = splitPageRuns(['Some text then the end of one', 'and the start of next, more words'], [mark('s', quote, { hasDetail: true })]);
      expect(runs[0].map((r) => r.text)).toEqual(['Some text then ', 'the end of one']);
      expect(runs[0][1].dot).toBeUndefined();
      expect(runs[1].map((r) => r.text)).toEqual(['and the start of next', ', more words']);
      expect(runs[1][0]).toMatchObject({ annotationId: 's', dot: true });
    });
    it('marks a whole middle paragraph', () => {
      const runs = splitPageRuns(['tail words', 'and then more', 'head words'], [mark('s', 'tail words and then more head words')]);
      expect(runs.map((r) => r.map((x) => x.annotationId))).toEqual([['s'], ['s'], ['s']]);
    });
    it('does not mark paragraph edges when the full quote is not on the page', () => {
      const runs = splitPageRuns(['Some text then the end of one', 'something else entirely'], [mark('s', quote)]);
      expect(runs.flat().some((r) => r.annotationId)).toBe(false);
    });
    it('does not mark a lone paragraph edge that merely matches the quote start', () => {
      // The quote lives wholly in paragraph 3; paragraph 1 ends with its first words and paragraph 2 starts with its last.
      const runs = splitPageRuns(['It was over the', 'lazy dog. Then', 'x the quick brown fox jumps over the lazy dog'], [mark('q', 'the quick brown fox jumps over the lazy dog')]);
      expect(runs[0].some((r) => r.annotationId)).toBe(false);
      expect(runs[1].some((r) => r.annotationId)).toBe(false);
      expect(runs[2].some((r) => r.annotationId)).toBe(true);
    });
  });

  describe('which occurrence', () => {
    it('takes the nth occurrence, counted across paragraphs', () => {
      const runs = splitPageRuns(['the cat sat', 'the cat ran', 'the cat hid'], [mark('a', 'the cat', { nth: 1 })]);
      expect(runs.map((r) => r.some((x) => x.annotationId))).toEqual([false, true, false]);
    });

    it('two marks with the same quote land on their own occurrences, whatever their order', () => {
      const marks = [mark('second', 'dog', { nth: 1 }), mark('first', 'dog', { nth: 0 })];
      const runs = splitPageRuns(['dog and dog'], marks)[0];
      expect(runs.map((r) => [r.text, r.annotationId])).toEqual([
        ['dog', 'first'],
        [' and ', undefined],
        ['dog', 'second'],
      ]);
    });

    it('an nth that does not exist draws nothing', () => {
      expect(splitPageRuns(['one dog'], [mark('a', 'dog', { nth: 3 })])[0]).toEqual([{ text: 'one dog' }]);
    });
  });

  describe('word boundaries', () => {
    it('does not draw a short quote inside a longer word', () => {
      const runs = splitRuns('Beginning in the end', [mark('a', 'in')]);
      expect(runs.map((r) => [r.text, r.annotationId])).toEqual([
        ['Beginning ', undefined],
        ['in', 'a'],
        [' the end', undefined],
      ]);
    });

    it('does not draw an Arabic word inside a longer word with the al- prefix', () => {
      const runs = splitRuns('العلم نور علم نافع', [mark('a', 'علم')]);
      expect(runs.some((r) => r.annotationId && r.text === 'علم')).toBe(true);
      expect(runs.find((r) => r.annotationId)!.text).toBe('علم');
      expect(runs[0].annotationId).toBeUndefined();
    });

    it('the Arabic repeated word lands on its own occurrence by nth', () => {
      const runs = splitRuns('طلب علم ثم نشر علم', [mark('a', 'علم', { nth: 1 })]);
      expect(runs.map((r) => [r.text, r.annotationId])).toEqual([
        ['طلب علم ثم نشر ', undefined],
        ['علم', 'a'],
      ]);
    });

    it('draws mid-word when the original selection was mid-word', () => {
      const runs = splitRuns('Beginning', [mark('a', 'gin', { wordStart: false, wordEnd: false })]);
      expect(runs.map((r) => r.text)).toEqual(['Be', 'gin', 'ning']);
    });
  });
});
