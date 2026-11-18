import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { join } from 'node:path';

const OUTLINE = join(__dirname, 'fixtures', 'outline.pdf');
const SAMPLE = join(__dirname, 'fixtures', 'sample.pdf');
const TITLE = 'Outline Book';

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

function bookCard(page: Page): Locator {
  return page.locator('[data-grid="main"] li').filter({ hasText: TITLE });
}

async function addBook(page: Page): Promise<void> {
  await page.locator('input[type="file"]').setInputFiles([OUTLINE]);
  await page.getByRole('tab', { name: /To read/ }).click();
  await expect(bookCard(page)).toBeVisible();
}

/** Adds the outline book and opens it at page 1. */
async function openBook(page: Page): Promise<void> {
  await addBook(page);
  await bookCard(page).click();
  await expectPage(page, 1);
}

/** The page label in the bottom bar, e.g. "9 of 12". */
function label(page: Page): Locator {
  return page.locator('.r-bottom .pg');
}

async function expectPage(page: Page, n: number): Promise<void> {
  await expect(label(page)).toContainText(`${n} of 12`);
}

/** Pages forward with the arrow key, one turn at a time (a key pressed during the 220 ms slide is ignored). */
async function readTo(page: Page, from: number, to: number): Promise<void> {
  for (let p = from + 1; p <= to; p++) {
    await page.keyboard.press('ArrowRight');
    await expectPage(page, p);
  }
}

async function sync(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as E2eWindow).__iqraSync.syncNow());
}

