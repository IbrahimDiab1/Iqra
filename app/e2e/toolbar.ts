import type { Page } from '@playwright/test';

/**
 * The reader's toolbar hides itself 3 s after the mouse leaves the bottom edge; a mouse near it brings it back.
 * Call this before pressing one of its buttons, so a slow test does not find it away.
 */
export async function showToolbar(page: Page): Promise<void> {
  const view = page.viewportSize()!;
  await page.mouse.move(view.width / 2, view.height - 12);
}
