import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { join } from 'node:path';

// arabic.pdf (see e2e/fixtures/arabic-pdf.mjs): page 1 presentation forms, page 2 base letters, page 3 diacritics and
// Arabic-Indic digits, page 4 one text run per word written left to right. The book reads right to left.
const ARABIC = join(__dirname, 'fixtures', 'arabic.pdf');

async function openArabicBook(page: Page): Promise<void> {
  await page.goto('/library');
  await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles([ARABIC]);
  await page.getByRole('tab', { name: /To read/ }).click();
  await page.locator('[data-grid="main"] li').filter({ hasText: 'Arabic Book' }).click();
  await expect(page.locator('.r-top .pg')).toContainText('p. 1 / 4');
  await expect(page.locator('[data-slot="cur"] .text-layer span[data-item]').first()).toBeVisible();
}

/** Types a query in the Search tab and returns the hits' page labels. */
async function searchFor(page: Page, query: string): Promise<Locator> {
  const box = page.getByRole('searchbox');
  if (!(await box.isVisible())) {
    await page.getByRole('button', { name: 'Search', exact: true }).click();
  }
  await box.fill(query);
  return page.locator('iqra-drawer .hit');
}

async function goToPage(page: Page, n: number): Promise<void> {
  // The book is right to left: ArrowLeft turns forward.
  const label = page.locator('.r-top .pg');
  for (let p = 1; p < n; p++) {
    await page.keyboard.press('ArrowLeft');
    await expect(label).toContainText(`p. ${p + 1} / 4`);
  }
}

test.describe('arabic', () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    await openArabicBook(page);
  });

  test.afterEach(async () => {
    await context.close();
  });

  test('search finds a word written in presentation forms and in base letters, and the hit jumps', async () => {
    const hits = await searchFor(page, 'العلم');
    await expect(hits).toHaveCount(2);
    await expect(hits.nth(0)).toContainText('p. 1');
    await expect(hits.nth(1)).toContainText('p. 2');
    await hits.nth(1).click();
    await expect(page.locator('.r-top .pg')).toContainText('p. 2 / 4');
  });

  test('search ignores diacritics in the query and in the page, and unifies digits', async () => {
    let hits = await searchFor(page, 'الْكِتَابُ');
    await expect(hits).toHaveCount(2);
    await expect(hits.nth(0)).toContainText('p. 2');
    await expect(hits.nth(1)).toContainText('p. 3');
    hits = await searchFor(page, '123');
    await expect(hits).toHaveCount(1);
    await expect(hits.nth(0)).toContainText('p. 3');
    hits = await searchFor(page, '١٢٣');
    await expect(hits).toHaveCount(1);
  });

  test('search matches a phrase across a line break and words the PDF wrote left to right', async () => {
    let hits = await searchFor(page, 'الحياة الجميلة');
    await expect(hits).toHaveCount(1);
    await expect(hits.nth(0)).toContainText('p. 1');
    hits = await searchFor(page, 'القراءة غذاء العقل');
    await expect(hits).toHaveCount(1);
    await expect(hits.nth(0)).toContainText('p. 4');
    hits = await searchFor(page, 'من جد وجد');
    await expect(hits).toHaveCount(1);
  });

  test('text-layer spans carry dir=rtl and the layer does not force a direction', async () => {
    const dirs = await page.locator('[data-slot="cur"] .text-layer span[data-item]').evaluateAll((els) => els.map((e) => e.getAttribute('dir')));
    expect(dirs.length).toBeGreaterThan(0);
    expect(new Set(dirs)).toEqual(new Set(['rtl']));
    const bidi = await page.locator('[data-slot="cur"] .text-layer').evaluate((e) => getComputedStyle(e).unicodeBidi);
    expect(bidi).toBe('plaintext');
  });

  test('a right-to-left drag over a line the PDF wrote left to right selects the words in reading order and highlights over the line', async () => {
    await goToPage(page, 4);
    await expect(page.locator('[data-slot="cur"] .text-layer span[data-item]').first()).toBeVisible();
    const spans = page.locator('[data-slot="cur"] .text-layer span[data-item]');
    // The spans of the first line are in reading order: the first is the rightmost.
    const firstLine = await spans.evaluateAll((els) => {
      const top = els[0].getBoundingClientRect().top;
      return els.filter((e) => Math.abs(e.getBoundingClientRect().top - top) < 8).map((e) => ({ text: e.textContent ?? '', x: e.getBoundingClientRect().left, r: e.getBoundingClientRect().right, y: e.getBoundingClientRect().top + e.getBoundingClientRect().height / 2 }));
    });
    const words = firstLine.filter((w) => w.text.trim() !== '');
    expect(words.map((w) => w.text)).toEqual(['القراءة', 'غذاء', 'العقل', 'والروح']);
    expect(words[0].x).toBeGreaterThan(words[3].x);

    const y = words[0].y;
    await page.mouse.move(words[0].r - 3, y);
    await page.mouse.down();
    await page.mouse.move((words[0].r + words[3].x) / 2, y, { steps: 6 });
    await page.mouse.move(words[3].x + 3, y, { steps: 6 });
    await page.mouse.up();
    const bar = page.getByRole('toolbar', { name: 'Highlight' });
    await expect(bar).toBeVisible();
    await bar.getByRole('button', { name: 'Yellow' }).click();

    const marks = page.locator('iqra-highlight-layer [data-id]');
    await expect(marks).not.toHaveCount(0);
    const boxes = await marks.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })));
    const union = boxes.reduce((a, b) => ({ left: Math.min(a.left, b.left), right: Math.max(a.right, b.right), top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom) }));
    // The highlight covers the line horizontally (all four words) and sits on the line vertically.
    expect(union.left).toBeLessThanOrEqual(words[3].x + 10);
    expect(union.right).toBeGreaterThanOrEqual(words[0].r - 10);
    expect(union.top).toBeLessThanOrEqual(y);
    expect(union.bottom).toBeGreaterThanOrEqual(y);

    await page.getByRole('button', { name: 'Contents & notes' }).click();
    await page.getByRole('tab', { name: 'Notes' }).click();
    await expect(page.locator('iqra-drawer .prev').first()).toHaveText('القراءة غذاء العقل والروح');
  });

  test('a programmatic selection over an Arabic line gives the same quote', async () => {
    await goToPage(page, 4);
    const spans = page.locator('[data-slot="cur"] .text-layer span[data-item]');
    await expect(spans.first()).toBeVisible();
    await spans.first().evaluate((first) => {
      const layer = first.parentElement!;
      const lineSpans = Array.from(layer.querySelectorAll('span[data-item]')).slice(0, 7);
      const range = document.createRange();
      range.setStart(lineSpans[0].firstChild!, 0);
      const last = lineSpans[lineSpans.length - 1];
      range.setEnd(last.firstChild!, last.textContent!.length);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });
    await page.getByRole('toolbar', { name: 'Highlight' }).getByRole('button', { name: 'Green' }).click();
    await page.getByRole('button', { name: 'Contents & notes' }).click();
    await page.getByRole('tab', { name: 'Notes' }).click();
    await expect(page.locator('iqra-drawer .prev').first()).toHaveText('القراءة غذاء العقل والروح');
  });
});
