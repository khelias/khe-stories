import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { BUILDS } from '../src/builds.ts';
import { parseCatalog } from '../src/content.ts';
import { audioCacheName, isShellCache } from '../src/offline-names.ts';
import { E2E_OUT, FAMILY_URL } from './build.ts';
import { saveStory } from './save.ts';

// The worker AGENTS.md tells the operator to deploy, read from there so the two cannot differ.
const KILL_SWITCH = /## Kill-switch[\s\S]*?```js\n([\s\S]*?)```/.exec(readFileSync('AGENTS.md', 'utf8'))?.[1];
if (!KILL_SWITCH) throw new Error('AGENTS.md has no kill-switch worker under "## Kill-switch"');

const catalog = parseCatalog(JSON.parse(readFileSync('demo/catalog.json', 'utf8')));
const story = catalog.stories.find((each) => each.audio !== null);
if (!story) throw new Error('the demo needs a story with audio');

const OTHER_APP_CACHE = 'another-app-shell-1';

// A poll may land while the worker reloads the page.
async function workerState(page: Page) {
  try {
    return await page.evaluate(async () => ({
      caches: await caches.keys(),
      registrations: (await navigator.serviceWorker.getRegistrations()).length,
      controlled: Boolean(navigator.serviceWorker.controller),
    }));
  } catch {
    return null;
  }
}

const withdrawn = { caches: [OTHER_APP_CACHE], registrations: 0, controlled: false };

for (const build of ['public', 'family'] as const) {
  test(`the ${build} build's kill-switch withdraws the worker and a normal build can return`, async ({ page, baseURL }) => {
    const home = `${build === 'family' ? FAMILY_URL : String(baseURL)}${BUILDS[build].base}`;
    const workerFile = join(E2E_OUT[build], 'sw.js');
    const normalWorker = readFileSync(workerFile);

    await page.goto(home);
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await saveStory(page, `${home}#${story.route}`);
    await page.evaluate((name) => caches.open(name), OTHER_APP_CACHE);
    const before = await workerState(page);
    expect(before?.caches.filter(isShellCache)).toHaveLength(1);
    expect(before?.caches).toContain(audioCacheName(build));

    try {
      writeFileSync(workerFile, KILL_SWITCH);
      // The worker reloads the page itself, which would abort a wait for this load.
      await page.reload({ waitUntil: 'commit' });
      await expect.poll(() => workerState(page), { timeout: 15_000 }).toEqual(withdrawn);

      // The page still registers sw.js on each load, so the switch must settle, not loop.
      let navigations = 0;
      page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) navigations += 1; });
      await page.waitForTimeout(2000);
      expect(navigations).toBe(0);

      await page.goto(home);
      await expect(page.locator('.story-card').first()).toBeVisible();
      await expect.poll(() => workerState(page), { timeout: 15_000 }).toEqual(withdrawn);

      writeFileSync(workerFile, normalWorker);
      await page.reload();
      await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
      await expect(page.locator('.story-card').first()).toBeVisible();
    } finally {
      writeFileSync(workerFile, normalWorker);
    }
  });
}
