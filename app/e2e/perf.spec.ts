import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A long Arabic book (generated here, never committed): paging through it must keep a bounded number of page canvases
// and text-layer spans alive, however many pages were visited.
const PAGES = 80;
let pdf = '';

test.beforeAll(() => {
  pdf = join(mkdtempSync(join(tmpdir(), 'iqra-heavy-')), 'heavy.pdf');
  execFileSync('node', [join(__dirname, 'fixtures', 'heavy-arabic.mjs'), pdf, String(PAGES), '1']);
});

async function footprint(page: Page) {
  return page.evaluate(() => {
    const canvases = [...document.querySelectorAll('canvas')];
    return {
      canvases: canvases.length,
      pixels: canvases.reduce((n, c) => n + c.width * c.height, 0),
      spans: document.querySelectorAll('.text-layer span').length,
      views: document.querySelectorAll('iqra-page-view').length,
    };
  });
}

test('paging through 50 pages keeps live canvases, pixels and text layers bounded', async ({ browser }) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto('/library');
  await page.locator('input[type="file"]').setInputFiles([pdf]);
  await page.getByRole('tab', { name: /To read/ }).click();
  await page.locator('[data-grid="main"] li').first().click();
  await expect(page.locator('.r-top .pg')).toContainText(`p. 1 / ${PAGES}`);
  await expect(page.locator('[data-slot="cur"] .text-layer span[data-item]').first()).toBeVisible();

  for (let p = 1; p <= 50; p++) {
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('.r-top .pg')).toContainText(`p. ${p + 1} / ${PAGES}`);
  }
  await expect(page.locator('[data-slot="cur"] .text-layer span[data-item]').first()).toBeVisible();
  await expect.poll(async () => (await footprint(page)).canvases, { timeout: 10_000 }).toBeLessThanOrEqual(3);
  const swipe = await footprint(page);
  // previous, current and next page only
  expect(swipe.views).toBeLessThanOrEqual(3);
  expect(swipe.canvases).toBeLessThanOrEqual(3);
  expect(swipe.pixels).toBeLessThanOrEqual(3 * 10_000_000);

  // Scrolling mode: only the pages near the viewport are alive after a long scroll.
  await page.mouse.move(640, 790);
  await page.getByRole('button', { name: 'Reading settings' }).click();
  await page.getByRole('radio', { name: 'Scrolling' }).click();
  await page.getByRole('button', { name: 'Close' }).click();
  const viewport = page.locator('iqra-scroller .viewport');
  await expect(viewport).toBeVisible();
  for (let i = 0; i < 40; i++) {
    await viewport.evaluate((el) => (el.scrollTop += 900));
    await page.waitForTimeout(60);
  }
  await expect.poll(async () => (await footprint(page)).canvases, { timeout: 10_000 }).toBeLessThanOrEqual(5);
  const scroll = await footprint(page);
  expect(scroll.views).toBeLessThanOrEqual(5);
  expect(scroll.pixels).toBeLessThanOrEqual(5 * 10_000_000);
  expect(scroll.spans).toBeLessThan(2000);
  await context.close();
});
