import { expect, test, type Page, type Route } from '@playwright/test';
import { FAMILY_URL } from './build.ts';

/** STORIES_SHOTS=<dir> saves each step at phone and desktop width, for looking at it. */
async function shoot(page: Page, name: string): Promise<void> {
  const dir = process.env.STORIES_SHOTS;
  if (!dir) return;
  const size = page.viewportSize();
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.screenshot({ path: `${dir}/${name}-${String(width)}.png`, fullPage: true });
  }
  if (size) await page.setViewportSize(size);
}

/** The request service, stood in for: pairing, requests and their list, as the real one answers. */
async function stubApi(page: Page, options: { refuse?: string } = {}) {
  const state = { paired: false, requests: [] as { id: string; state: string; mode: string; kind: string; title: string | null; route: string | null }[], bodies: [] as unknown[] };
  const json = (route: Route, status: number, body?: unknown) =>
    route.fulfill({ status, contentType: 'application/json', body: body === undefined ? '' : JSON.stringify(body) });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const key = `${request.method()} ${path}`;
    if (key === 'GET /api/me') return json(route, 200, state.paired ? { paired: true, child: 'Anni', minutesPerStory: 35 } : { paired: false, children: ['Anni', 'Mia'] });
    if (key === 'POST /api/pair') {
      const { phrase, child } = request.postDataJSON() as { phrase: string; child: string };
      if (phrase !== 'kuu all magab jänes') return json(route, 403, { error: 'phrase' });
      state.paired = true;
      return json(route, 200, { paired: true, child, minutesPerStory: 35 });
    }
    if (key === 'GET /api/requests') return json(route, state.paired ? 200 : 401, { requests: state.requests });
    if (key === 'POST /api/requests') {
      const body = request.postDataJSON() as { mode: string; kind: string };
      state.bodies.push(body);
      if (options.refuse) return json(route, 429, { error: options.refuse });
      state.requests.unshift({ id: 'a1b2c3d4e5f60718', state: 'queued', mode: body.mode, kind: body.kind, title: null, route: null });
      return json(route, 201, { id: 'a1b2c3d4e5f60718', minutes: 35 });
    }
    return json(route, 404, { error: 'route' });
  });
  return state;
}

test('the public build has no compose view', async ({ page }) => {
  await page.goto('/stories/#uus-jutt');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'library');
  await expect(page.locator('.compose, .compose-link')).toHaveCount(0);
});

test('a parent pairs the phone, then the child sends her own story and sees it waiting', async ({ page }) => {
  const state = await stubApi(page);
  await page.goto(`${FAMILY_URL}/`);
  await page.locator('.compose-link').click();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'compose');

  const pair = page.locator('[data-compose-pair]');
  await expect(pair.locator('h2')).toHaveText('Seo see telefon');
  await shoot(page, 'compose-pair');
  await pair.locator('input[name="phrase"]').fill('vale lause');
  await pair.getByText('Anni').click();
  await pair.getByRole('button', { name: 'Seo' }).click();
  await expect(pair.locator('.compose-error')).toHaveText('See ei ole õige salalause.');
  await pair.locator('input[name="phrase"]').fill('kuu all magab jänes');
  await pair.getByRole('button', { name: 'Seo' }).click();

  const form = page.locator('[data-compose-request]');
  await expect(form.locator('h2')).toHaveText('Tere, Anni!');
  await expect(pair).toBeHidden();
  await shoot(page, 'compose-choose');
  await form.getByRole('radio', { name: /Kirjutan ise/ }).click();
  await expect(form.locator('[data-idea]').first()).toBeHidden();
  await form.getByText('Naljakas jutt').click();
  await form.locator('textarea').fill('Konn läks tiigi äärde ja hakkas laulma.');
  await form.getByRole('button', { name: 'Saada' }).click();

  await expect(page.locator('.compose-sent-note')).toHaveText('Jutt valmib umbes 35 minutiga. Teksti saad lugeda juba varem.');
  await expect(page.locator('.compose-recent li')).toHaveText(['Naljakas juttOotab järjekorras']);
  expect(state.bodies).toEqual([{ mode: 'oma', kind: 'naljakas', text: 'Konn läks tiigi äärde ja hakkas laulma.' }]);
  await shoot(page, 'compose-sent');

  await page.locator('.compose [data-story-close]').click();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'library');
  await expect(page.locator('[data-shelf]')).toBeVisible();
});

test('an idea carries its cast, place and kind, and a cap says when to come back', async ({ page }) => {
  const state = await stubApi(page, { refuse: 'day' });
  state.paired = true;
  await page.goto(`${FAMILY_URL}/#uus-jutt`);
  const form = page.locator('[data-compose-request]');
  await form.getByRole('radio', { name: /Räägin idee/ }).click();
  await form.getByText('Konn').click();
  await form.getByText('Siil').click();
  await form.getByText('Tiik').click();
  await form.getByText('Seiklus').click();
  await expect(form.locator('.compose-record')).toHaveText('Räägi idee');
  await form.locator('textarea').fill('Konn ja siil ehitavad parve.');
  await shoot(page, 'compose-idea');
  await form.getByRole('button', { name: 'Saada' }).click();
  await expect(form.locator('.compose-error')).toHaveText('Täna on jutte juba küllalt. Homme saab jälle.');
  expect(state.bodies).toEqual([{ mode: 'idee', kind: 'seiklus', place: 'tiik', cast: ['konn', 'siil'], text: 'Konn ja siil ehitavad parve.' }]);
});

test('a request on the shelf links to its story, with or without its reading', async ({ page }) => {
  const state = await stubApi(page);
  state.paired = true;
  const story = { mode: 'idee', kind: 'seiklus', title: 'Konn tahtis lennata', route: 'konn-tahtis-lennata' };
  state.requests.push(
    { id: 'a1', state: 'committed', mode: 'oma', kind: 'naljakas', title: null, route: null },
    { id: 'a2', state: 'ready', ...story },
    { id: 'a3', state: 'read', ...story },
    { id: 'a4', state: 'silent', ...story },
  );
  await page.goto(`${FAMILY_URL}/#uus-jutt`);
  await expect(page.locator('.compose-recent li')).toHaveText([
    'Naljakas juttKohe riiulil',
    'Konn tahtis lennataRiiulil, ettelugemine tuleb',
    'Konn tahtis lennataRiiulil',
    'Konn tahtis lennataRiiulil, ettelugemiseta',
  ]);
  await expect(page.locator('.compose-recent a')).toHaveCount(3);
  await shoot(page, 'compose-recent');
  await page.locator('.compose-recent a').first().click();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'story');
});
