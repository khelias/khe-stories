// Serves a build as the homelab's nginx will: the build under its base, `audio/` from the
// content directory with Range, `no-cache` on the HTML, the worker and the manifest. For the
// e2e tests and for looking at a build (`npm run preview`). Files are read per request, so a
// build written into the served directory shows on the next load.
//   STORIES_BUILD=public|family  STORIES_ROOT=<build dir>  STORIES_CONTENT=<content dir>  PORT=<port>
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveAudio } from '../build/content.ts';
import { BUILDS, buildName } from '../src/builds.ts';
import { AUDIO_PREFIX, shaUnder } from '../src/offline-names.ts';

const build = buildName(process.env.STORIES_BUILD);
const { base } = BUILDS[build];
const root = resolve(process.env.STORIES_ROOT ?? fileURLToPath(new URL(`../output/${build}`, import.meta.url)));
const content = resolve(process.env.STORIES_CONTENT ?? fileURLToPath(new URL('../demo', import.meta.url)));
const port = Number(process.env.PORT ?? 4173);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain',
};

createServer((request, response) => {
  const notFound = () => {
    response.statusCode = 404;
    response.end();
  };
  let path: string;
  try {
    path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
  } catch {
    return notFound();
  }
  if (!path.startsWith(base)) return notFound();
  const relative = path.slice(base.length);
  const sha = shaUnder(relative, AUDIO_PREFIX);
  if (sha) {
    response.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    serveAudio(content, sha, request, response);
    return;
  }
  let file = normalize(join(root, relative));
  // The SPA fallback never covers the audio paths, as in nginx: a missing file is a 404.
  if (!(file === root || file.startsWith(root + sep)) || /^(audio|saved|cdn-cgi)\//.test(relative)) return notFound();
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
  if (!existsSync(file)) return notFound();
  const type = extname(file);
  response.setHeader('Content-Type', TYPES[type] ?? 'application/octet-stream');
  response.setHeader('Cache-Control', relative.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
  createReadStream(file).pipe(response);
}).listen(port, '127.0.0.1', () => {
  console.log(`serving ${root} at http://127.0.0.1:${String(port)}${base}`);
});
