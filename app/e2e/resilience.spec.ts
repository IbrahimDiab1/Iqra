import { expect, test } from '@playwright/test';

// After a deploy the old lazy chunks are gone from the server. The app must recover by itself (one reload) instead of
// leaving a dead tab.
test('a lazy chunk that fails to load reloads the app once and the page opens', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/library');
  await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();

  let blocked = 0;
  await page.route('**/chunk-*.js', async (route) => {
    // Only the first load of any chunk fails; the reload gets them.
    if (blocked < 20) {
      blocked++;
      await route.abort();
    } else {
      await route.continue();
    }
  });
  const reloaded = page.waitForEvent('load');
  await page.getByRole('link', { name: 'Stats' }).click();
  await reloaded;
  await page.unroute('**/chunk-*.js');
  await page.goto('/stats');
  await expect(page.getByRole('heading', { name: 'Stats', exact: true })).toBeVisible();
  await expect(page.locator('[data-ready]')).toBeVisible();
  expect(blocked).toBeGreaterThan(0);
  await context.close();
});

test('the Stats page shows an error with Retry, not a blank page, when the database cannot be read', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  // Every read of the sessions table fails until the test lets it work.
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.openCursor;
    (window as unknown as { __failReads: boolean }).__failReads = true;
    IDBObjectStore.prototype.openCursor = function (...args) {
      if ((window as unknown as { __failReads: boolean }).__failReads && this.name === 'sessions') throw new DOMException('Internal error', 'UnknownError');
      return original.apply(this, args);
    };
  });
  await page.goto('/library');
  await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Stats' }).click();
  await expect(page.getByTestId('stats-error')).toBeVisible();
  await page.evaluate(() => ((window as unknown as { __failReads: boolean }).__failReads = false));
  await page.getByTestId('stats-retry').click();
  await expect(page.locator('[data-ready]')).toBeVisible();
  await expect(page.getByTestId('stats-error')).toHaveCount(0);
  await context.close();
});
