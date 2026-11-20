import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { join } from 'node:path';

const FIXTURES = join(__dirname, 'fixtures');
const SAMPLE = join(FIXTURES, 'sample.pdf');
const BROKEN = join(FIXTURES, 'broken.pdf');

/** Handles exposed by the app in the e2e build (see src/app/e2e-hooks.ts). */
interface E2eWindow {
  __iqraSync: { syncNow(): Promise<void> };
  __iqraDrive: { exportState(): string; importState(json: string): void };
}

/** Opens a fresh browser context, which is a device with its own local database and fake Drive. */
async function openDevice(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto('/library');
  await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
  return page;
}

/** A full pass: syncNow() shares a pass already running, which may predate the caller's latest change, so run it twice. */
async function syncTwice(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const engine = (window as unknown as E2eWindow).__iqraSync;
    await engine.syncNow();
    await engine.syncNow();
  });
}

function bookCard(page: Page, title: string): Locator {
  return page.locator('[data-grid="main"] li').filter({ hasText: title });
}

test('library syncs between devices', async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  try {
    // Device A: add a good PDF and a broken one.
    const deviceA = await openDevice(contextA);
    await deviceA.locator('input[type="file"]').setInputFiles([SAMPLE, BROKEN]);
    // The toast is the role=status element inside the toast component (.toast); the sync status is also role=status.
    await expect(deviceA.locator('.toast')).toContainText("broken.pdf couldn't be added");
    await deviceA.getByRole('tab', { name: /To read/ }).click();
    await expect(bookCard(deviceA, 'Sample Book')).toBeVisible();

    // Push device A's library to Drive, then copy the fake Drive to device B.
    await syncTwice(deviceA);
    const driveState = await deviceA.evaluate(() => (window as unknown as E2eWindow).__iqraDrive.exportState());

    // Device B: load the app, take the Drive state, and pull the library.
    const deviceB = await openDevice(contextB);
    await deviceB.evaluate((state) => (window as unknown as E2eWindow).__iqraDrive.importState(state), driveState);
    await syncTwice(deviceB);
    await deviceB.getByRole('tab', { name: /To read/ }).click();

    const card = bookCard(deviceB, 'Sample Book');
    await expect(card.locator('[aria-label="Not downloaded"]')).toBeVisible();
    await card.click();
    await expect(deviceB.getByText('Read from Google Drive')).toBeVisible();
    await deviceB.getByRole('button', { name: 'Download to this device' }).click();

    await expect(deviceB).toHaveURL(/\/read\//);
    await expect(deviceB.getByText('p. 1 / 5')).toBeVisible();
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test('delete everywhere with undo', async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const page = await openDevice(context);
    await page.locator('input[type="file"]').setInputFiles([SAMPLE]);
    await page.getByRole('tab', { name: /To read/ }).click();
    const card = bookCard(page, 'Sample Book');
    await expect(card).toBeVisible();

    // Long press or right-click opens the details sheet.
    await card.click({ button: 'right' });
    await page.getByRole('button', { name: 'Remove book', exact: true }).click();
    await page.getByRole('button', { name: 'Delete everywhere' }).click();
    await expect(card).toHaveCount(0);

    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(card).toBeVisible();
  } finally {
    await context.close();
  }
});

test('the Library home and Profile never scroll sideways, at 320, 390 and 1280 px, in dark mode', async ({ browser }) => {
  for (const width of [320, 390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 800 }, colorScheme: 'dark' });
    try {
      const page = await openDevice(context);
      await page.locator('input[type="file"]').setInputFiles([SAMPLE]);
      await expect(bookCard(page, 'Sample Book')).toBeVisible();
      const fits = () => page.evaluate(() => document.querySelector('.view')!.scrollWidth <= document.querySelector('.view')!.clientWidth);
      expect(await fits(), `library at ${width}px`).toBe(true);
      await expect(page.getByTestId('welcome-stats')).toBeVisible();
      await page.getByRole('link', { name: 'Profile' }).click();
      await expect(page.getByTestId('profile-name')).toBeVisible();
      expect(await fits(), `profile at ${width}px`).toBe(true);
    } finally {
      await context.close();
    }
  }
});
