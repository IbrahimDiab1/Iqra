import { expect, test } from '@playwright/test';

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
