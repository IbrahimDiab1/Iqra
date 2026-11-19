import { expect, test, type BrowserContext, type Download, type Locator, type Page } from '@playwright/test';
import { join } from 'node:path';

test('the gear opens Settings; Monday is saved as the week start; sign out with clear wipes the device', async ({ page }) => {
  await page.goto('/library');
  await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByText('reader@example.test')).toBeVisible();

  await page.locator('[data-group="weekStartsOn"]').getByRole('button', { name: 'Monday' }).click();
  await expect(page.locator('[data-group="weekStartsOn"]').getByRole('button', { name: 'Monday' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByTestId('sign-out').click();
  await page.getByTestId('clear-device').check();
  await page.getByTestId('confirm-sign-out').click();
  // The e2e build signs in again on load, so the reload lands back in the library: with an empty database.
  await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.locator('[data-group="weekStartsOn"]').getByRole('button', { name: 'Saturday' })).toHaveAttribute('aria-pressed', 'true');
});

test('categories can be added, reordered, deleted and restored with Undo', async ({ page }) => {
  await page.goto('/settings');
  const names = page.locator('[data-testid="cat-name"]');
  for (const name of ['Fiqh', 'History']) {
    await page.getByTestId('add-input').fill(name);
    await page.getByTestId('add').click();
  }
  await expect(names).toHaveText(['Fiqh', 'History']);

  await page.getByRole('button', { name: 'Move Fiqh down' }).click();
  await expect(names).toHaveText(['History', 'Fiqh']);

  await page.getByRole('button', { name: 'Delete History' }).click();
  await expect(names).toHaveText(['Fiqh']);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(names).toHaveText(['History', 'Fiqh']);
});

/* ---- storage, downloads, your data, reminders ---- */

const SAMPLE = join(__dirname, 'fixtures', 'sample.pdf');

interface E2eCalendar {
  __iqraCalendar: { live(): { id: string; title: string; startsAt: string; description: string }[]; events: Map<string, unknown> };
}

async function openDevice(context: BrowserContext, path = '/library'): Promise<Page> {
  const page = await context.newPage();
  await page.goto(path);
  return page;
}

function bookCard(page: Page, title = 'Sample Book'): Locator {
  return page.locator('[data-grid="main"] li').filter({ hasText: title });
}

async function addSample(page: Page): Promise<void> {
  await page.locator('input[type="file"]').setInputFiles([SAMPLE]);
  await page.getByRole('tab', { name: /To read/ }).click();
  await expect(bookCard(page)).toBeVisible();
}

/** Opens the sample book, saves a highlight on its first text and returns to the library. */
async function addHighlight(page: Page): Promise<void> {
  await bookCard(page).click();
  const span = page.locator('[data-slot="cur"] .text-layer span[data-item]').first();
  await expect(span).toBeVisible();
  await span.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await page.getByRole('toolbar', { name: 'Highlight' }).getByRole('button', { name: 'Yellow' }).click();
  await expect(page.locator('iqra-highlight-layer [data-id]').first()).toBeVisible();
  await page.getByRole('link', { name: 'Back to library' }).click();
  await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
}

async function openSettings(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
}

async function readDownload(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/** File names listed in a zip's central directory. */
function zipNames(zip: Buffer): string[] {
  const names: string[] = [];
  for (let i = 0; i + 46 <= zip.length; i++) {
    if (zip.readUInt32LE(i) !== 0x02014b50) continue;
    const nameLen = zip.readUInt16LE(i + 28);
    names.push(zip.subarray(i + 46, i + 46 + nameLen).toString('utf8'));
    i += 45 + nameLen;
  }
  return names;
}

test('storage shows the Drive and device bars and manage downloads removes a book from this device', async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const page = await openDevice(context);
    await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
    await addSample(page);
    await openSettings(page);

    const storage = page.locator('[data-section="storage"]');
    await expect(storage.getByTestId('drive-summary')).toBeVisible();
    await expect(storage.getByRole('img')).toHaveCount(2);
    await expect(storage.getByTestId('device-legend')).toContainText('Downloads');
    await expect(storage.locator('.val')).not.toContainText(['NaN', 'undefined', '-']);

    await storage.getByTestId('manage-downloads').click();
    await expect(page.getByTestId('dl-title')).toHaveText(['Sample Book']);
    await expect(page.getByTestId('dl-total')).toBeVisible();
    await page.getByTestId('dl-remove').click();
    await expect(page.getByTestId('dl-empty')).toBeVisible();
  } finally {
    await context.close();
  }
});

