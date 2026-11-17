// Both builds over the demo stories, checked as khe-sites checked this page, and the public
// build over a catalog with an unpublished story, which must not reach its output.
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOM_IDS } from '@khelias/ui/rooms';
import { viewInitScript } from '@khelias/ui/view';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MARKERS } from '../build/chrome.ts';
import { BUILDS, PAPER } from '../src/builds.ts';
import { COPY } from '../src/copy.ts';

const temporary: string[] = [];
const tempDir = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temporary.push(dir);
  return dir;
};
afterAll(() => {
  for (const dir of temporary) rmSync(dir, { recursive: true, force: true });
});

async function buildInto(name: 'public' | 'family', content = 'demo'): Promise<string> {
  const out = tempDir(`stories-${name}-`);
  process.env.STORIES_BUILD = name;
  process.env.STORIES_CONTENT = content;
  process.env.STORIES_OUT = out;
  try {
    await build({ configFile: 'vite.config.ts', logLevel: 'silent' });
  } finally {
    delete process.env.STORIES_BUILD;
    delete process.env.STORIES_CONTENT;
    delete process.env.STORIES_OUT;
  }
  return out;
}

function files(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;
const COMPOSE = { cast: [{ id: 'siil', name: 'Väljamõeldud siil' }], places: [{ id: 'mets', name: 'Mets' }], kinds: [{ id: 'naljakas', name: 'Naljakas' }] };
const outputs: Record<'public' | 'family', string> = { public: '', family: '' };

beforeAll(async () => {
  outputs.public = await buildInto('public');
  outputs.family = await buildInto('family');
});

describe.each(['public', 'family'] as const)('the %s build', (name) => {
  const html = () => readFileSync(join(outputs[name], 'index.html'), 'utf8');

  it('is committed to the dark theme, in its theme-color and its manifest', () => {
    expect(html()).toContain('data-theme="dark"');
    expect(count(html(), /<meta name="theme-color"/g)).toBe(1);
    expect(html()).toContain(`<meta name="theme-color" content="${PAPER}">`);
    const manifest = JSON.parse(readFileSync(join(outputs[name], 'manifest.webmanifest'), 'utf8')) as Record<string, unknown>;
    expect(manifest.background_color).toBe(PAPER);
    expect(manifest.theme_color).toBe(PAPER);
    const { base } = BUILDS[name];
    expect([manifest.scope, manifest.start_url, manifest.name]).toEqual([base, base, COPY.et.appName]);
  });

  it('has every copy key it uses in both languages', () => {
    const source = html() + readdirSync('src').filter((file) => file.endsWith('.ts')).map((file) => readFileSync(join('src', file), 'utf8')).join('\n');
    const keys = [...source.matchAll(/data-i18n(?:-html|-aria)?="([^"]+)"|dataset\.i18n = '([^']+)'/g)].map((match) => match[1] ?? match[2]);
    expect(keys.length).toBeGreaterThan(10);
    for (const key of keys) {
      expect(Object.keys(COPY.et)).toContain(key);
      expect(Object.keys(COPY.en)).toContain(key);
    }
  });

  it('fills every marker and keeps its room on <html>', () => {
    expect(ROOM_IDS).toContain(/<html\b[^>]*\sdata-room="([^"]*)"/.exec(html())?.[1]);
    for (const marker of MARKERS) expect(html()).not.toContain(`<!-- ${marker} -->`);
  });

  it('credits the voice once, in its footer, with its links', () => {
    expect(count(html(), /TartuNLP XTTS v2/g)).toBe(1);
    const footer = html().slice(html().lastIndexOf('<footer'));
    expect(footer).toContain(COPY.et.credit);
    expect(footer).toContain('data-i18n-html="credit"');
  });

  it('writes its catalog, worker and no source maps', () => {
    expect(existsSync(join(outputs[name], 'catalog.json'))).toBe(true);
    expect(readFileSync(join(outputs[name], 'sw.js'), 'utf8')).toMatch(/unejanku-shell-/);
    expect(files(outputs[name]).filter((file) => file.endsWith('.map'))).toEqual([]);
    expect(files(outputs[name]).filter((file) => file.endsWith('.m4a'))).toEqual([]);
  });
});

