import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { checkArt, checkWebp, ContentError, parseCatalog, parseCompose, parseStory, storiesFor, type BuildName, type Catalog, type CatalogEntry, type Compose, type Story } from '../src/content.ts';
import { AUDIO_FILE, AUDIO_PREFIX, shaUnder } from '../src/offline-names.ts';

const VIRTUAL_ID = 'virtual:stories';

interface LoadedStory {
  readonly entry: CatalogEntry;
  readonly story: Story;
  /** The JSON written for the page, byte for byte. */
  readonly json: string;
  /** Where it is served under the base: a hashed asset, so a changed text is a new URL. */
  readonly file: string;
  /** The story's picture, checked, and where it is served; null draws the app's fallback. */
  readonly picture: Picture | null;
}

interface Picture {
  readonly body: Uint8Array;
  readonly type: string;
  readonly file: string;
}

interface Content {
  readonly catalog: Catalog;
  readonly stories: readonly LoadedStory[];
  /** What the compose view offers; null without `compose.json`, which only the family build reads. */
  readonly compose: Compose | null;
}

const hashOf = (source: string | Uint8Array) => createHash('sha256').update(source).digest('hex').slice(0, 10);

function readBytes(path: string): Buffer {
  if (!existsSync(path)) throw new Error(`${path} does not exist`);
  return readFileSync(path);
}

const readText = (path: string) => readBytes(path).toString('utf8');

const PICTURE_TYPES = { svg: 'image/svg+xml', webp: 'image/webp' } as const;

/** A picture the catalog names, checked by its kind; the catalog's check has its extension. */
function readArt(dir: string, name: string): Picture {
  const body = readBytes(join(dir, 'art', name));
  const dot = name.lastIndexOf('.');
  const extension = name.slice(dot + 1) as keyof typeof PICTURE_TYPES;
  if (extension === 'webp') checkWebp(body, `art/${name}`);
  else checkArt(body.toString('utf8'), `art/${name}`);
  return { body, type: PICTURE_TYPES[extension], file: `assets/${name.slice(0, dot)}-${hashOf(body)}.${extension}` };
}

const readJson = (path: string) => JSON.parse(readText(path)) as unknown;

/** Every file the build writes for its stories, by path under the base, with its type. */
const servedFiles = ({ stories }: Content) => new Map<string, { type: string; body: string | Uint8Array }>(stories.flatMap(({ file, json, picture }) => [
  [file, { type: 'application/json', body: json }],
  ...(picture ? [[picture.file, picture] as const] : []),
]));

/** `compose.json` holds the family's names, so the public build fails rather than ship it. */
function readCompose(dir: string, build: BuildName): Compose | null {
  const path = join(dir, 'compose.json');
  if (!existsSync(path)) return null;
  if (build === 'public') throw new ContentError('compose.json is in the content of the public build, which must not hold it');
  return parseCompose(readJson(path));
}

/** A content directory's stories for one build, every file checked. */
function loadContent(dir: string, build: BuildName): Content {
  const compose = readCompose(dir, build);
  const stories = storiesFor(build, parseCatalog(readJson(join(dir, 'catalog.json')))).map((entry) => {
    const story = parseStory(readJson(join(dir, 'stories', `${entry.route}.json`)), entry);
    const json = JSON.stringify(story);
    const picture = entry.art === null ? null : readArt(dir, entry.art);
    return { entry, story, json, file: `assets/${entry.route}-${hashOf(json)}.json`, picture };
  });
  return { catalog: { stories: stories.map(({ entry }) => entry) }, stories, compose };
}

/** Serves `audio/<sha256>.m4a` from the content directory with Range, as nginx does. */
export function serveAudio(dir: string, sha: string, request: IncomingMessage, response: ServerResponse): void {
  const path = join(dir, 'audio', `${sha}.m4a`);
  if (!AUDIO_FILE.test(`${sha}.m4a`) || !existsSync(path)) {
    response.statusCode = 404;
    response.end();
    return;
  }
  const size = statSync(path).size;
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? '');
  response.setHeader('Accept-Ranges', 'bytes');
  response.setHeader('Content-Type', 'audio/mp4');
  if (!range) {
    response.setHeader('Content-Length', String(size));
    createReadStream(path).pipe(response);
    return;
  }
  const [, from = '', to = ''] = range;
  const start = from === '' ? Math.max(0, size - Number(to)) : Number(from);
  const end = from === '' || to === '' ? size - 1 : Math.min(Number(to), size - 1);
  if (start > end || start >= size) {
    response.statusCode = 416;
    response.setHeader('Content-Range', `bytes */${String(size)}`);
    response.end();
    return;
  }
  response.statusCode = 206;
  response.setHeader('Content-Range', `bytes ${String(start)}-${String(end)}/${String(size)}`);
  response.setHeader('Content-Length', String(end - start + 1));
  createReadStream(path, { start, end }).pipe(response);
}

/**
 * The stories of one build as the module `virtual:stories`: each catalog entry with the
 * URL of its story JSON and of its picture, and the compose view's choices or null. The build emits both as hashed assets and `catalog.json`
 * (the build's own catalog, which the deploy, the leak check and the worker read); the dev
 * server serves the same paths, and the audio, from the content directory.
 */
export function contentPlugin(build: BuildName, base: string, contentDir: string): Plugin {
  const dir = resolve(contentDir);
  let content: Content | null = null;
  const load = () => (content ??= loadContent(dir, build));
  return {
    name: 'stories-content',
    buildStart() {
      content = null;
    },
    resolveId: (id) => (id === VIRTUAL_ID ? `\0${VIRTUAL_ID}` : undefined),
    load(id) {
      if (id !== `\0${VIRTUAL_ID}`) return undefined;
      const { stories, compose } = load();
      this.addWatchFile(join(dir, 'catalog.json'));
      if (compose) this.addWatchFile(join(dir, 'compose.json'));
      for (const { entry } of stories) {
        this.addWatchFile(join(dir, 'stories', `${entry.route}.json`));
        if (entry.art !== null) this.addWatchFile(join(dir, 'art', entry.art));
      }
      const list = stories.map(({ entry, file, picture }) => ({ ...entry, data: `${base}${file}`, picture: picture && `${base}${picture.file}` }));
      return `export const BUILD = ${JSON.stringify(build)};\nexport const stories = ${JSON.stringify(list)};\nexport const compose = ${JSON.stringify(compose)};\n`;
    },
    generateBundle() {
      const content = load();
      for (const [fileName, { body }] of servedFiles(content)) this.emitFile({ type: 'asset', fileName, source: body });
      this.emitFile({ type: 'asset', fileName: 'catalog.json', source: `${JSON.stringify(content.catalog, null, 2)}\n` });
    },
    configureServer(server) {
      server.watcher.on('change', (path) => {
        if (path.startsWith(dir)) content = null;
      });
      server.middlewares.use((request, response, next) => {
        const path = new URL(request.url ?? '/', 'http://localhost').pathname;
        const relative = path.startsWith(base) ? path.slice(base.length) : '';
        const sha = shaUnder(relative, AUDIO_PREFIX);
        if (sha) return serveAudio(dir, sha, request, response);
        const found = servedFiles(load()).get(relative);
        if (!found) return next();
        response.setHeader('Content-Type', found.type);
        response.end(found.body);
      });
    },
  };
}
