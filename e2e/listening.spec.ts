import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { parseCatalog } from '../src/content.ts';
import { positionKey } from '../src/resume.ts';
import { SLEEP_KEY } from '../src/sleep.ts';
import { FAMILY_URL } from './build.ts';

const catalog = parseCatalog(JSON.parse(readFileSync('demo/catalog.json', 'utf8')));
const withAudio = catalog.stories.filter((story) => story.audio !== null);
const [first, second] = withAudio;
const textOnly = catalog.stories.find((story) => story.audio === null);
if (!first || !second || !textOnly) throw new Error('the demo needs two stories with audio and one without');

/** Mutes the page's audio so a test can play it. */
async function muted(page: Page): Promise<void> {
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => { const audio = document.querySelector('audio'); if (audio) audio.muted = true; });
  });
}

const playing = (page: Page) => page.evaluate(() => {
  const audio = document.querySelector('audio');
  return { paused: audio?.paused ?? true, time: audio?.currentTime ?? 0 };
});

/** Jumps to a second before the end, so `ended` comes soon. */
async function nearEnd(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const audio = document.querySelector('audio');
    if (!audio) throw new Error('no audio');
    if (!Number.isFinite(audio.duration)) await new Promise((resolve) => audio.addEventListener('loadedmetadata', resolve, { once: true }));
    audio.currentTime = audio.duration - 1;
  });
}

test('playing a story turns its page into the listening view, and pausing keeps it', async ({ page }) => {
  await muted(page);
  await page.goto(`/stories/#${first.route}`);
  await expect(page.locator('body')).not.toHaveAttribute('data-listening');
  await expect(page.locator('.dock')).toBeHidden();
  await page.locator('[data-story-play]').click();
  await expect(page.locator('body')).toHaveAttribute('data-listening', '');
  await expect(page.locator('.dock')).toBeVisible();
  await expect(page.locator('.story-text p.is-current')).toHaveCount(1);
  await page.locator('.dock [data-player-play]').click();
  await expect(page.locator('body')).not.toHaveAttribute('data-playing');
  await expect(page.locator('body')).toHaveAttribute('data-listening', '');
});

test('a story without audio has no player', async ({ page }) => {
  await page.goto(`/stories/#${textOnly.route}`);
  await expect(page.locator('[data-story-text] p').first()).toBeVisible();
  await expect(page.locator('[data-story-play]')).toBeHidden();
  await expect(page.locator('.dock')).toBeHidden();
  await expect(page.locator('[data-story-no-reading]')).toBeVisible();
});

test('the mini player in the library goes back to the story', async ({ page }) => {
  await muted(page);
  await page.goto('/stories/');
  await expect(page.locator('[data-mini]')).toBeHidden();
  await page.locator(`.story-card[href="#${second.route}"]`).click();
  await page.locator('[data-story-play]').click();
  await expect(page.locator('body')).toHaveAttribute('data-playing', '');
  await page.locator('[data-story-close]').click();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'library');
  const mini = page.locator('[data-mini]');
  await expect(mini).toBeVisible();
  await expect(mini.locator('.mini-title')).toHaveText(second.title);
  await mini.locator('[data-mini-link]').click();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'story');
  await expect(page).toHaveURL(new RegExp(`#${second.route}$`));
  await expect(page.locator('body')).toHaveAttribute('data-listening', '');
});

test('with the count at two, the next story plays from its start, and the one after it stops', async ({ page }) => {
  await muted(page);
  await page.addInitScript(({ sleepKey, key }) => {
    localStorage.setItem(sleepKey, JSON.stringify({ count: 2, dim: false }));
    // A stored place in the next story, which a chained start ignores.
    localStorage.setItem(key, JSON.stringify({ t: 12, d: 36.699, at: Date.now() }));
  }, { sleepKey: SLEEP_KEY, key: positionKey(second.route) });
  await page.goto(`/stories/#${first.route}`);
  await page.locator('[data-story-play]').click();
  await expect(page.locator('body')).toHaveAttribute('data-playing', '');
  await nearEnd(page);
  await expect(page).toHaveURL(new RegExp(`#${second.route}$`), { timeout: 10_000 });
  await expect(page.locator('#story-title')).toHaveText(second.title);
  await expect.poll(async () => (await playing(page)).paused).toBe(false);
  expect((await playing(page)).time).toBeLessThan(5);
  await nearEnd(page);
  await expect(page.locator('body')).not.toHaveAttribute('data-playing', { timeout: 10_000 });
  await page.waitForTimeout(500);
  await expect(page.locator('#story-title')).toHaveText(second.title);
  expect((await playing(page)).paused).toBe(true);
});

test('the family build switches its language with its own header buttons', async ({ page }) => {
  await page.goto(`${FAMILY_URL}/`);
  await expect(page.locator('.app-header')).toBeVisible();
  await page.locator('.app-header [data-lang-option="en"]').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('.app-header [data-lang-option="en"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.library-note')).toHaveText('New stories will come here over time.');
  await expect(page.locator('.app-footer [data-link="privacy"]')).toHaveAttribute('href', 'https://khe.ee/privacy?lang=en');
});

test('a ?lang from a link is shown but only a press is stored', async ({ page }) => {
  await page.goto(`${FAMILY_URL}/?lang=en`);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  expect(await page.evaluate(() => localStorage.getItem('app_locale'))).toBeNull();
  await page.locator('.app-header [data-lang-option="et"]').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'et');
  expect(await page.evaluate(() => localStorage.getItem('app_locale'))).toBe('et');
});
