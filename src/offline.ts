import { AUDIO_FILE, audioCacheName, audioUrl, keepable } from './offline-names.ts';

// The page's side of the offline store (estate ADR-031): which stories are saved, saving and
// removing one, and the worker's registration. Audio reaches Cache Storage only from here,
// on the listener's tap, fetched whole without Range.

export interface OfflineStore {
  /** Whether this browser can save a story at all. */
  readonly available: boolean;
  /** Whether the story's audio is in the cache and the worker can answer for it. */
  readonly playsSaved: (sha: string) => boolean;
  readonly isSaved: (sha: string) => boolean;
  readonly save: (sha: string) => Promise<void>;
  readonly remove: (sha: string) => Promise<void>;
  /** Called on the first play: from then on a new worker waits until the page closes. */
  readonly hold: () => void;
}

export async function startOffline(base: string, build: string): Promise<OfflineStore> {
  const saved = new Set<string>();
  const cacheName = audioCacheName(build);
  let available = typeof caches !== 'undefined' && 'serviceWorker' in navigator;
  let held = false;
  if (available) {
    try {
      const cache = await caches.open(cacheName);
      for (const request of await cache.keys()) {
        const sha = AUDIO_FILE.exec(new URL(request.url).pathname.split('/').pop() ?? '')?.[1];
        if (sha) saved.add(sha);
      }
    } catch {
      // No Cache Storage (a private window, say): nothing is saved and nothing can be.
      available = false;
    }
    if (available && import.meta.env.PROD) register(base, () => held);
  }
  return {
    available,
    isSaved: (sha) => saved.has(sha),
    playsSaved: (sha) => saved.has(sha) && Boolean(navigator.serviceWorker?.controller),
    async save(sha) {
      const url = audioUrl(base, sha);
      const response = await fetch(url, { credentials: 'include', redirect: 'error' });
      if (!keepable(response) || response.status !== 200) throw new Error(`${url} answered ${String(response.status)}`);
      const cache = await caches.open(cacheName);
      await cache.put(url, response);
      saved.add(sha);
      if (build === 'family') void navigator.storage?.persist?.();
    },
    async remove(sha) {
      const cache = await caches.open(cacheName);
      await cache.delete(audioUrl(base, sha));
      saved.delete(sha);
    },
    hold: () => { held = true; },
  };
}

// A new worker takes over at once while this page has played nothing, and otherwise waits
// until the page closes. The page needs no reload under it: navigations are network first,
// the texts are fetched at start, and saved audio keeps its cache across versions.
function register(base: string, held: () => boolean): void {
  const takeOver = (worker: ServiceWorker | null) => {
    if (worker && !held()) worker.postMessage({ type: 'skip-waiting' });
  };
  navigator.serviceWorker
    .register(`${base}sw.js`, { scope: base })
    .then((registration) => {
      takeOver(registration.waiting);
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) takeOver(worker);
        });
      });
    })
    .catch(() => {
      // No worker: the app still works online.
    });
}
