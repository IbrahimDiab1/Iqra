import { describe, expect, it } from 'vitest';
import { splitRuns } from './reflow-highlights';

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
    it('highlights the tail of the first paragraph (no dot)', () => {
      const runs = splitRuns('Some text then the end of one', [mark('s', quote, { hasDetail: true })]);
      expect(runs.map((r) => r.text)).toEqual(['Some text then ', 'the end of one']);
      expect(runs[1].annotationId).toBe('s');
      expect(runs[1].dot).toBeUndefined();
    });
    it('highlights the head of the second paragraph and puts the dot there', () => {
      const runs = splitRuns('and the start of next, more words', [mark('s', quote, { hasDetail: true })]);
      expect(runs.map((r) => r.text)).toEqual(['and the start of next', ', more words']);
      expect(runs[0]).toMatchObject({ annotationId: 's', dot: true });
    });
    it('highlights a whole middle paragraph', () => {
      const runs = splitRuns('and then more', [mark('s', 'tail words and then more head words')]);
      expect(runs).toEqual([{ text: 'and then more', annotationId: 's', color: 'yellow' }]);
    });
    it('does not highlight a stray character that merely ends a word', () => {
      expect(splitRuns('banana', [mark('s', 'a different quote')])).toEqual([{ text: 'banana' }]);
    });
  });
});
