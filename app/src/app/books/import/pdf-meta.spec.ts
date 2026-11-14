import { cleanTitle, detectLanguage, mapOutline, type PdfOutlineItem } from './pdf-meta';

describe('cleanTitle', () => {
  it('drops a Word-generated info title that ends in a document extension', () => {
    expect(cleanTitle('Microsoft Word - Notes.docx', 'x.pdf')).toBe('x');
  });

  it('uses a usable info title, trimmed', () => {
    expect(cleanTitle(' Thinking in Systems ', 'a.pdf')).toBe('Thinking in Systems');
  });

  it('falls back to the file name when the info title is empty', () => {
    expect(cleanTitle('', 'clean_code-2nd ed.pdf')).toBe('clean code 2nd ed');
  });

  it('treats "untitled" as no title, in any case', () => {
    expect(cleanTitle('UNTITLED', 'my_book.pdf')).toBe('my book');
  });

  it('strips the Word prefix from a usable title', () => {
    expect(cleanTitle('Microsoft Word - Field Notes', 'x.pdf')).toBe('Field Notes');
  });
});

describe('detectLanguage', () => {
  it('detects Arabic', () => {
    expect(detectLanguage('مقدمة ابن خلدون في التاريخ')).toBe('ar');
  });

  it('detects English', () => {
    expect(detectLanguage('The origin of species')).toBe('en');
  });

  it('returns other when there are no letters', () => {
    expect(detectLanguage('12345 ...')).toBe('other');
  });

  it('returns other when neither script dominates', () => {
    expect(detectLanguage('abcd привет مرح')).toBe('other');
  });
});

describe('mapOutline', () => {
  it('keys nodes by index path and resolves pages, falling back to the parent page', async () => {
    const items: PdfOutlineItem[] = [{ title: 'Ch1', dest: 'd1', items: [{ title: '1.1', dest: 'bad', items: [] }] }];
    const pages: Record<string, number | null> = { d1: 5, bad: null };

    const outline = await mapOutline(items, async (dest) => pages[dest as string] ?? null);

    expect(outline).toEqual([
      { key: '0', title: 'Ch1', page: 5, children: [{ key: '0.1', title: '1.1', page: 5, children: [] }] },
    ]);
  });
});