async function openPanel(page: Page, name: 'Contents' | 'Search'): Promise<void> {
  await page.getByRole('button', { name, exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

test.describe('reader', () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    context = await browser.newContext();
    page = await openDevice(context);
  });

  test.afterEach(async () => {
    await context.close();
  });

  test('opens and paints the page', async () => {
    await openBook(page);
    await expect(page.locator('.r-top .chapter')).toContainText('Chapter 1');
    // Text on a mostly empty page covers well under 1 % of the canvas, so compare against the paper colour instead.
    await expect
      .poll(() =>
        page.locator('canvas').evaluateAll((canvases) =>
          Math.max(
            0,
            ...(canvases as HTMLCanvasElement[]).map((c) => {
              const ctx = c.getContext('2d');
              if (!ctx || c.width === 0) return 0;
              const d = ctx.getImageData(0, 0, c.width, c.height).data;
              const [r, g, b] = [d[0], d[1], d[2]];
              let inked = 0;
              for (let i = 0; i < d.length; i += 4) {
                if (Math.abs(d[i] - r) + Math.abs(d[i + 1] - g) + Math.abs(d[i + 2] - b) > 60) inked++;
              }
              return inked / (d.length / 4);
            }),
          ),
        ),
      )
      .toBeGreaterThan(0.001);
  });

  test('turns pages with the keyboard and a mouse swipe', async () => {
    await openBook(page);
    await page.keyboard.press('ArrowRight');
    await expectPage(page, 2);
    await page.keyboard.press('ArrowLeft');
    await expectPage(page, 1);

    // Dragging left more than a quarter of the width commits the next page.
    const box = (await page.locator('main.stage').boundingBox())!;
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.8, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.4, y, { steps: 8 });
    await page.mouse.up();
    await expectPage(page, 2);
  });

  test('tapping the page hides and shows the bars, which are not keyboard reachable while hidden', async () => {
    await openBook(page);
    const top = page.locator('.r-top');
    const box = (await page.locator('main.stage').boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(top).toHaveAttribute('inert', '');
    await expect(page.locator('.r-bottom')).toHaveAttribute('inert', '');
    // A second tap within 350 ms counts as a double tap and is ignored.
    await page.waitForTimeout(450);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(top).not.toHaveAttribute('inert', '');
    await expect(page.getByRole('button', { name: 'Contents', exact: true })).toBeVisible();
  });

  test('scrolling mode updates the page label while scrolling', async () => {
    await openBook(page);
    await page.getByRole('button', { name: 'Reading settings' }).click();
    await page.getByRole('radio', { name: 'Scrolling' }).click();
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.locator('iqra-scroller')).toBeVisible();

    const box = (await page.locator('main.stage').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect
      .poll(async () => {
        await page.mouse.wheel(0, 2500);
        const text = (await label(page).textContent()) ?? '';
        return Number(/^\s*(\d+) of/.exec(text)?.[1] ?? 0);
      }, { intervals: [150] })
      .toBeGreaterThan(5);
  });

  test('contents jump records history: Back and Alt+ArrowRight', async () => {
    await openBook(page);
    await openPanel(page, 'Contents');
    // The real PDF outline: three chapters.
    const rows = page.locator('.row');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('Chapter 1');
    await rows.filter({ hasText: 'Chapter 3' }).click();
    await expectPage(page, 9);

    const back = page.getByRole('button', { name: 'Back', exact: true });
    await expect(back).toBeEnabled();
    await back.click();
    await expectPage(page, 1);
    await page.keyboard.press('Alt+ArrowRight');
    await expectPage(page, 9);
  });

  test('search finds a page and tapping the hit jumps there', async () => {
    await openBook(page);
    await openPanel(page, 'Search');
    await page.getByRole('searchbox').fill('page 9');
    const hit = page.locator('.hit').filter({ hasText: 'p. 9' });
    await expect(hit).toHaveCount(1);
    await hit.click();
    await expectPage(page, 9);
  });

  test('reading mode shows the text and toggles back to the page', async () => {
    await openBook(page);
    await openPanel(page, 'Contents');
    await page.locator('.row').filter({ hasText: 'Chapter 3' }).click();
    await expectPage(page, 9);

    await page.getByRole('button', { name: 'Reading mode' }).click();
    await expect(page.locator('iqra-reflow-view p').filter({ hasText: 'Chapter 3, page 9' })).toBeVisible();
    await page.getByRole('button', { name: 'Page view' }).click();
    await expect(page.locator('iqra-pager')).toBeVisible();
    await expectPage(page, 9);
  });

  test('the page survives a reload', async () => {
    await openBook(page);
    await readTo(page, 1, 7);
    // Saved 800 ms after the last change.
    await page.waitForTimeout(1200);

    await page.reload();
    await expectPage(page, 7);

    // Leaving and reopening lands in the same place.
    await page.getByRole('link', { name: 'Back to library' }).click();
    await page.getByRole('tab', { name: /Reading/ }).click();
    await bookCard(page).click();
    await expectPage(page, 7);
  });

  test('a book whose stored file is not a PDF shows the error with Retry and Back', async () => {
    await addBook(page);
    // Replace the stored blob with junk, as a damaged download would be.
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const open = indexedDB.open('iqra');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction('pdfFiles', 'readwrite');
            const store = tx.objectStore('pdfFiles');
            const cursor = store.openCursor();
            cursor.onsuccess = () => {
              const c = cursor.result;
              if (!c) return;
              c.update({ ...c.value, blob: new Blob(['not a pdf']) });
            };
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
        }),
    );
    await bookCard(page).click();
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('This book couldn’t be opened.');
    await expect(alert.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(alert.getByRole('link', { name: 'Back to library' })).toBeVisible();
    await alert.getByRole('link', { name: 'Back to library' }).click();
    await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
  });
});

async function useScrolling(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Reading settings' }).click();
  await page.getByRole('radio', { name: 'Scrolling' }).click();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('iqra-scroller')).toBeVisible();
}