describe('the public build', () => {
  const html = () => readFileSync(join(outputs.public, 'index.html'), 'utf8');

  it('has the family header and footer, no theme toggle', () => {
    expect(count(html(), /<header class="site-header[ "]/g)).toBe(1);
    expect(count(html(), /<footer class="site-footer"/g)).toBe(1);
    expect(html()).not.toContain('site-header__theme');
    expect(count(html(), /class="site-footer__home"/g)).toBe(1);
    expect(html()).not.toContain('class="app-header"');
  });

  it('loads the consent banner from the origin root', () => {
    expect(html()).toMatch(/<script\s+defer src="\/assets\/analytics-consent\.js" data-analytics-token="[0-9a-f]+"/);
  });

  it('is a product page: its view script in <head> before the first stylesheet, and the demo line', () => {
    const head = html().slice(0, html().indexOf('</head>'));
    const view = `<script>${viewInitScript(BUILDS.public.base)}</script>`;
    expect(head.split(view)).toHaveLength(2);
    expect(head.indexOf(view)).toBeLessThan(head.search(/<link rel="stylesheet"/));
    expect(html()).toContain('data-khe-product="/stories/"');
    expect(count(html(), /<p class="site-header__demo"/g)).toBe(1);
    expect(html()).toContain('data-khe-room="stories"');
  });

  it('links the family build from the demo line, in the page\'s language (estate ADR-034)', () => {
    expect(count(html(), /class="site-header__demo-link"/g)).toBe(1);
    expect(html()).toMatch(/<a class="site-header__demo-link" href="https:\/\/stories\.khe\.ee\/\?lang=et" data-i18n="headerDemoLink" data-link="family">Perele →<\/a>/);
  });

  it('holds no story the catalog has not published', async () => {
    const content = tempDir('stories-content-');
    cpSync('demo', content, { recursive: true });
    const catalog = JSON.parse(readFileSync(join(content, 'catalog.json'), 'utf8')) as { stories: { route: string; published: string | null; art: string }[] };
    const hidden = catalog.stories[2];
    if (!hidden) throw new Error('the demo catalog has fewer than three stories');
    hidden.published = null;
    writeFileSync(join(content, 'catalog.json'), JSON.stringify(catalog));
    const out = await buildInto('public', content);
    const story = JSON.parse(readFileSync(join(content, 'stories', `${hidden.route}.json`), 'utf8')) as { title: string; paragraphs: { text: string }[] };
    for (const file of files(out).filter((path) => !path.endsWith('.woff2') && !path.endsWith('.png'))) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toContain(hidden.route);
      expect(text, file).not.toContain(story.title);
      expect(text, file).not.toContain(story.paragraphs[0]?.text.slice(0, 40));
    }
    const built = JSON.parse(readFileSync(join(out, 'catalog.json'), 'utf8')) as { stories: unknown[] };
    expect(built.stories).toHaveLength(catalog.stories.length - 1);
    const pictures = files(out).filter((path) => /\.(svg|webp)$/.test(path)).map((path) => readFileSync(path, 'base64'));
    const hiddenArt = readFileSync(join(content, 'art', hidden.art), 'base64');
    expect(pictures).not.toContain(hiddenArt);
    for (const shown of catalog.stories.filter((story) => story !== hidden)) {
      expect(pictures).toContain(readFileSync(join(content, 'art', shown.art), 'base64'));
    }
  });

  it.each([
    ['a missing picture', (content: string) => { rmSync(join(content, 'art', 'siil-otsis-und.svg')); }, /does not exist/],
    ['an unsafe picture', (content: string) => { writeFileSync(join(content, 'art', 'siil-otsis-und.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800"><script>alert(1)</script></svg>'); }, /script/],
    ['a bad picture name', (content: string) => {
      const path = join(content, 'catalog.json');
      writeFileSync(path, readFileSync(path, 'utf8').replace('"siil-otsis-und.svg"', '"../siil.svg"'));
    }, /art/],
    ['a webp of the wrong size', (content: string) => {
      const path = join(content, 'art', 'konn-tahtis-lennata.webp');
      const bytes = readFileSync(path);
      bytes.writeUInt16LE(800, 26);
      writeFileSync(path, bytes);
    }, /800x800/],
    ['a PNG named .webp', (content: string) => { cpSync('public/icon-512.png', join(content, 'art', 'konn-tahtis-lennata.webp')); }, /not a WEBP/],
    ['compose.json, which holds the family\'s names', (content: string) => { writeFileSync(join(content, 'compose.json'), JSON.stringify(COMPOSE)); }, /compose\.json/],
  ])('fails on %s', async (_, spoil, problem) => {
    const content = tempDir('stories-content-');
    cpSync('demo', content, { recursive: true });
    spoil(content);
    await expect(buildInto('public', content)).rejects.toThrow(problem);
  });
});

describe('the family build', () => {
  const html = () => readFileSync(join(outputs.family, 'index.html'), 'utf8');

  it('checks compose.json and fails on a bad one', async () => {
    const content = tempDir('stories-content-');
    cpSync('demo', content, { recursive: true });
    writeFileSync(join(content, 'compose.json'), JSON.stringify(COMPOSE));
    await buildInto('family', content);
    writeFileSync(join(content, 'compose.json'), JSON.stringify({ ...COMPOSE, kinds: [] }));
    await expect(buildInto('family', content)).rejects.toThrow(/compose\.kinds/);
  });

  it('shows the product view only, with no analytics and no indexing', () => {
    expect(html()).toMatch(/<html lang="et" data-khe-view="product"/);
    expect(html()).not.toMatch(/analytics-consent|cloudflareinsights|khe-view:/);
    expect(html()).not.toContain('site-header__rooms');
    expect(html()).not.toContain('site-header__demo');
    expect(html()).not.toContain('stories.khe.ee');
    expect(html()).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(readFileSync(join(outputs.family, 'robots.txt'), 'utf8')).toContain('Disallow: /');
  });

  it('asks for the manifest with the Access cookie', () => {
    expect(html()).toContain('<link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials">');
  });

  it('has its own header and footer, not the family ones (estate ADR-032)', () => {
    expect(html()).not.toMatch(/site-header|site-footer/);
    expect(count(html(), /<header class="app-header"/g)).toBe(1);
    expect(count(html(), /<footer class="app-footer"/g)).toBe(1);
    expect(html()).toMatch(/<button type="button" lang="et" aria-pressed="true" data-lang-option="et">ET<\/button>/);
    expect(html()).toMatch(/<button type="button" lang="en" aria-pressed="false" data-lang-option="en">EN<\/button>/);
  });

  it('links khe.ee by its full address', () => {
    expect(html()).toContain('href="https://khe.ee/privacy?lang=et" data-link="privacy"');
    expect(html()).toContain('href="https://khe.ee/?lang=et" data-link="home"');
  });
});
