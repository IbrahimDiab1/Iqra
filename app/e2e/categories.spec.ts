import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';

const SAMPLE = join(__dirname, 'fixtures', 'sample.pdf');

const bar = (page: Page) => page.locator('iqra-category-bar');


async function addCategory(page: Page, name: string): Promise<void> {
  await bar(page).getByTestId('add').click();
  await bar(page).getByTestId('add-input').fill(name);
  await bar(page).getByTestId('add-input').press('Enter');
  await expect(bar(page).locator('.nm', { hasText: name })).toBeVisible();
}

test('the library category bar adds, renames, reorders, deletes with Undo and filters', async ({ page }) => {
  await page.goto('/library');
  await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles([SAMPLE]);
  await page.getByRole('tab', { name: /All/ }).click();
  const card = page.locator('[data-grid="main"] li').filter({ hasText: 'Sample Book' });
  await expect(card).toBeVisible();

  await addCategory(page, 'Fiqh');
  await addCategory(page, 'History');
  const names = bar(page).locator('.nm');
  await expect(names).toHaveText(['Fiqh', 'History']);

  // Put the book in History through its details sheet, then filter by it.
  await card.click({ button: 'right' });
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(bar(page).locator('[data-cat] .ct').nth(1)).toHaveText('1');

  await bar(page).locator('[data-chip]', { hasText: 'Fiqh' }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByText('No books match these filters.')).toBeVisible();
  // Ctrl-click adds History (OR): the book is back.
  await bar(page).locator('[data-chip]', { hasText: 'History' }).click({ modifiers: ['Control'] });
  await expect(card).toBeVisible();
  // The book is in History now, so Uncategorized has no books and its chip is hidden.
  await expect(bar(page).locator('[data-chip="uncategorized"]')).toHaveCount(0);
  await bar(page).locator('[data-chip="all"]').click();
  await expect(card).toBeVisible();

  // Rename in place through the context menu.
  await bar(page).locator('[data-chip]', { hasText: 'Fiqh' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const input = bar(page).getByTestId('rename-input');
  await input.fill('Usul');
  await input.press('Enter');
  await expect(names).toHaveText(['Usul', 'History']);

  // Move right, then delete with Undo.
  await bar(page).locator('[data-chip]', { hasText: 'Usul' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move right' }).click();
  await expect(names).toHaveText(['History', 'Usul']);

  await bar(page).locator('[data-chip]', { hasText: 'History' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(names).toHaveText(['Usul']);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(names).toHaveText(['History', 'Usul']);
  await expect(bar(page).locator('[data-cat] .ct').first()).toHaveText('1');
});

test('the bar scrolls inside itself: no horizontal page scroll at 320 px with long names', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/library');
  await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles([SAMPLE]);
  for (let i = 1; i <= 8; i++) await addCategory(page, `A rather long category name ${i}`);
  const overflow = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    strip: (() => {
      const s = document.querySelector('iqra-category-bar .strip') as HTMLElement;
      return s.scrollWidth > s.clientWidth;
    })(),
  }));
  expect(overflow.page).toBeLessThanOrEqual(0);
  expect(overflow.strip).toBe(true);
});

test('the bar works right to left with an Arabic category and the arrow keys are mirrored', async ({ page }) => {
  await page.goto('/library');
  await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles([SAMPLE]);
  await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
  await addCategory(page, 'الفقه');
  await bar(page).locator('[data-chip="all"]').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(bar(page).locator('[data-chip="uncategorized"]')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(bar(page).locator('[data-chip]').nth(2)).toBeFocused();
  await expect(bar(page).locator('.nm')).toHaveAttribute('dir', 'auto');
});

test('a selected category far along the bar is scrolled into view after a reload', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/library');
  await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles([SAMPLE]);
  for (let i = 1; i <= 8; i++) await addCategory(page, `A rather long category name ${i}`);
  await bar(page).locator('[data-chip]', { hasText: 'category name 7' }).click();
  await page.reload();
  const selected = bar(page).locator('[data-chip][aria-pressed="true"]');
  await expect(selected).toHaveCount(1);
  await expect(selected).toContainText('category name 7');
  const inside = await page.evaluate(() => {
    const strip = document.querySelector('iqra-category-bar .strip')!.getBoundingClientRect();
    const chip = document.querySelector('iqra-category-bar [aria-pressed="true"]')!.getBoundingClientRect();
    return chip.left >= strip.left - 1 && chip.right <= strip.right + 1;
  });
  expect(inside).toBe(true);
  // Visible, so no summary chip is needed.
  await expect(page.locator('[aria-label^="Remove filter"]')).toHaveCount(0);
  // Two selected: one summary chip that clears both.
  await bar(page).locator('[data-chip]', { hasText: 'category name 2' }).click({ modifiers: ['Control'] });
  await page.getByRole('button', { name: 'Remove filter 2 categories' }).click();
  await expect(bar(page).locator('[data-chip="all"]')).toHaveAttribute('aria-pressed', 'true');
});
