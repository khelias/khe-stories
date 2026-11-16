import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { parseCatalog, parseStory, storiesFor, type BuildName, type Catalog, type CatalogEntry, type Story } from '../src/content.ts';
import { AUDIO_FILE, AUDIO_PREFIX, shaUnder } from '../src/offline-names.ts';

const VIRTUAL_ID = 'virtual:stories';

interface LoadedStory {
  readonly entry: CatalogEntry;
  readonly story: Story;
  /** The JSON written for the page, byte for byte. */
  readonly json: string;
  /** Where it is served under the base: a hashed asset, so a changed text is a new URL. */
  readonly file: string;
}

interface Content {
  readonly catalog: Catalog;
  readonly stories: readonly LoadedStory[];
}

function readJson(path: string): unknown {
  if (!existsSync(path)) throw new Error(`${path} does not exist`);
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

/** A content directory's stories for one build, every file checked. */
function loadContent(dir: string, build: BuildName): Content {
  const stories = storiesFor(build, parseCatalog(readJson(join(dir, 'catalog.json')))).map((entry) => {
    const story = parseStory(readJson(join(dir, 'stories', `${entry.route}.json`)), entry);
    const json = JSON.stringify(story);
    const hash = createHash('sha256').update(json).digest('hex').slice(0, 10);
    return { entry, story, json, file: `assets/${entry.route}-${hash}.json` };
  });
  return { catalog: { stories: stories.map(({ entry }) => entry) }, stories };
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
 * URL of its story JSON. The build emits that JSON as hashed assets and `catalog.json`
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
      const { stories } = load();
      this.addWatchFile(join(dir, 'catalog.json'));
      for (const { entry } of stories) this.addWatchFile(join(dir, 'stories', `${entry.route}.json`));
      const list = stories.map(({ entry, file }) => ({ ...entry, data: `${base}${file}` }));
      return `export const BUILD = ${JSON.stringify(build)};\nexport const stories = ${JSON.stringify(list)};\n`;
    },
    generateBundle() {
      const { catalog, stories } = load();
      for (const { file, json } of stories) this.emitFile({ type: 'asset', fileName: file, source: json });
      this.emitFile({ type: 'asset', fileName: 'catalog.json', source: `${JSON.stringify(catalog, null, 2)}\n` });
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
        const found = load().stories.find(({ file }) => file === relative);
        if (!found) return next();
        response.setHeader('Content-Type', 'application/json');
        response.end(found.json);
      });
    },
  };
}
