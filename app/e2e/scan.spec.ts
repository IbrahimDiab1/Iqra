import { expect, test } from '@playwright/test';
import { join } from 'node:path';

// ccitt.pdf (see e2e/fixtures/ccitt-pdf.mjs): page 1 text, page 2 a 1-bit CCITT G4 scan (a black triangle).
const SCAN = join(__dirname, 'fixtures', 'ccitt.pdf');

test('a CCITT-scanned page is painted, not blank', async ({ page }) => {
  await page.goto('/library');
  await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles([SCAN]);
  await page.getByRole('tab', { name: /To read/ }).click();
  await page.locator('[data-grid="main"] li').filter({ hasText: 'Scan Book' }).click();
  await expect(page.locator('.r-top .pg')).toContainText('p. 1 / 2');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.r-top .pg')).toContainText('p. 2 / 2');

  // The triangle covers about a third of the page: count the dark pixels of the current page's canvas.
  await expect
    .poll(() =>
      page.locator('[data-slot="cur"] canvas').evaluate((c) => {
        const canvas = c as HTMLCanvasElement;
        if (canvas.width === 0) return 0;
        const d = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
        let dark = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] < 100 && d[i + 3] > 200) dark++;
        return dark / (d.length / 4);
      }),
    )
    .toBeGreaterThan(0.2);
});