test('notes export is a zip with one Markdown file per annotated book, and backup is JSON that restores on a fresh device', async ({ browser }) => {
  const contextA = await browser.newContext({ acceptDownloads: true });
  const contextB = await browser.newContext();
  try {
    const a = await openDevice(contextA);
    await expect(a.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
    await addSample(a);
    await addHighlight(a);
    await openSettings(a);
    const data = a.locator('[data-section="data"]');

    const zipDownload = a.waitForEvent('download');
    await data.getByTestId('export-notes').click();
    const zipFile = await zipDownload;
    expect(zipFile.suggestedFilename()).toMatch(/^iqra-notes-\d{4}-\d{2}-\d{2}\.zip$/);
    const zip = await readDownload(zipFile);
    expect(zip.subarray(0, 2).toString('latin1')).toBe('PK');
    const names = zipNames(zip);
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/\.md$/);
    expect(names[0]).toContain('Sample Book');

    const jsonDownload = a.waitForEvent('download');
    await data.getByTestId('backup').click();
    const jsonFile = await jsonDownload;
    expect(jsonFile.suggestedFilename()).toMatch(/^iqra-backup-\d{4}-\d{2}-\d{2}\.json$/);
    const backup = await readDownload(jsonFile);
    const parsed = JSON.parse(backup.toString('utf8')) as { schemaVersion: number; tables: Record<string, unknown[]> };
    expect(parsed.tables['books']).toHaveLength(1);
    expect(parsed.tables['annotations']).toHaveLength(1);

    // A fresh device with nothing in it: restoring brings the book back.
    const b = await openDevice(contextB, '/settings');
    await expect(b.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    const input = b.locator('[data-section="data"]').getByTestId('restore-input');

    // Garbage changes nothing and says so.
    await input.setInputFiles({ name: 'junk.json', mimeType: 'application/json', buffer: Buffer.from('this is not a backup') });
    await expect(b.getByTestId('restore-error')).toBeVisible();
    await expect(b.getByTestId('confirm-restore')).toBeHidden();
    // Valid JSON of the wrong kind is refused too.
    await input.setInputFiles({ name: 'other.json', mimeType: 'application/json', buffer: Buffer.from('{"schemaVersion":99,"tables":{}}') });
    await expect(b.getByTestId('restore-error')).toBeVisible();

    await input.setInputFiles({ name: 'iqra-backup.json', mimeType: 'application/json', buffer: backup });
    await expect(b.getByTestId('restore-counts')).toContainText('1 book');
    // Cancelling restores nothing.
    await b.getByTestId('cancel-restore').click();
    await expect(b.getByTestId('restore-counts')).toBeHidden();

    await input.setInputFiles({ name: 'iqra-backup.json', mimeType: 'application/json', buffer: backup });
    await b.getByTestId('confirm-restore').click();
    await expect(b.locator('.toast')).toBeVisible();
    await b.getByRole('link', { name: 'Back to library' }).click();
    await b.getByRole('tab', { name: /To read/ }).click();
    await expect(bookCard(b)).toBeVisible();
  } finally {
    await contextA.close();
    await contextB.close();
  }
});

test('reading defaults are still set after a reload', async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const page = await openDevice(context, '/settings');
    const group = page.locator('[data-group="weekStartsOn"]');
    await group.getByRole('button', { name: 'Sunday' }).click();
    await expect(group.getByRole('button', { name: 'Sunday' })).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await expect(page.locator('[data-group="weekStartsOn"]').getByRole('button', { name: 'Sunday' })).toHaveAttribute('aria-pressed', 'true');
  } finally {
    await context.close();
  }
});

test('reminders: turning on fills the Iqra calendar for 14 days, changing the time rebuilds, turning off can remove them', async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const page = await openDevice(context, '/settings');
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    const live = () => page.evaluate(() => (window as unknown as E2eCalendar).__iqraCalendar?.live() ?? []);

    await page.getByTestId('reminders-switch').check();
    await expect(page.getByTestId('reminder-time')).toBeVisible();
    await expect.poll(async () => (await live()).length).toBeGreaterThan(5);
    const first = await live();
    expect(first.length).toBeLessThanOrEqual(14);
    expect(first.every((e) => e.title.startsWith('Time to read') && e.startsAt.includes('T21:30'))).toBe(true);
    expect(first.every((e) => e.description.length > 0)).toBe(true);
    const ids = new Set(first.map((e) => e.id));
    expect(ids.size).toBe(first.length);

    await page.getByTestId('reminder-time').fill('06:15');
    await expect.poll(async () => (await live()).every((e) => e.startsAt.includes('T06:15')) && (await live()).length > 5).toBe(true);
    expect((await live()).length).toBe(first.length);

    // Turning off asks whether to remove the upcoming events; yes removes them.
    await page.getByTestId('reminders-switch').click();
    await page.getByTestId('remove-yes').click();
    await expect.poll(async () => (await live()).length).toBe(0);
    await expect(page.getByTestId('reminder-time')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('sign out with "remove data" leaves an empty local database', async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const page = await openDevice(context);
    await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
    await addSample(page);
    await openSettings(page);
    await page.getByTestId('sign-out').click();
    await page.getByTestId('clear-device').check();
    await page.getByTestId('confirm-sign-out').click();
    await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: /To read/ }).click();
    await expect(bookCard(page)).toHaveCount(0);
  } finally {
    await context.close();
  }
});
