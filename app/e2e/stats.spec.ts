import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { join } from 'node:path';

const OUTLINE = join(__dirname, 'fixtures', 'outline.pdf');
const TITLE = 'Outline Book';
const READ_MS = 6_000;

async function openDevice(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.goto('/library');
  await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
  return page;
}

function bookCard(page: Page): Locator {
  return page.locator('[data-grid="main"] li').filter({ hasText: TITLE });
}

async function addBook(page: Page): Promise<void> {
  await page.locator('input[type="file"]').setInputFiles([OUTLINE]);
  await page.getByRole('tab', { name: /To read/ }).click();
  await expect(bookCard(page)).toBeVisible();
}

function label(page: Page): Locator {
  return page.locator('.r-top .pg');
}

async function expectPage(page: Page, n: number): Promise<void> {
  await expect(label(page)).toContainText(`p. ${n} / 12`);
}

async function readTo(page: Page, from: number, to: number): Promise<void> {
  for (let p = from + 1; p <= to; p++) {
    await page.keyboard.press('ArrowRight');
    await expectPage(page, p);
  }
}

async function openBook(page: Page): Promise<void> {
  await bookCard(page).click();
  await expectPage(page, 1);
}

async function backToLibrary(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Back to library' }).click();
  await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
}

/** Reads every live record of one table straight from IndexedDB. */
async function table<T>(page: Page, name: string): Promise<T[]> {
  return page.evaluate(
    (store) =>
      new Promise<unknown[]>((resolve, reject) => {
        const open = indexedDB.open('iqra');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction(store, 'readonly').objectStore(store).getAll();
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            db.close();
            resolve(req.result);
          };
        };
      }),
    name,
  ) as Promise<T[]>;
}

/** Opens the book's details with a right click and sets how its progress is tracked (and optionally its status). */
async function configureBook(page: Page, opts: { mode?: 'Pages I mark as read'; status?: 'Reading' }): Promise<void> {
  await bookCard(page).click({ button: 'right' });
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  if (opts.status) await dialog.getByRole('button', { name: opts.status, exact: true }).click();
  if (opts.mode) await dialog.getByRole('button', { name: opts.mode, exact: true }).click();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
}

interface SessionRec { bookId: string; activeMs: number; pagesRead: number[]; deleted?: boolean }

test.describe('progress and stats', () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    context = await browser.newContext();
    page = await openDevice(context);
    await addBook(page);
  });

  test.afterEach(async () => {
    await context.close();
  });

  test('session: reading a page for 6 s writes a ReadingSession and counts the page', async () => {
    await openBook(page);
    await page.waitForTimeout(READ_MS);
    await backToLibrary(page);
    await expect.poll(async () => (await table<SessionRec>(page, 'sessions')).length).toBe(1);
    const [rec] = await table<SessionRec>(page, 'sessions');
    expect(rec.pagesRead).toEqual([1]);
    expect(rec.activeMs).toBeGreaterThanOrEqual(5_000);
  });

  test('marked mode: Mark read toggles and the library progress changes', async () => {
    await configureBook(page, { mode: 'Pages I mark as read', status: 'Reading' });
    await page.getByRole('tab', { name: /Reading/ }).click();
    await expect(bookCard(page)).toContainText('0%');
    await openBook(page);
    const mark = page.locator('button[data-tool="mark"]');
    await expect(mark).toHaveAttribute('aria-pressed', 'false');
    await mark.click();
    await expect(mark).toHaveAttribute('aria-pressed', 'true');
    await readTo(page, 1, 2);
    await mark.click();
    await expect(mark).toHaveAttribute('aria-pressed', 'true');
    await backToLibrary(page);
    await page.getByRole('tab', { name: /Reading/ }).click();
    // Two of twelve pages: 17 %.
    await expect(bookCard(page)).toContainText('17%');
  });

  test('finish prompt: reaching the last page offers Mark finished and the action sets finished', async () => {
    await openBook(page);
    await readTo(page, 1, 12);
    const action = page.getByRole('button', { name: 'Mark finished', exact: true });
    await expect(action).toBeVisible();
    await action.click();
    await expect
      .poll(async () => (await table<{ status: string; finishedAt?: number }>(page, 'books'))[0]?.status)
      .toBe('finished');
    const [book] = await table<{ finishedAt?: number }>(page, 'books');
    expect(book.finishedAt).toBeGreaterThan(0);
  });

  test('contents: shows chapter bars and "N of M chapters done"', async () => {
    await configureBook(page, { mode: 'Pages I mark as read' });
    await openBook(page);
    await page.getByRole('button', { name: 'Contents & notes', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('0 of 3 chapters done')).toBeVisible();
    await expect(page.locator('.row')).toHaveCount(3);
    await expect(page.getByRole('progressbar', { name: '0%' })).toHaveCount(3);
    await page.getByRole('button', { name: 'Mark read Chapter 1', exact: true }).click();
    await expect(page.getByText('1 of 3 chapters done')).toBeVisible();
    await expect(page.getByRole('progressbar', { name: '100%' })).toHaveCount(1);
  });

  test('book stats tab shows totals after a session', async () => {
    await openBook(page);
    await page.waitForTimeout(READ_MS);
    await backToLibrary(page);
    await expect.poll(async () => (await table<SessionRec>(page, 'sessions')).length).toBe(1);
    await page.getByRole('tab', { name: /All/ }).click();
    await bookCard(page).click({ button: 'right' });
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Stats', exact: true }).click();
    await expect(dialog.locator('.stats[data-ready]')).toBeVisible();
    await expect(dialog.getByText('Pages read')).toBeVisible();
    await expect(dialog.locator('.totals div').filter({ hasText: 'Pages read' }).locator('dd')).toHaveText('1');
    await expect(dialog.locator('.totals div').filter({ hasText: 'Sessions' }).locator('dd')).toHaveText('1');
  });

  test('stats tab: add a weekly pages goal, it shows progress after reading', async () => {
    await page.getByRole('link', { name: 'Stats' }).click();
    await expect(page.getByText('Set a weekly goal to see your progress here.')).toBeVisible();
    await page.getByRole('button', { name: 'Add goal', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Pages read', exact: true }).click();
    await dialog.getByLabel('Pages per week').fill('10');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('.goal')).toHaveCount(1);

    await page.getByRole('link', { name: 'Library' }).click();
    await openBook(page);
    await page.waitForTimeout(READ_MS);
    await backToLibrary(page);
    await expect.poll(async () => (await table<SessionRec>(page, 'sessions')).length).toBe(1);
    await page.getByRole('link', { name: 'Stats' }).click();
    await expect(page.locator('.goal .gl')).toContainText('1 of 10');
    await expect(page.locator('.tile[data-total="pages"] .v')).toHaveText('1');
  });
});
