/// <reference lib="webworker" />
// The service worker (estate ADR-031): the shell and the story texts offline, and the audio of
// a story the listener saved. It decides by URL alone, because a cold worker cannot ask the
// cache before it has to answer: unsaved audio (`audio/`) and Cloudflare's own paths
// (`/cdn-cgi/`) are never handled, so they go to the network as if there were no worker.
// build/sw.ts compiles this file once per build with the constants below filled in.
import { createPartialResponse } from 'workbox-range-requests';
import { AUDIO_PREFIX, SAVED_PREFIX, audioCacheName, audioUrl, isShellCache, keepable, shaUnder, shellCacheName } from './offline-names.ts';

declare const self: ServiceWorkerGlobalScope;
declare const __SW_VERSION__: string;
declare const __SW_BASE__: string;
declare const __SW_BUILD__: 'public' | 'family';
declare const __SW_PRECACHE__: readonly string[];
declare const __SW_AUDIO__: readonly string[];

const BASE = __SW_BASE__;
const SHELL = shellCacheName(__SW_VERSION__);
const AUDIO = audioCacheName(__SW_BUILD__);
const PRECACHE = new Set(__SW_PRECACHE__);
const NAVIGATION_TIMEOUT_MS = 3000;

// Hashed assets never change under their name, so the HTTP cache may answer them; the rest
// is asked of the server.
async function precache(): Promise<void> {
  const cache = await caches.open(SHELL);
  await Promise.all(
    [...PRECACHE].map(async (path) => {
      const url = BASE + path;
      const mode: RequestCache = path.startsWith('assets/') ? 'default' : 'reload';
      const response = await fetch(url, { cache: mode, credentials: 'include', redirect: 'manual' });
      if (!keepable(response)) throw new Error(`precache: ${url} answered ${String(response.status)} ${response.type}`);
      await cache.put(url, response);
    }),
  );
}

async function prune(): Promise<void> {
  for (const name of await caches.keys()) {
    if (isShellCache(name) && name !== SHELL) await caches.delete(name);
  }
  const keep = new Set(__SW_AUDIO__.map((sha) => audioUrl(BASE, sha)));
  const audio = await caches.open(AUDIO);
  for (const request of await audio.keys()) {
    if (!keep.has(new URL(request.url).pathname)) await audio.delete(request);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(prune().then(() => self.clients.claim()));
});

self.addEventListener('message', (event) => {
  if ((event.data as { type?: unknown } | null)?.type === 'skip-waiting') void self.skipWaiting();
});

// Network first, so a deploy shows at once. A redirect away, such as an expired Cloudflare
// Access session, is answered as it came, so the browser follows it at the top level.
async function navigate(request: Request): Promise<Response> {
  const network = fetch(request);
  const cache = await caches.open(SHELL);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { reject(new Error('timeout')); }, NAVIGATION_TIMEOUT_MS);
  });
  try {
    const response = await Promise.race([network, timeout]);
    if (response.type === 'opaqueredirect') return response;
    if (keepable(response)) {
      await cache.put(BASE, response.clone());
      return response;
    }
    return (await cache.match(BASE)) ?? response;
  } catch {
    return (await cache.match(BASE)) ?? network;
  } finally {
    clearTimeout(timer);
  }
}

async function shell(request: Request, url: string): Promise<Response> {
  return (await caches.match(url, { cacheName: SHELL })) ?? fetch(request);
}

// A saved story's audio from the cache, with Range answered by slicing the stored response
// (iOS asks for `bytes=0-1` first, then ranges throughout). Not saved: the network copy.
async function saved(request: Request, sha: string): Promise<Response> {
  const url = audioUrl(BASE, sha);
  const cached = await caches.match(url, { cacheName: AUDIO });
  if (!cached) {
    const range = request.headers.get('range');
    return fetch(url, range ? { headers: { range } } : {});
  }
  return request.headers.has('range') ? createPartialResponse(request, cached) : cached;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return;
  const path = url.pathname.slice(BASE.length);
  if (path.startsWith('cdn-cgi/') || path.startsWith(AUDIO_PREFIX)) return;
  const savedSha = shaUnder(path, SAVED_PREFIX);
  if (savedSha) {
    event.respondWith(saved(request, savedSha));
  } else if (request.mode === 'navigate') {
    if (path === '' || path === 'index.html') event.respondWith(navigate(request));
  } else if (PRECACHE.has(path)) {
    event.respondWith(shell(request, url.pathname));
  }
});
