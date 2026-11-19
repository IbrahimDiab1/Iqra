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

/** The page indicator in the header, e.g. "p. 9 / 12". */
function label(page: Page): Locator {
  return page.locator('.r-top .pg');
}

async function expectPage(page: Page, n: number): Promise<void> {
  await expect(label(page)).toContainText(`p. ${n} / 12`);
}

/** Pages forward with the arrow key, one turn at a time (a key pressed during the 220 ms slide is ignored). */
async function readTo(page: Page, from: number, to: number): Promise<void> {
  for (let p = from + 1; p <= to; p++) {
    await page.keyboard.press('ArrowRight');
    await expectPage(page, p);
  }
}

/**
 * Runs a full sync pass. syncNow() shares a pass that is already running (the one at startup, or a debounced
 * one), and that pass may have read Drive or the local database before the caller's latest change, so a second
 * call is what guarantees a pass that started after it.
 */
async function sync(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const engine = (window as unknown as E2eWindow).__iqraSync;
    await engine.syncNow();
    await engine.syncNow();
  });
}

/** Opens the side drawer from the toolbar: Contents & notes, or Search. */
async function openPanel(page: Page, name: 'Contents' | 'Search'): Promise<void> {
  await page.getByRole('button', { name: name === 'Contents' ? 'Contents & notes' : 'Search', exact: true }).click();
  await expect(page.locator('iqra-drawer .panel.open')).toBeVisible();
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

  test('the header and toolbar stay visible when the page is tapped; there is no bottom bar or slider', async () => {
    await openBook(page);
    const box = (await page.locator('main.stage').boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(450);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator('.r-top')).toBeVisible();
    await expect(page.getByRole('toolbar', { name: 'Reader tools' })).toBeVisible();
    await expect(page.locator('.r-bottom, input[type="range"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Contents & notes' })).toBeVisible();
  });

  test('the toolbar is a strip at the right edge, centred, beside the page', async () => {
    await openBook(page);
    const bar = (await page.getByRole('toolbar', { name: 'Reader tools' }).boundingBox())!;
    const stage = (await page.locator('main.stage').boundingBox())!;
    const header = (await page.locator('.r-top').boundingBox())!;
    const view = page.viewportSize()!;
    expect(bar.x + bar.width).toBeCloseTo(view.width, 0);
    expect(stage.x + stage.width).toBeLessThanOrEqual(bar.x + 1);
    expect(stage.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
    expect(stage.y + stage.height).toBeCloseTo(view.height, 0);
    const first = (await page.getByRole('button', { name: 'Contents & notes' }).boundingBox())!;
    const last = (await page.getByRole('button', { name: 'Full screen' }).boundingBox())!;
    const middle = (first.y + last.y + last.height) / 2;
    expect(Math.abs(middle - (header.y + header.height + view.height) / 2)).toBeLessThan(30);
  });

  test('the drawer sits left of the toolbar and below the header, and Escape closes it', async () => {
    await openBook(page);
    await openPanel(page, 'Contents');
    const bar = (await page.getByRole('toolbar', { name: 'Reader tools' }).boundingBox())!;
    const header = (await page.locator('.r-top').boundingBox())!;
    // The panel slides in over 220 ms; measure where it comes to rest.
    await expect
      .poll(async () => {
        const b = (await page.locator('iqra-drawer .panel').boundingBox())!;
        return b.x + b.width <= bar.x + 1;
      })
      .toBe(true);
    const drawer = (await page.locator('iqra-drawer .panel').boundingBox())!;
    expect(drawer.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
    await expect(page.getByRole('button', { name: 'Contents & notes' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('iqra-drawer .panel.open')).toHaveCount(0);
  });

  test('keyboard: B bookmarks, G goes to a page, / opens search, ? lists the shortcuts, R switches the reading mode', async () => {
    await openBook(page);
    await page.keyboard.press('b');
    await expect(page.getByRole('button', { name: 'Remove bookmark' })).toBeVisible();
    await expect(page.locator('.toast')).toContainText('Bookmarked');
    await page.keyboard.press('b');
    await expect(page.getByRole('button', { name: 'Bookmark this page' })).toBeVisible();

    await page.keyboard.press('g');
    const field = page.getByRole('spinbutton', { name: 'Go to page' });
    await expect(field).toBeFocused();
    await field.fill('9');
    await page.keyboard.press('Enter');
    await expectPage(page, 9);
    await page.keyboard.press('Alt+ArrowLeft');
    await expectPage(page, 1);

    await page.keyboard.press('/');
    await expect(page.getByRole('searchbox')).toBeFocused();
    // Typing a shortcut letter into the field types it.
    await page.keyboard.type('bar');
    await expect(page.getByRole('searchbox')).toHaveValue('bar');
    await expect(page.getByRole('button', { name: 'Remove bookmark' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('iqra-drawer .panel.open')).toHaveCount(0);

    await page.keyboard.press('r');
    await expect(page.locator('iqra-reflow-view')).toBeVisible();
    await page.keyboard.press('r');
    await expect(page.locator('iqra-pager')).toBeVisible();

    await page.keyboard.press('?');
    const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(help).toBeVisible();
    await expect(help).toContainText('Bookmark this page');
  });

  test('progress mode: the popover switches to marked mode, Mark page read then works, and the mark survives switching back', async () => {
    await openBook(page);
    const mark = page.locator('button[data-tool="mark"]');
    await expect(mark).toHaveAttribute('aria-disabled', 'true');
    await page.getByRole('button', { name: 'Progress mode' }).click();
    await page.getByRole('menuitemradio', { name: 'Track by marked pages' }).click();
    await expect(page.locator('.toast')).toContainText('Now tracking by marked pages');
    await expect(mark).not.toHaveAttribute('aria-disabled', 'true');
    await mark.click();
    await expect(mark).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: 'Progress mode' }).click();
    await page.getByRole('menuitemradio', { name: 'Track by last page' }).click();
    await expect(mark).toHaveAttribute('aria-disabled', 'true');
    await page.getByRole('button', { name: 'Progress mode' }).click();
    await page.getByRole('menuitemradio', { name: 'Track by marked pages' }).click();
    await expect(mark).toHaveAttribute('aria-pressed', 'true');
  });

  test('hovering an icon button shows its label and shortcut after a short delay', async () => {
    await openBook(page);
    await page.getByRole('button', { name: 'Bookmark this page' }).hover();
    const tip = page.getByRole('tooltip');
    await expect(tip).toBeVisible();
    await expect(tip).toContainText('Bookmark this page');
    await expect(tip).toContainText('B');
    await page.keyboard.press('Escape');
    await expect(tip).toBeHidden();
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
        return Number(/p\.\s*(\d+)\s*\//.exec(text)?.[1] ?? 0);
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

  test('contents: summary badges say Add summary with no text, and writing one fills the badge', async () => {
    await openBook(page);
    await openPanel(page, 'Contents');
    const drawer = page.locator('iqra-drawer');
    await expect(drawer.getByText('+ Summary')).toHaveCount(0);
    await expect(drawer.getByRole('button', { name: 'Write a summary' })).toBeVisible();
    const badges = drawer.getByRole('button', { name: 'Add summary' });
    await expect(badges).toHaveCount(3);
    await badges.nth(1).click();
    const dialog = page.getByRole('dialog', { name: /Summary/ });
    await dialog.getByRole('textbox', { name: 'Summary' }).fill('Second chapter in brief');
    await dialog.getByRole('button', { name: 'Close' }).click();
    await openPanel(page, 'Contents');
    await expect(drawer.getByRole('button', { name: 'Summary written' })).toHaveCount(1);
    await expect(drawer.getByRole('button', { name: 'Add summary' })).toHaveCount(2);
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

/** Selects the whole text of the first span of the current page's text layer, as a long-press or drag would. */
async function selectFirstSpan(page: Page): Promise<void> {
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
}

function selectionToolbar(page: Page): Locator {
  return page.getByRole('toolbar', { name: 'Highlight' });
}

/** Selects the first span and saves it with the given highlight color. */
async function highlightFirstSpan(page: Page, color: 'Yellow' | 'Green' | 'Blue' | 'Pink'): Promise<void> {
  await selectFirstSpan(page);
  await selectionToolbar(page).getByRole('button', { name: color }).click();
  await expect(highlightMarks(page)).not.toHaveCount(0);
}

/** The rects the highlight layer draws, one element per rect. */
function highlightMarks(page: Page): Locator {
  return page.locator('iqra-highlight-layer [data-id]');
}

test.describe('annotations', () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    context = await browser.newContext();
    page = await openDevice(context);
    await openBook(page);
  });

  test.afterEach(async () => {
    await context.close();
  });

  test('text layer: selecting text shows the toolbar', async () => {
    await selectFirstSpan(page);
    const bar = selectionToolbar(page);
    await expect(bar).toBeVisible();
    for (const name of ['Yellow', 'Green', 'Blue', 'Pink', 'Note', 'Copy']) {
      await expect(bar.getByRole('button', { name, exact: true })).toBeVisible();
    }
  });

  test('text layer: dragging the mouse across text selects it', async () => {
    const box = (await page.locator('[data-slot="cur"] .text-layer span[data-item]').first().boundingBox())!;
    await page.mouse.move(box.x + 1, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect(selectionToolbar(page)).toBeVisible();
  });

  test('highlight: picking green saves, survives reload, and is drawn', async () => {
    await highlightFirstSpan(page, 'Green');
    await expect(highlightMarks(page).first()).toHaveAttribute('style', /--hl-green/);

    await page.reload();
    await expectPage(page, 1);
    await expect(highlightMarks(page).first()).toHaveAttribute('style', /--hl-green/);
  });

  test('highlight: Undo from the toast removes it', async () => {
    await highlightFirstSpan(page, 'Yellow');
    await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
    await expect(highlightMarks(page)).toHaveCount(0);
  });

  test('note: tapping a highlight opens the note sheet; typing a note adds the dot and survives reload', async () => {
    await highlightFirstSpan(page, 'Blue');
    await expect(page.locator('iqra-highlight-layer .dot')).toHaveCount(0);

    const box = (await highlightMarks(page).first().boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Note' }).fill('remember the opening');
    // The body saves 400 ms after typing stops; the dot appears once it has.
    await expect(page.locator('iqra-highlight-layer .dot')).toHaveCount(1);

    await page.reload();
    await expectPage(page, 1);
    await expect(page.locator('iqra-highlight-layer .dot')).toHaveCount(1);
  });

  test('area: drag a rectangle, pick a color, it is drawn; Esc cancels the tool', async () => {
    const tool = page.getByRole('button', { name: 'Highlight an area' });
    await tool.click();
    await expect(tool).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await expect(tool).toHaveAttribute('aria-pressed', 'false');

    await tool.click();
    const canvas = (await page.locator('[data-slot="cur"] canvas').boundingBox())!;
    await page.mouse.move(canvas.x + canvas.width * 0.2, canvas.y + canvas.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(canvas.x + canvas.width * 0.6, canvas.y + canvas.height * 0.5, { steps: 6 });
    await page.mouse.up();
    await selectionToolbar(page).getByRole('button', { name: 'Pink' }).click();
    await expect(highlightMarks(page)).toHaveCount(1);
    await expect(highlightMarks(page).first()).toHaveAttribute('style', /--hl-pink/);
  });

  test('bookmark: toggling lists it in the Bookmarks tab and tapping it jumps', async () => {
    await page.getByRole('button', { name: 'Bookmark this page' }).click();
    await expect(page.getByRole('button', { name: 'Remove bookmark' })).toBeVisible();
    await readTo(page, 1, 3);

    await openPanel(page, 'Contents');
    await page.getByRole('tab', { name: 'Bookmarks' }).click();
    const row = page.locator('.row.bm');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('p. 1');
    await row.click();
    await expectPage(page, 1);
  });

  test('reading mode: the saved highlight shows as a mark', async () => {
    await highlightFirstSpan(page, 'Green');
    await page.getByRole('button', { name: 'Reading mode' }).click();
    await expect(page.locator('iqra-reflow-view mark.hl-green')).toHaveCount(1);
  });

  test('notes hub: search finds the note and tapping it opens the book at the page with the flash', async () => {
    await readTo(page, 1, 2);
    await selectFirstSpan(page);
    await selectionToolbar(page).getByRole('button', { name: 'Note', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'Note' }).fill('zebra crossing');
    await expect(page.locator('iqra-highlight-layer .dot')).toHaveCount(1);
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();

    await page.goto('/notes');
    await page.getByRole('searchbox').fill('zebra');
    const row = page.locator('.nrow').filter({ hasText: 'zebra crossing' });
    await expect(row).toHaveCount(1);
    await row.click();
    await expectPage(page, 2);
    await expect(page.locator('iqra-highlight-layer .flash').first()).toBeVisible();
  });

  test('notes hub: after opening at an annotation, a reload or Back keeps the reader\'s own page', async () => {
    await readTo(page, 1, 2);
    await selectFirstSpan(page);
    await selectionToolbar(page).getByRole('button', { name: 'Note', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'Note' }).fill('keep my place');
    await expect(page.locator('iqra-highlight-layer .dot')).toHaveCount(1);
    await dialog.getByRole('button', { name: 'Close' }).click();

    await page.goto('/notes');
    await page.getByRole('searchbox').fill('keep my place');
    await page.locator('.nrow').filter({ hasText: 'keep my place' }).click();
    await expectPage(page, 2);
    // The open-at-annotation parameters are consumed and removed from the address.
    await expect(page).not.toHaveURL(/[?&](page|a)=/);

    // Read on, leave (which saves the place), and come back through history and through a reload.
    await readTo(page, 2, 4);
    await page.getByRole('link', { name: 'Back to library' }).click();
    await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
    await page.goBack();
    await expectPage(page, 4);
    await page.reload();
    await expectPage(page, 4);
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
    await expect(page.locator('.r-top .pg')).toContainText('p. 1 / 5');

    const slot = page.locator('[data-slot="cur"]');
    const canvas = slot.locator('canvas');
    await expect(canvas).toBeVisible();
    const sizes = await slot.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
    expect(sizes.scroll).toBeGreaterThan(sizes.client);

    // The lower edge starts below the fold, and the mouse wheel brings it into view above the window bottom.
    const edgeBefore = (await canvas.boundingBox())!;
    const slotBox = (await slot.boundingBox())!;
    expect(edgeBefore.y + edgeBefore.height).toBeGreaterThan(slotBox.y + slotBox.height);
    await page.mouse.move(slotBox.x + slotBox.width / 2, slotBox.y + slotBox.height / 2);
    await page.mouse.wheel(0, 5000);
    await expect.poll(() => slot.evaluate((el) => el.scrollTop >= el.scrollHeight - el.clientHeight - 1)).toBe(true);
    // The page height is fractional (1813.33 px) and scrollTop is not, so the edge may sit up to a pixel or two low.
    const edge = (await canvas.boundingBox())!;
    expect(edge.y + edge.height).toBeLessThanOrEqual(slotBox.y + slotBox.height + 2);
    expect(edge.y + edge.height).toBeGreaterThan(slotBox.y + slotBox.height - 4);

    // Turning the page puts the new page back at its top.
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.r-top .pg')).toContainText('p. 2 / 5');
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
        return Number(/p\.\s*(\d+)\s*\//.exec(text)?.[1] ?? 0);
      })
      .toBeGreaterThanOrEqual(3);
    const pageEl = page.locator('iqra-scroller .page[data-page="3"]');
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

  test('a jumped-to page and reading-mode text start below the header and end above the window bottom', async () => {
    await openBook(page);
    await useScrolling(page);
    await openPanel(page, 'Contents');
    await page.locator('.row').filter({ hasText: 'Chapter 3' }).click();
    await expectPageLabel(page, 9);
    const topBar = (await page.locator('.r-top').boundingBox())!;
    const barBottom = topBar.y + topBar.height;
    const target = page.locator('iqra-scroller .page[data-page="9"]');
    await expect.poll(async () => (await target.boundingBox())!.y).toBeGreaterThanOrEqual(barBottom - 1);
    await expect.poll(async () => (await target.boundingBox())!.y).toBeLessThan(barBottom + 40);

    await page.getByRole('button', { name: 'Reading mode' }).click();
    const first = page.locator('iqra-reflow-view article p').first();
    await expect(first).toBeVisible();
    await expect.poll(async () => (await first.boundingBox())!.y).toBeGreaterThanOrEqual(barBottom - 1);
    const next = page.locator('iqra-reflow-view .nav.next');
    await next.scrollIntoViewIfNeeded();
    const view = page.viewportSize()!;
    await expect.poll(async () => {
      const b = (await next.boundingBox())!;
      return b.y + b.height <= view.height + 1;
    }).toBe(true);
  });
});

async function expectPageLabel(page: Page, n: number): Promise<void> {
  await expect(page.locator('.r-top .pg')).toContainText(`p. ${n} / 12`);
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
