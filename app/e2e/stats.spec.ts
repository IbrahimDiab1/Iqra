import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { join } from 'node:path';
import { showToolbar } from './toolbar';

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
    await showToolbar(page);
    await mark.click();
    await expect(mark).toHaveAttribute('aria-pressed', 'true');
    await readTo(page, 1, 2);
    await showToolbar(page);
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

  test('contents: chapter rings mark the range and "N of M chapters done" follows', async () => {
    await configureBook(page, { mode: 'Pages I mark as read' });
    await openBook(page);
    await showToolbar(page);
    await page.getByRole('button', { name: 'Contents & notes', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('0 of 3 chapters done')).toBeVisible();
    await expect(page.locator('.row')).toHaveCount(3);
    const rings = page.getByRole('button', { name: /^Mark chapter read \(0 % read\)$/ });
    await expect(rings).toHaveCount(3);
    await rings.first().click();
    await expect(page.getByText('1 of 3 chapters done')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Unmark chapter (100 % read)' })).toHaveCount(1);
    await expect(page.getByRole('button', { name: /^Mark chapter read/ })).toHaveCount(2);
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
    await expect(page.getByText('Set a goal to see your progress here.')).toBeVisible();
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

/** Writes records straight into IndexedDB. The page is reloaded afterwards so its live queries read them. */
async function putRaw(page: Page, store: string, records: object[]): Promise<void> {
  await page.evaluate(
    ([name, recs]) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('iqra');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(name as string, 'readwrite');
          for (const rec of recs as object[]) tx.objectStore(name as string).put(rec);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    [store, records] as const,
  );
}

test.describe('stats heat map', () => {
  let context: BrowserContext;
  let page: Page;
  let today: string;

  test.beforeEach(async ({ browser }) => {
    context = await browser.newContext();
    page = await openDevice(context);
    await addBook(page);
    // A category, the book in it, and a reading session today (local time, so the day cell is deterministic).
    const [book] = await table<{ id: string }>(page, 'books');
    const seeded = await page.evaluate((bookId) => {
      const t = new Date();
      const started = new Date(t.getFullYear(), t.getMonth(), t.getDate(), 6, 0).getTime();
      const pad = (n: number) => String(n).padStart(2, '0');
      return {
        day: `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`,
        category: { id: 'cat-e2e', name: 'Fiqh', order: 0, deviceId: 'e2e', updatedAt: Date.now() },
        session: { id: 'sess-e2e', deviceId: 'e2e', updatedAt: Date.now(), bookId, startedAt: started, endedAt: started + 600_000, activeMs: 600_000, pagesRead: [1, 2, 3] },
      };
    }, book.id);
    today = seeded.day;
    await putRaw(page, 'categories', [seeded.category]);
    await putRaw(page, 'sessions', [seeded.session]);
    const [rec] = await table<Record<string, unknown>>(page, 'books');
    await putRaw(page, 'books', [{ ...rec, categoryIds: ['cat-e2e'], status: 'reading' }]);
    await page.reload();
    await page.getByRole('link', { name: 'Stats' }).click();
    await expect(page.locator('[data-ready]')).toBeVisible();
  });

  test.afterEach(async () => {
    await context.close();
  });

  test('month and year show day blocks coloured by category, with a day list on click', async () => {
    await page.getByRole('button', { name: 'Month', exact: true }).click();
    const todayCell = page.locator(`iqra-heatmap button[data-day="${today}"]`);
    await expect(todayCell).toHaveAttribute('data-level', '4');
    await expect(todayCell).toHaveAttribute('aria-label', /3 pages · 10 min · Fiqh$/);
    expect(await todayCell.evaluate((el) => (el as HTMLElement).style.getPropertyValue('--cell'))).toBe('var(--cat-1)');

    await todayCell.click();
    await expect(page.getByTestId('day-detail')).toContainText('Outline Book');
    await expect(page.getByTestId('day-detail')).toContainText('3 pages · 10 min');

    await page.getByRole('button', { name: 'Year', exact: true }).click();
    const year = Number(today.slice(0, 4));
    const days = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86_400_000;
    await expect(page.locator('iqra-heatmap button[data-day]')).toHaveCount(days);
    await expect(page.locator(`iqra-heatmap button[data-day="${today}"]`)).toHaveAttribute('data-level', '4');

    // Filter by the category through the legend, then by a category that has no reading.
    await page.locator('.legend').getByRole('button', { name: 'Uncategorized' }).click();
    await expect(page.locator('.tile[data-total="pages"] .v')).toHaveText('0');
    await expect(page.getByText('Nothing read this year yet.')).toBeVisible();
    await page.locator('.legend').getByRole('button', { name: 'Fiqh' }).click();
    await expect(page.locator('.tile[data-total="pages"] .v')).toHaveText('3');
  });

  test('previous and next step through periods and Today comes back', async () => {
    const label = page.getByTestId('period-label');
    await expect(label).toContainText('This week');
    await expect(page.getByRole('button', { name: 'Next week' })).toBeDisabled();
    await page.getByRole('button', { name: 'Previous week' }).click();
    await expect(label).not.toContainText('This week');
    await expect(page.getByRole('button', { name: 'Next week' })).toBeEnabled();
    await page.getByRole('button', { name: 'Today', exact: true }).click();
    await expect(label).toContainText('This week');
  });

  test('a year stays inside the page at 320 px and scrolls within its own box', async () => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.getByRole('button', { name: 'Year', exact: true }).click();
    await expect(page.locator(`iqra-heatmap button[data-day="${today}"]`)).toBeVisible();
    const box = await page.evaluate(() => {
      const scroll = document.querySelector('iqra-heatmap .scroll') as HTMLElement;
      return {
        page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        scrolls: scroll.scrollWidth > scroll.clientWidth,
      };
    });
    expect(box.page).toBeLessThanOrEqual(0);
    expect(box.scrolls).toBe(true);
    // A current year opens at its latest weeks: today's block is on screen.
    const rect = await page.locator(`iqra-heatmap button[data-day="${today}"]`).boundingBox();
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(320);
    expect(rect!.x).toBeGreaterThanOrEqual(0);
  });

  test('year: the large previous/next-day buttons step the selected day and keep it on screen', async () => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.getByRole('button', { name: 'Year', exact: true }).click();
    await page.locator(`iqra-heatmap button[data-day="${today}"]`).click();
    await expect(page.getByTestId('day-detail')).toBeVisible();
    // The weekday labels stay at the start edge while the year is scrolled to its latest weeks.
    const label = page.locator('iqra-heatmap .wd').nth(1);
    const scroll = page.locator('iqra-heatmap .scroll');
    const labelBox = await label.boundingBox();
    const scrollBox = await scroll.boundingBox();
    expect(labelBox!.x).toBeGreaterThanOrEqual(scrollBox!.x - 1);
    expect(labelBox!.x).toBeLessThan(scrollBox!.x + 40);
    const prev = page.getByTestId('day-prev');
    const box = await prev.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(40);
    expect(box!.height).toBeGreaterThanOrEqual(40);
    await prev.click();
    const selected = page.locator('iqra-heatmap button[aria-pressed="true"]');
    await expect(selected).toHaveCount(1);
    await expect(selected).not.toHaveAttribute('data-day', today);
    const rect = await selected.boundingBox();
    expect(rect!.x).toBeGreaterThanOrEqual(scrollBox!.x);
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(scrollBox!.x + scrollBox!.width);
    if (process.env['SHOTS']) await page.screenshot({ path: process.env['SHOTS'], fullPage: true });
    await page.getByTestId('day-next').click();
    await expect(page.locator(`iqra-heatmap button[data-day="${today}"]`)).toHaveAttribute('aria-pressed', 'true');
    // Today is the last block of the year grid only at year end; it just must not be a dead button elsewhere.
    await expect(page.getByTestId('day-detail')).toContainText('Outline Book');
  });

  test('keyboard: arrows move across blocks and Enter picks a day', async () => {
    await page.getByRole('button', { name: 'Month', exact: true }).click();
    const todayCell = page.locator(`iqra-heatmap button[data-day="${today}"]`);
    await todayCell.focus();
    await page.keyboard.press('Home');
    // Home goes to the first day of the month, which is not the first block in reading order of the DOM rows.
    await expect(page.locator(`iqra-heatmap button[data-day="${today.slice(0, 8)}01"]`)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator(`iqra-heatmap button[data-day="${today.slice(0, 8)}02"]`)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('day-detail')).toBeVisible();
  });
});
