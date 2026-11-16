// The content contract (docs/content.md): what a content directory holds and the checks a
// build runs on it before anything is bundled. Shared by the build (Node) and the tests.

export const ROUTE = /^[a-z0-9-]+$/;
export const SHA256 = /^[0-9a-f]{64}$/;
/** A story picture's file name under `<content>/art/`. */
const ART_FILE = /^[a-z0-9-]+\.svg$/;
/** The largest picture the build ships, in bytes. */
export const ART_MAX_BYTES = 200 * 1024;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface CatalogEntry {
  /** The story's hash in the address, never changed once published. */
  readonly route: string;
  readonly title: string;
  /** `YYYY-MM-DD`, or `YYYY-<season>` when only the season is known. */
  readonly told: string;
  /** The day it was published, or null for a story only the family build holds. */
  readonly published: string | null;
  /** The picture's file under `<content>/art/`, or null to draw the app's fallback scene. */
  readonly art: string | null;
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
  const art = raw.art ?? null;
  if (art !== null && (typeof art !== 'string' || !ART_FILE.test(art))) throw new ContentError(`${where}.art is neither null nor a file name matching ${String(ART_FILE)}`);
  const duration = raw.duration === null || raw.duration === undefined ? null : seconds(raw.duration, `${where}.duration`);
  if ((audio === null) !== (duration === null)) throw new ContentError(`${where} has audio without a duration or a duration without audio`);
  return {
    route,
    title: text(raw.title, `${where}.title`),
    told,
    published,
    art,
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

// The picture check (docs/content.md, estate ADR-033). The files are served from the app's
// own origin, where an SVG opened by itself is a page, so this is an allowlist over a strict
// tokenizer: anything it does not recognise fails, rather than a ban list that a construct
// it has not heard of slips past.
const ART_ELEMENTS = new Set([
  'svg', 'defs', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'linearGradient', 'radialGradient', 'stop', 'clipPath', 'filter', 'feGaussianBlur',
]);
const ART_ATTRIBUTES = new Set([
  'id', 'width', 'height', 'viewBox', 'preserveAspectRatio', 'transform',
  'd', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy', 'fr', 'points', 'pathLength',
  'fill', 'fill-opacity', 'fill-rule', 'opacity', 'stroke', 'stroke-width', 'stroke-opacity',
  'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit',
  'offset', 'stop-color', 'stop-opacity', 'gradientUnits', 'gradientTransform', 'spreadMethod',
  'clip-path', 'clip-rule', 'clipPathUnits', 'filter', 'filterUnits', 'primitiveUnits',
  'stdDeviation', 'in', 'result', 'edgeMode',
]);
const SVG_NS = 'http://www.w3.org/2000/svg';
const ART_VIEWBOX = '0 0 600 800';
// After the name: attributes, each `name="value"` with no markup, quote or ampersand in it.
// Whitespace is XML's four characters only: \s would also take Unicode spaces a browser
// rejects, and the check must read the file as the browser does.
const TAG = /<(\/?)([A-Za-z][A-Za-z0-9]*)((?:[ \t\r\n]+[A-Za-z][A-Za-z0-9-]*="[^"<>&]*")*)[ \t\r\n]*(\/?)>/y;
const ATTRIBUTE = /([A-Za-z][A-Za-z0-9-]*)="([^"]*)"/g;
// Numbers, colours, keywords and lists of them; parentheses only in a transform or a url().
const PLAIN_VALUE = /^[A-Za-z0-9#.,%\s-]*$/;
const TRANSFORM_VALUE = /^(?:\s*(?:matrix|translate|scale|rotate|skewX|skewY)\([0-9eE.,\s-]*\)\s*)+$/;
const URL_VALUE = /^url\(#([A-Za-z][A-Za-z0-9_-]*)\)$/;
const ID_VALUE = /^[A-Za-z][A-Za-z0-9_-]*$/;

/** Checks a story picture against the contract and throws a ContentError naming the first
 *  problem: size, one `<svg>` root with the contract's viewBox, only allowlisted elements and
 *  attributes, no text, comments, DOCTYPE, entities or processing instructions, and `url(#id)`
 *  to an id in the same file as the only reference. */
export function checkArt(svg: string, where: string): void {
  const fail = (problem: string): never => { throw new ContentError(`${where}: ${problem}`); };
  if (new TextEncoder().encode(svg).byteLength > ART_MAX_BYTES) fail(`over ${String(ART_MAX_BYTES)} bytes`);
  const stack: string[] = [];
  const ids = new Set<string>();
  const references: string[] = [];
  let roots = 0;
  let at = 0;
  while (at < svg.length) {
    const next = svg.indexOf('<', at);
    const between = svg.slice(at, next === -1 ? svg.length : next);
    if (/[^ \t\r\n]/.test(between)) fail(`text outside a tag at offset ${String(at)}`);
    if (next === -1) break;
    TAG.lastIndex = next;
    const tag = TAG.exec(svg);
    if (!tag) fail(`markup that is not a plain tag at offset ${String(next)} (a comment, DOCTYPE, CDATA or processing instruction?)`);
    const [whole, closing, name = '', attributes = '', selfClosing] = tag ?? [];
    at = next + (whole?.length ?? 1);
    if (!ART_ELEMENTS.has(name)) fail(`the element <${name}> is not allowed`);
    if (closing) {
      if (attributes.trim() || selfClosing) fail(`a malformed closing tag </${name}>`);
      if (stack.pop() !== name) fail(`</${name}> does not close the open element`);
      continue;
    }
    if (stack.length === 0) {
      roots += 1;
      if (roots > 1 || name !== 'svg') fail('the file is not one <svg> root');
    } else if (name === 'svg') {
      fail('a nested <svg>');
    }
    const seen = new Set<string>();
    let viewBox: string | null = null;
    for (const [, attribute = '', value = ''] of attributes.matchAll(ATTRIBUTE)) {
      if (seen.has(attribute)) fail(`<${name}> has ${attribute} twice`);
      seen.add(attribute);
      if (attribute === 'viewBox') viewBox = value;
      if (attribute === 'xmlns') {
        if (name !== 'svg' || stack.length || value !== SVG_NS) fail('xmlns other than the SVG namespace on the root');
        continue;
      }
      if (!ART_ATTRIBUTES.has(attribute)) fail(`the attribute ${attribute} on <${name}> is not allowed`);
      if (attribute === 'id') {
        if (!ID_VALUE.test(value)) fail(`the id "${value}" is not ${String(ID_VALUE)}`);
        if (ids.has(value)) fail(`the id "${value}" is given twice`);
        ids.add(value);
        continue;
      }
      const url = URL_VALUE.exec(value);
      if (url) {
        references.push(url[1] ?? '');
        continue;
      }
      const transform = attribute === 'transform' || attribute === 'gradientTransform';
      if (!(PLAIN_VALUE.test(value) || (transform && TRANSFORM_VALUE.test(value)))) fail(`${attribute}="${value}" on <${name}> is not a plain value`);
    }
    if (name === 'svg' && viewBox !== ART_VIEWBOX) fail(`the root's viewBox is not "${ART_VIEWBOX}"`);
    if (name === 'svg' && !seen.has('xmlns')) fail('the root has no xmlns, so no browser draws it');
    if (!selfClosing) stack.push(name);
  }
  if (roots !== 1) fail('the file is not one <svg> root');
  if (stack.length) fail(`<${stack.join('> <')}> is not closed`);
  for (const id of references) if (!ids.has(id)) fail(`url(#${id}) names no id in the file`);
}
