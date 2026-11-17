// Names and rules the page, the service worker and the servers share.

/** Under the base: an audio file from the network, never handled by the worker. */
export const AUDIO_PREFIX = 'audio/';
/** Under the base: a saved story's audio, answered only by the worker, from the cache. */
export const SAVED_PREFIX = 'saved/';
/** An audio file's name, `<sha256>.m4a`, with the sha captured. */
export const AUDIO_FILE = /^([0-9a-f]{64})\.m4a$/;
/** The compose view's address in the family build, which a failed story's notice opens. */
export const COMPOSE_HASH = '#uus-jutt';

export const audioUrl = (base: string, sha: string) => `${base}${AUDIO_PREFIX}${sha}.m4a`;
export const savedUrl = (base: string, sha: string) => `${base}${SAVED_PREFIX}${sha}.m4a`;

/** The sha of `<prefix><sha256>.m4a`, or null for any other path. */
export function shaUnder(path: string, prefix: string): string | null {
  return path.startsWith(prefix) ? (AUDIO_FILE.exec(path.slice(prefix.length))?.[1] ?? null) : null;
}

const SHELL_PREFIX = 'unejanku-shell-';
/** One cache per build of the shell, so an update replaces it whole. */
export const shellCacheName = (version: string) => `${SHELL_PREFIX}${version}`;
export const isShellCache = (name: string) => name.startsWith(SHELL_PREFIX);
/** Saved audio outlives updates; the worker prunes what a new catalog no longer holds. */
export const audioCacheName = (build: string) => `unejanku-audio-${build}`;

/** Only a plain same-origin answer goes into Cache Storage: no error, no redirect, nothing opaque. */
export const keepable = (response: Response) => response.ok && response.type === 'basic' && !response.redirected;
