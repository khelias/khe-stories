import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { parseCatalog } from '../src/content.ts';

const catalog = parseCatalog(JSON.parse(readFileSync('demo/catalog.json', 'utf8')));
const long = catalog.stories.find((story) => (story.duration ?? 0) > 60);
if (!long) throw new Error('the demo needs a story longer than a minute');

test('a story resumes where listening stopped', async ({ page }) => {
  await page.goto(`/stories/#${long.route}`);
  await page.evaluate(async () => {
    const audio = document.querySelector('audio');
    if (!audio) throw new Error('no audio');
    audio.muted = true;
    await audio.play();
    audio.currentTime = 25;
    await new Promise((resolve) => audio.addEventListener('seeked', resolve, { once: true }));
    audio.pause();
  });
  await page.goto('/stories/');
  await expect(page.locator(`.story-card[href="#${long.route}"] [data-card-length]`)).toHaveText(/^Jätka 0:2[5-6]$/);
  await page.goto(`/stories/#${long.route}`);
  await expect.poll(async () => page.evaluate(() => document.querySelector('audio')?.currentTime ?? 0)).toBeGreaterThan(24);
});