test.describe('reader geometry', () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    context = await browser.newContext({ viewport: { width: 1280, height: 600 } });
    page = await openDevice(context);
  });

  test.afterEach(async () => {
    await context.close();
  });

  test('swipe mode: a page taller than the window scrolls so its bottom is reachable', async () => {
    await page.locator('input[type="file"]').setInputFiles([SAMPLE]);
    await page.getByRole('tab', { name: /To read/ }).click();
    await page.locator('[data-grid="main"] li').filter({ hasText: 'Sample Book' }).click();
    await expect(page.locator('.r-bottom .pg')).toContainText('1 of 5');

    const slot = page.locator('[data-slot="cur"]');
    const canvas = slot.locator('canvas');
    await expect(canvas).toBeVisible();
    const sizes = await slot.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
    expect(sizes.scroll).toBeGreaterThan(sizes.client);

    // The lower edge starts below the fold, and the mouse wheel brings it into view above the bottom bar.
    const edgeBefore = (await canvas.boundingBox())!;
    const slotBox = (await slot.boundingBox())!;
    expect(edgeBefore.y + edgeBefore.height).toBeGreaterThan(slotBox.y + slotBox.height);
    await page.mouse.move(slotBox.x + slotBox.width / 2, slotBox.y + slotBox.height / 2);
    await page.mouse.wheel(0, 5000);
    const bottomBar = (await page.locator('.r-bottom').boundingBox())!;
    await expect
      .poll(async () => {
        const b = (await canvas.boundingBox())!;
        return b.y + b.height <= bottomBar.y + 1;
      })
      .toBe(true);

    // Turning the page puts the new page back at its top.
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.r-bottom .pg')).toContainText('2 of 5');
    await expect.poll(() => page.locator('[data-slot="cur"]').evaluate((el) => el.scrollTop)).toBe(0);
  });

  test('scroll mode: the place survives reopening without drifting', async () => {
    await openBook(page);
    await useScrolling(page);
    const viewport = page.locator('iqra-scroller .viewport');
    const box = (await viewport.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    // Page 3 starts near 2 x (page height + gap); scroll into the middle of it.
    await expect
      .poll(async () => {
        await page.mouse.wheel(0, 700);
        const text = (await label(page).textContent()) ?? '';
        return Number(/^\s*(\d+) of/.exec(text)?.[1] ?? 0);
      })
      .toBeGreaterThanOrEqual(3);
    const pageEl = page.locator('iqra-scroller [data-page="3"]');
    const h = (await pageEl.boundingBox())!.height;
    for (let i = 0; i < 20; i++) {
      const b = (await pageEl.boundingBox())!;
      const middle = b.y + h / 2;
      const line = (await page.locator('.r-top').boundingBox())!;
      const delta = line.y + line.height - middle;
      if (Math.abs(delta) < 40) break;
      await page.mouse.wheel(0, -delta);
      await page.waitForTimeout(60);
    }
    await expectPageLabel(page, 3);
    await page.waitForTimeout(1300);
    const before = await viewport.evaluate((el) => el.scrollTop);

    for (let round = 0; round < 2; round++) {
      await page.reload();
      await expectPageLabel(page, 3);
      await expect
        .poll(() => viewport.evaluate((el) => el.scrollTop), { message: `round ${round}` })
        .toBeGreaterThan(before - 2);
      const after = await viewport.evaluate((el) => el.scrollTop);
      expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
      // Give the position time to be saved again from the restored place.
      await page.waitForTimeout(1300);
    }
  });

  test('scroll mode: reopening without moving does not stamp a newer position', async () => {
    await openBook(page);
    await useScrolling(page);
    const box = (await page.locator('iqra-scroller .viewport').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(1500);
    const stamp = () =>
      page.evaluate(
        () =>
          new Promise<number[]>((resolve) => {
            const open = indexedDB.open('iqra');
            open.onsuccess = () => {
              const all = open.result.transaction('positions').objectStore('positions').getAll();
              all.onsuccess = () => resolve((all.result as { updatedAt: number }[]).map((p) => p.updatedAt));
            };
          }),
      );
    const before = await stamp();
    expect(before).toHaveLength(1);
    await page.reload();
    await expect(page.locator('iqra-scroller')).toBeVisible();
    await page.waitForTimeout(1800);
    expect(await stamp()).toEqual(before);
    // A real scroll does write.
    const box2 = (await page.locator('iqra-scroller .viewport').boundingBox())!;
    await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
    await page.mouse.wheel(0, 900);
    await expect.poll(async () => (await stamp())[0], { timeout: 5000 }).toBeGreaterThan(before[0]);
  });

  test('with the bars shown, a jumped-to page and reading-mode text start below the top bar', async () => {
    await openBook(page);
    await useScrolling(page);
    await openPanel(page, 'Contents');
    await page.locator('.row').filter({ hasText: 'Chapter 3' }).click();
    await expectPageLabel(page, 9);
    const topBar = (await page.locator('.r-top').boundingBox())!;
    const barBottom = topBar.y + topBar.height;
    const target = page.locator('iqra-scroller [data-page="9"]');
    await expect.poll(async () => (await target.boundingBox())!.y).toBeGreaterThanOrEqual(barBottom - 1);
    await expect.poll(async () => (await target.boundingBox())!.y).toBeLessThan(barBottom + 40);

    await page.getByRole('button', { name: 'Reading mode' }).click();
    const first = page.locator('iqra-reflow-view article p').first();
    await expect(first).toBeVisible();
    await expect.poll(async () => (await first.boundingBox())!.y).toBeGreaterThanOrEqual(barBottom - 1);
    const next = page.locator('iqra-reflow-view .nav.next');
    await next.scrollIntoViewIfNeeded();
    const bottomBar = (await page.locator('.r-bottom').boundingBox())!;
    await expect.poll(async () => {
      const b = (await next.boundingBox())!;
      return b.y + b.height <= bottomBar.y + 1;
    }).toBe(true);
  });
});

