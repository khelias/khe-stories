import { expect, type Page } from '@playwright/test';

export async function saveStory(page: Page, url: string): Promise<void> {
  await page.goto(url);
  const button = page.locator('[data-save-button]');
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
}
