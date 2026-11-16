// The content contract (docs/content.md): what a content directory holds and the checks a
// build runs on it before anything is bundled. Shared by the build (Node) and the tests.

export const ROUTE = /^[a-z0-9-]+$/;
export const SHA256 = /^[0-9a-f]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface CatalogEntry {
  /** The story's hash in the address, never changed once published. */
  readonly route: string;
  readonly title: string;
  /** `YYYY-MM-DD`, or `YYYY-<season>` when only the season is known. */
  readonly told: string;
  /** The day it was published, or null for a story only the family build holds. */
  readonly published: string | null;
  /** A drawing key from `src/art.ts`; an unknown key draws the default. */
  readonly art: string;
  /** Seconds of audio, null for a story read as text only. */
  readonly duration: number | null;
  /** The sha256 of the story's m4a, null for a story read as text only. */
  readonly audio: string | null;
}

export interface Catalog {
  readonly stories: readonly CatalogEntry[];
}

export interface Paragraph {
  readonly text: string;
  /** Seconds into the audio; null in a story read as text only. */
  readonly start: number | null;
}

export interface Story {
  readonly title: string;
  readonly paragraphs: readonly Paragraph[];
}

export class ContentError extends Error {
  override name = 'ContentError';
}

type Json = Record<string, unknown>;

function object(value: unknown, where: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ContentError(`${where} is not an object`);
  return value as Json;
}

function text(value: unknown, where: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new ContentError(`${where} is not a non-empty string`);
  return value;
}

function seconds(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new ContentError(`${where} is not a number of seconds`);
  return value;
}

function entry(value: unknown, index: number): CatalogEntry {
  const where = `catalog.stories[${String(index)}]`;
  const raw = object(value, where);
  const route = text(raw.route, `${where}.route`);
  if (!ROUTE.test(route)) throw new ContentError(`${where}.route "${route}" is not ${String(ROUTE)}`);
  const told = text(raw.told, `${where}.told`);
  if (!/^\d{4}-(\d{2}-\d{2}|spring|summer|autumn|winter)$/.test(told)) throw new ContentError(`${where}.told "${told}" is not a date or a season`);
  const published = raw.published ?? null;
  if (published !== null && (typeof published !== 'string' || !DATE.test(published))) {
    throw new ContentError(`${where}.published is neither null nor YYYY-MM-DD`);
  }
  const audio = raw.audio ?? null;
  if (audio !== null && (typeof audio !== 'string' || !SHA256.test(audio))) throw new ContentError(`${where}.audio is neither null nor a sha256`);
  const duration = raw.duration === null || raw.duration === undefined ? null : seconds(raw.duration, `${where}.duration`);
  if ((audio === null) !== (duration === null)) throw new ContentError(`${where} has audio without a duration or a duration without audio`);
  return {
    route,
    title: text(raw.title, `${where}.title`),
    told,
    published,
    art: raw.art === undefined ? 'default' : text(raw.art, `${where}.art`),
    duration,
    audio,
  };
}

/** The catalog, checked: routes valid and unique, each field of the contract's type. */
export function parseCatalog(value: unknown): Catalog {
  const raw = object(value, 'catalog');
  if (!Array.isArray(raw.stories)) throw new ContentError('catalog.stories is not a list');
  const stories = raw.stories.map(entry);
  const seen = new Set<string>();
  for (const { route } of stories) {
    if (seen.has(route)) throw new ContentError(`catalog has the route "${route}" twice`);
    seen.add(route);
  }
  return { stories };
}

/** A story file, checked against its catalog entry: same title, paragraphs present, and
 *  start times exactly when the entry has audio, rising and inside its duration. */
export function parseStory(value: unknown, of: CatalogEntry): Story {
  const where = `stories/${of.route}.json`;
  const raw = object(value, where);
  const title = text(raw.title, `${where}.title`);
  if (title !== of.title) throw new ContentError(`${where}.title "${title}" is not the catalog's "${of.title}"`);
  if (!Array.isArray(raw.paragraphs) || !raw.paragraphs.length) throw new ContentError(`${where} has no paragraphs`);
  let last = -1;
  const paragraphs = raw.paragraphs.map((value, index): Paragraph => {
    const at = `${where}.paragraphs[${String(index)}]`;
    const paragraph = object(value, at);
    const words = text(paragraph.text, `${at}.text`);
    if (of.duration === null) {
      if (paragraph.start !== undefined && paragraph.start !== null) throw new ContentError(`${at} has a start but the story has no audio`);
      return { text: words, start: null };
    }
    const start = seconds(paragraph.start, `${at}.start`);
    if (start <= last || start > of.duration) throw new ContentError(`${at}.start ${String(start)} is not after the one before and within the audio`);
    last = start;
    return { text: words, start };
  });
  return { title, paragraphs };
}

export type BuildName = 'public' | 'family';

/** The stories a build holds: the public one only those marked published. */
export function storiesFor(build: BuildName, catalog: Catalog): readonly CatalogEntry[] {
  return build === 'public' ? catalog.stories.filter((story) => story.published !== null) : catalog.stories;
}