async function expectPageLabel(page: Page, n: number): Promise<void> {
  await expect(page.locator('.r-bottom .pg')).toContainText(`${n} of 12`);
}

test('two devices: the newest position wins and Back returns to the older one', async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  try {
    const a = await openDevice(contextA);
    const b = await openDevice(contextB);

    // Device A adds the book and publishes it.
    await addBook(a);
    await sync(a);
    const afterAdd = await a.evaluate(() => (window as unknown as E2eWindow).__iqraDrive.exportState());

    // Device B pulls it, downloads it and reads to page 2.
    await b.evaluate((s) => (window as unknown as E2eWindow).__iqraDrive.importState(s), afterAdd);
    await sync(b);
    await b.getByRole('tab', { name: /To read/ }).click();
    await bookCard(b).click();
    await b.getByRole('button', { name: 'Download to this device' }).click();
    await expectPage(b, 1);
    await b.keyboard.press('ArrowRight');
    await expectPage(b, 2);
    await b.waitForTimeout(1200);
    await b.getByRole('link', { name: 'Back to library' }).click();
    await sync(b);
    const bState = await b.evaluate(() => (window as unknown as E2eWindow).__iqraDrive.exportState());

    // Device A learns B's position, then reads on to page 10 and publishes.
    await a.evaluate((s) => (window as unknown as E2eWindow).__iqraDrive.importState(s), bState);
    await sync(a);
    // B's reading moved the book to the Reading shelf.
    await a.getByRole('tab', { name: /Reading/ }).click();
    await bookCard(a).click();
    // A has no position of its own yet, so it opens where B stopped.
    await expectPage(a, 2);
    await readTo(a, 2, 10);
    await a.waitForTimeout(1200);
    await a.getByRole('link', { name: 'Back to library' }).click();
    await sync(a);
    const aState = await a.evaluate(() => (window as unknown as E2eWindow).__iqraDrive.exportState());

    // Device B takes A's state and opens the book: it lands on page 10 and offers the way back.
    await b.evaluate((s) => (window as unknown as E2eWindow).__iqraDrive.importState(s), aState);
    await sync(b);
    await b.getByRole('tab', { name: /Reading/ }).click();
    await bookCard(b).click();
    await expectPage(b, 10);
    const toast = b.locator('.toast');
    await expect(toast).toContainText('Synced from your other device · Back to p. 2');
    await toast.getByRole('button', { name: 'Back', exact: true }).click();
    await expectPage(b, 2);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
