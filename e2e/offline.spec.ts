import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { parseCatalog } from '../src/content.ts';
import { audioCacheName, isShellCache } from '../src/offline-names.ts';
import { buildE2e } from './build.ts';

const catalog = parseCatalog(JSON.parse(readFileSync('demo/catalog.json', 'utf8')));
const [long, short] = catalog.stories.filter((story) => story.audio !== null);
if (!long || !short) throw new Error('the demo needs two stories with audio');
const longSha = long.audio ?? '';

test.describe.configure({ mode: 'serial' });

/** The page under its service worker, with nothing started. */
async function openControlled(page: Page, path = '/stories/'): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await expect(page.locator('.story-card')).toHaveCount(catalog.stories.length);
}

async function save(page: Page, route: string): Promise<void> {
  await page.goto(`/stories/#${route}`);
  const button = page.locator('[data-save-button]');
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
}

test('the library renders offline after a reload', async ({ page, context }) => {
  await openControlled(page);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.story-card')).toHaveCount(catalog.stories.length);
  await page.goto(`/stories/#${short.route}`);
  await expect(page.locator('[data-story-text] p').first()).toBeVisible();
});

test('a saved story plays offline and seeks to 60 s', async ({ page, context }) => {
  await openControlled(page);
  await save(page, long.route);
  await expect(page.locator(`.story-card[href="#${long.route}"] [data-card-saved]`)).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await expect(page.locator('audio')).toHaveAttribute('src', `/stories/saved/${longSha}.m4a`);
  const state = await page.evaluate(async () => {
    const audio = document.querySelector('audio');
    if (!audio) throw new Error('no audio');
    const ready = () =>
      new Promise<void>((resolve) => {
        const done = () => { if (audio.readyState >= 3) resolve(); };
        audio.addEventListener('canplay', done);
        done();
      });
    audio.muted = true;
    await audio.play();
    await ready();
    audio.currentTime = 60;
    await new Promise((resolve) => audio.addEventListener('seeked', resolve, { once: true }));
    await ready();
    return { readyState: audio.readyState, time: audio.currentTime };
  });
  expect(state.readyState).toBeGreaterThanOrEqual(3);
  expect(state.time).toBeGreaterThanOrEqual(59.5);
});

test('a Range request to a saved story answers 206 with 100 bytes', async ({ page }) => {
  await openControlled(page);
  await save(page, long.route);
  const answer = await page.evaluate(async (sha) => {
    const response = await fetch(`/stories/saved/${sha}.m4a`, { headers: { Range: 'bytes=100-199' } });
    return { status: response.status, range: response.headers.get('content-range'), length: (await response.arrayBuffer()).byteLength };
  }, longSha);
  expect(answer.status).toBe(206);
  expect(answer.length).toBe(100);
  expect(answer.range).toMatch(/^bytes 100-199\/\d+$/);
});

test('unsaved audio does not go through the service worker', async ({ page }) => {
  await openControlled(page);
  const audio = page.waitForResponse((response) => response.url().includes(`/stories/audio/${short.audio ?? ''}.m4a`));
  await page.locator(`.story-card[href="#${short.route}"]`).click();
  expect((await audio).fromServiceWorker()).toBe(false);
});

test('an update without a story removes its text and saved audio', async ({ page }) => {
  await openControlled(page);
  await save(page, long.route);
  const before = await page.evaluate(() => caches.keys());
  const content = mkdtempSync(join(tmpdir(), 'stories-e2e-'));
  cpSync('demo', content, { recursive: true });
  const changed = { stories: catalog.stories.map((story) => (story.route === long.route ? { ...story, published: null } : story)) };
  writeFileSync(join(content, 'catalog.json'), JSON.stringify(changed));
  try {
    buildE2e(content);
    await page.goto('/stories/');
    const oldShell = before.find(isShellCache);
    // A poll may land while the new worker takes over and the page navigates.
    const shells = async () => {
      try {
        return (await page.evaluate(() => caches.keys())).filter(isShellCache);
      } catch {
        return [];
      }
    };
    await expect.poll(shells, { timeout: 15_000 }).toEqual([expect.not.stringMatching(oldShell ?? '')]);
    await page.waitForLoadState();
    expect(await page.evaluate(() => caches.keys())).toContain(audioCacheName('public'));
    const left = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        urls.push(...(await cache.keys()).map((request) => new URL(request.url).pathname));
      }
      return urls;
    });
    expect(left.filter((path) => path.includes(long.route) || path.includes(longSha))).toEqual([]);
    await expect(page.locator('.story-card')).toHaveCount(catalog.stories.length - 1);
  } finally {
    buildE2e('demo');
  }
});
