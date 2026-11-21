import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { join } from 'node:path';

const OUTLINE = join(__dirname, 'fixtures', 'outline.pdf');
const TITLE = 'Outline Book';

/** The translation providers are external services; the tests answer for them. */
async function mockProviders(context: BrowserContext, mode: 'ok' | 'down' = 'ok'): Promise<void> {
  // Chrome's built-in Translator is device dependent; take it out of the chain so MyMemory (mocked) answers.
  await context.addInitScript(() => {
    Object.defineProperty(window, 'Translator', { value: undefined, configurable: true });
  });
  await context.route('**/api.mymemory.translated.net/**', (route) =>
    mode === 'down'
      ? route.abort('failed')
      : route.fulfill({ json: { responseStatus: 200, responseData: { translatedText: 'ترجمة تجريبية' } } }),
  );
  await context.route('**/api.dictionaryapi.dev/**', (route) =>
    route.fulfill({ status: 404, json: { title: 'No Definitions Found' } }),
  );
}

async function openBook(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto('/library');
  await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles([OUTLINE]);
  await page.getByRole('tab', { name: /To read/ }).click();
  const card = page.locator('[data-grid="main"] li').filter({ hasText: TITLE });
  await expect(card).toBeVisible();
  await card.click();
  await expect(page.locator('.r-top .pg')).toContainText('p. 1 / 12');
  return page;
}

/** Selects the whole text of the first span of the current page, as a drag would; returns that text. */
async function selectFirstSpan(page: Page): Promise<string> {
  const span = page.locator('[data-slot="cur"] .text-layer span[data-item]').first();
  await expect(span).toBeVisible();
  return span.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  });
}

test.describe('review', () => {
  let context: BrowserContext;

  test.beforeEach(async ({ browser }) => {
    context = await browser.newContext();
  });
  test.afterEach(async () => {
    await context.close();
  });

  test('translate a selection, save it, see the due badge, list it and practise it', async () => {
    await mockProviders(context);
    const page = await openBook(context);
    const text = await selectFirstSpan(page);

    await page.getByRole('toolbar', { name: 'Highlight' }).getByRole('button', { name: 'Translate' }).click();
    const sheet = page.getByRole('dialog', { name: 'Translate' });
    await expect(sheet.getByTestId('source')).toHaveText(text);
    await expect(sheet.getByTestId('translation')).toHaveText('ترجمة تجريبية');
    await sheet.getByTestId('save-review').click();
    await expect(sheet.getByTestId('save-review')).toContainText('Saved to Review');
    await page.keyboard.press('Escape');

    await page.getByRole('link', { name: 'Back to library' }).click();
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByTestId('due-badge')).toHaveText('1');
    const tabs = await nav.getByRole('link').allTextContents();
    expect(tabs.map((t) => t.replace(/\d+$/, '').trim())).toEqual(['Profile', 'Library', 'Notes', 'Review', 'Stats']);
    await nav.getByRole('link', { name: /Review/ }).click();

    await expect(page.getByRole('heading', { name: 'Review', exact: true })).toBeVisible();
    await expect(page.getByTestId('review-item')).toHaveCount(1);
    await expect(page.getByTestId('review-item')).toContainText('ترجمة تجريبية');

    await page.getByTestId('start-practice').click();
    await expect(page.getByTestId('progress')).toHaveText('0 of 1');
    await page.keyboard.press('Space');
    await expect(page.getByTestId('back')).toBeVisible();
    await page.keyboard.press('3');
    await expect(page.getByTestId('finished')).toBeVisible();
    await page.getByRole('button', { name: 'Back to the list' }).click();
    // Graded Good: nothing is due now, so the badge is gone.
    await expect(nav.getByTestId('due-badge')).toHaveCount(0);
    await expect(page.getByTestId('review-item')).toContainText('Due tomorrow');
  });

  test('when the providers are down the sheet says so and Save stays off', async () => {
    await mockProviders(context, 'down');
    const page = await openBook(context);
    await selectFirstSpan(page);
    await page.getByRole('toolbar', { name: 'Highlight' }).getByRole('button', { name: 'Translate' }).click();
    const sheet = page.getByRole('dialog', { name: 'Translate' });
    await expect(sheet.getByTestId('translate-error')).toBeVisible();
    await expect(sheet.getByTestId('save-review')).toBeDisabled();
  });

  test('the Review page fits 320 px without sideways scrolling, with items and when empty', async ({ browser }) => {
    await mockProviders(context);
    const page = await openBook(context);
    await page.setViewportSize({ width: 320, height: 640 });
    const bar = page.getByRole('toolbar', { name: 'Highlight' });
    // The page re-renders after the resize; select again until the toolbar shows.
    await expect(async () => {
      await selectFirstSpan(page);
      await expect(bar).toBeVisible({ timeout: 1000 });
    }).toPass();
    const box = (await bar.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
    await bar.getByRole('button', { name: 'Translate' }).click();
    await page.getByTestId('save-review').click();
    await expect(page.getByTestId('save-review')).toContainText('Saved');
    await page.keyboard.press('Escape');
    await page.getByRole('link', { name: 'Back to library' }).click();
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /Review/ }).click();
    await expect(page.getByTestId('review-item')).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    const fresh = await browser.newContext({ viewport: { width: 320, height: 640 } });
    const empty = await fresh.newPage();
    await empty.goto('/review');
    await expect(empty.getByTestId('review-empty')).toBeVisible();
    expect(await empty.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await fresh.close();
  });
});
