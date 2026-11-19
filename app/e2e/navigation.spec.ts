import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { join } from 'node:path';

const OUTLINE = join(__dirname, 'fixtures', 'outline.pdf');
const TITLE = 'Outline Book';

async function openLibrary(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto('/library');
  await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles([OUTLINE]);
  await page.getByRole('tab', { name: /To read/ }).click();
  await expect(page.locator('[data-grid="main"] li').filter({ hasText: TITLE })).toBeVisible();
  return page;
}

async function openBook(page: Page): Promise<void> {
  await page.locator('[data-grid="main"] li').filter({ hasText: TITLE }).click();
  await expect(page.locator('.r-top .pg')).toContainText('p. 1 / 12');
}

const path = (page: Page) => new URL(page.url()).pathname;
const libraryShown = (page: Page) => expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();

test.describe('back navigation', () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    context = await browser.newContext();
    page = await openLibrary(context);
  });
  test.afterEach(async () => {
    await context.close();
  });

  test('Library -> book -> browser Back returns to the Library', async () => {
    await openBook(page);
    expect(path(page)).toMatch(/^\/read\//);
    await page.goBack();
    await libraryShown(page);
    expect(path(page)).toBe('/library');
  });

  test("Library -> book -> the header's back arrow returns to the Library without adding history", async () => {
    const before = await page.evaluate(() => history.length);
    await openBook(page);
    const open = await page.evaluate(() => history.length);
    expect(open).toBe(before + 1);
    await page.getByRole('link', { name: 'Back to library' }).click();
    await libraryShown(page);
    expect(path(page)).toBe('/library');
    // A step back, not a new entry: the browser's own Forward still leads to the book.
    expect(await page.evaluate(() => history.length)).toBe(open);
    await page.goForward();
    await expect(page.locator('.r-top .pg')).toContainText('p. 1 / 12');
  });

  test('Library -> book -> back arrow -> Settings -> browser Back returns to the Library, not the book', async () => {
    await openBook(page);
    await page.getByRole('link', { name: 'Back to library' }).click();
    await libraryShown(page);
    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    await page.goBack();
    await libraryShown(page);
    expect(path(page)).toBe('/library');
  });

  test("Settings' back arrow steps back too: Library -> Settings -> arrow -> browser Back leaves the app's pages behind", async () => {
    const before = await page.evaluate(() => history.length);
    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Back to library' }).click();
    await libraryShown(page);
    expect(await page.evaluate(() => history.length)).toBe(before + 1);
  });

  test('after a reload the reader has no history behind it: the arrow goes to the Library and replaces the entry', async () => {
    await openBook(page);
    await page.reload();
    await expect(page.locator('.r-top .pg')).toContainText('p. 1 / 12');
    const length = await page.evaluate(() => history.length);
    await page.getByRole('link', { name: 'Back to library' }).click();
    await libraryShown(page);
    expect(await page.evaluate(() => history.length)).toBe(length);
  });

  test('leaving the reader saves the position first', async () => {
    await openBook(page);
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.r-top .pg')).toContainText('p. 2 / 12');
    await page.getByRole('link', { name: 'Back to library' }).click();
    await libraryShown(page);
    await page.getByRole('tab', { name: /All/ }).click();
    await page.locator('[data-grid="main"] li').filter({ hasText: TITLE }).click();
    await expect(page.locator('.r-top .pg')).toContainText('p. 2 / 12');
  });

  test('leaving the reader syncs the new position at once, not after the 5 s debounce or the 2 minute poll', async () => {
    await openBook(page);
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.r-top .pg')).toContainText('p. 2 / 12');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.r-top .pg')).toContainText('p. 3 / 12');
    /** True when a shard on the fake Drive holds a position record for page 3. */
    const onDrive = () =>
      page.evaluate(() => {
        const state = JSON.parse((window as unknown as { __iqraDrive: { exportState(): string } }).__iqraDrive.exportState()) as { entries: { info: { name: string }; content: string }[] };
        return state.entries.some((e) => e.info.name.startsWith('book-') && /"page":\s*3\b/.test(e.content));
      });
    expect(await onDrive()).toBe(false);
    await page.getByRole('link', { name: 'Back to library' }).click();
    await libraryShown(page);
    await expect.poll(onDrive, { timeout: 3500, intervals: [100] }).toBe(true);
  });
});

test.describe('session lapse', () => {
  test('a lapsed session shows one Reconnect bar, and one click removes it', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await openLibrary(context);
    const bar = page.getByRole('status').filter({ hasText: 'Reconnect to keep syncing' });
    await expect(bar).toHaveCount(0);

    await page.evaluate(() => (window as unknown as { __iqraAuth: { markExpired(): void } }).__iqraAuth.markExpired());
    await expect(bar).toHaveCount(1);
    await expect(page.locator('.toast')).toHaveCount(0);
    // Reading and editing carry on without any prompt, and the bar stays out of the reader.
    await openBook(page);
    await expect(bar).toHaveCount(0);
    await page.getByRole('link', { name: 'Back to library' }).click();
    await libraryShown(page);
    await expect(bar).toHaveCount(1);

    await bar.getByRole('button', { name: 'Reconnect' }).click();
    await expect(bar).toHaveCount(0);
    await expect(page.locator('iqra-sync-status')).toContainText('Synced');
    await context.close();
  });
});
