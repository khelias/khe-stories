import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { parseCatalog } from '../src/content.ts';
import { FAMILY_URL } from './build.ts';

const catalog = parseCatalog(JSON.parse(readFileSync('demo/catalog.json', 'utf8')));
const own = catalog.stories.find((story) => story.author !== null);
if (!own?.author) throw new Error('the demo needs a story with an author');

test('a child\'s story is on its own shelf, below the family\'s, named by its author', async ({ page }) => {
  await page.goto(`${FAMILY_URL}/`);
  const shelf = page.locator('[data-shelf]');
  await expect(shelf).toBeVisible();
  await expect(shelf.locator('h2')).toHaveText('Meie enda jutud');
  const card = shelf.locator(`a[href="#${own.route}"]`);
  await expect(card.locator('.story-card-author')).toHaveText(`Mõtles välja ${own.author}`);
  await expect(card.locator('img')).toHaveAttribute('src', /\.webp$/);
  await expect(page.locator(`[data-cards] a[href="#${own.route}"]`)).toHaveCount(0);
  await expect(page.locator('[data-cards] .story-card-author:visible')).toHaveCount(0);
  await page.locator('.app-header [data-lang-option="en"]').click();
  await expect(shelf.locator('h2')).toHaveText('Our own stories');
  await expect(card.locator('.story-card-author')).toHaveText(`Made up by ${own.author}`);
  await card.click();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'story');
  await expect(page.locator('[data-story-picture] img')).toHaveAttribute('src', /\.webp$/);
});
