import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ART_MAX_BYTES, checkArt, ContentError, parseCatalog, parseStory, storiesFor, type CatalogEntry } from '../src/content.ts';

const SHA = 'a'.repeat(64);
const entry = (overrides: Partial<CatalogEntry> = {}) => ({
  route: 'siil',
  title: 'Siil',
  told: '2026-01-10',
  published: '2026-11-16',
  art: 'siil.svg',
  duration: 60,
  audio: SHA,
  ...overrides,
});

describe('parseCatalog', () => {
  it('reads the demo catalog', () => {
    const catalog = parseCatalog(JSON.parse(readFileSync('demo/catalog.json', 'utf8')));
    expect(catalog.stories.map(({ route }) => route)).toEqual(['siil-otsis-und', 'vaike-vihmapilv', 'ookull-luges-tahti']);
    expect(catalog.stories.filter(({ audio }) => audio === null)).toHaveLength(1);
    expect(catalog.stories.some(({ duration }) => (duration ?? 0) > 90)).toBe(true);
  });

  it('rejects a route given twice', () => {
    expect(() => parseCatalog({ stories: [entry(), entry({ title: 'Teine' })] })).toThrow(/twice/);
  });

  it.each(['Siil', 'siil_2', 'siil/x', '', 'õun'])('rejects the route %j', (route) => {
    expect(() => parseCatalog({ stories: [entry({ route })] })).toThrow(ContentError);
  });

  it('rejects audio without a duration and a bad sha', () => {
    expect(() => parseCatalog({ stories: [entry({ duration: null })] })).toThrow(/duration/);
    expect(() => parseCatalog({ stories: [entry({ audio: 'abc' })] })).toThrow(/sha256/);
  });

  it('rejects a published value that is not a date', () => {
    expect(() => parseCatalog({ stories: [entry({ published: 'yes' })] })).toThrow(/published/);
  });

  it('reads an absent picture as the fallback', () => {
    const withoutArt: Record<string, unknown> = { ...entry() };
    delete withoutArt.art;
    expect(parseCatalog({ stories: [withoutArt] }).stories[0]?.art).toBeNull();
    expect(parseCatalog({ stories: [entry({ art: null })] }).stories[0]?.art).toBeNull();
  });

  it.each(['siil', 'Siil.svg', '../siil.svg', 'siil.svg.png', 'sun', 'art/siil.svg', ''])('rejects the picture name %j', (art) => {
    expect(() => parseCatalog({ stories: [entry({ art })] })).toThrow(/art/);
  });
});

describe('parseStory', () => {
  it('rejects a story whose paragraphs are empty', () => {
    expect(() => parseStory({ title: 'Siil', paragraphs: [] }, entry())).toThrow(/no paragraphs/);
    expect(() => parseStory({ title: 'Siil', paragraphs: [{ text: '  ', start: 1 }] }, entry())).toThrow(ContentError);
  });

  it('rejects a title other than the catalog one', () => {
    expect(() => parseStory({ title: 'Teine', paragraphs: [{ text: 'Üks.', start: 1 }] }, entry())).toThrow(/title/);
  });

  it('needs rising starts within the audio, and none without audio', () => {
    const paragraphs = (starts: (number | null)[]) => starts.map((start) => ({ text: 'Lause.', start }));
    expect(parseStory({ title: 'Siil', paragraphs: paragraphs([1, 5]) }, entry()).paragraphs).toHaveLength(2);
    expect(() => parseStory({ title: 'Siil', paragraphs: paragraphs([5, 1]) }, entry())).toThrow(/start/);
    expect(() => parseStory({ title: 'Siil', paragraphs: paragraphs([1, 61]) }, entry())).toThrow(/start/);
    expect(() => parseStory({ title: 'Siil', paragraphs: paragraphs([1]) }, entry({ duration: null, audio: null }))).toThrow(/no audio/);
    expect(parseStory({ title: 'Siil', paragraphs: paragraphs([null]) }, entry({ duration: null, audio: null })).paragraphs[0]?.start).toBeNull();
  });
});

describe('storiesFor', () => {
  it('keeps unpublished stories out of the public build', () => {
    const catalog = parseCatalog({ stories: [entry(), entry({ route: 'peres', published: null })] });
    expect(storiesFor('public', catalog).map(({ route }) => route)).toEqual(['siil']);
    expect(storiesFor('family', catalog).map(({ route }) => route)).toEqual(['siil', 'peres']);
  });
});

const SVG = (inner: string, root = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800"') => `<svg ${root}>${inner}</svg>`;
const GOOD = '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#050818"/></linearGradient>'
  + '<filter id="b"><feGaussianBlur stdDeviation="4"/></filter></defs>'
  + '<rect width="600" height="800" fill="url(#g)"/><g transform="translate(10 20) scale(1.5)"><path d="M0 0L5 5Z" filter="url(#b)" opacity="0.5"/></g>';

describe('checkArt', () => {
  it('passes every picture in the repo', () => {
    for (const dir of ['demo/art', 'src/art']) {
      for (const file of readdirSync(dir)) expect(() => { checkArt(readFileSync(`${dir}/${file}`, 'utf8'), file); }).not.toThrow();
    }
  });

  it('fails a long bad transform at once, not after backtracking', () => {
    const value = `${Array.from({ length: 40 }, () => 'rotate(1)').join('          ')} x`;
    const started = performance.now();
    expect(() => { checkArt(SVG(`<g transform="${value}"></g>`), 'slow'); }).toThrow(ContentError);
    expect(performance.now() - started).toBeLessThan(200);
  });

  it('passes the allowed constructs', () => {
    expect(() => { checkArt(SVG(GOOD), 'good'); }).not.toThrow();
  });

  it.each([
    ['a script', '<script>alert(1)</script>'],
    ['a foreignObject', '<foreignObject width="10" height="10"></foreignObject>'],
    ['an external href', '<image href="https://example.com/x.png" width="10" height="10"/>'],
    ['an href on a use', '<use href="#g"/>'],
    ['an xlink:href', '<use xlink:href="#g"/>'],
    ['a set on href', '<a><set attributeName="href" to="javascript:alert(1)"/></a>'],
    ['an animate on href', '<animate attributeName="href" values="javascript:alert(1)"/>'],
    ['a style attribute with url()', '<rect width="1" height="1" style="fill: url(https://example.com/x)"/>'],
    ['a style element', '<style>rect { fill: red }</style>'],
    ['an event handler', '<rect width="1" height="1" onclick="alert(1)"/>'],
    ['a load handler on a circle', '<circle r="1" onload="alert(1)"/>'],
    ['an external url()', '<rect width="1" height="1" fill="url(https://example.com/x#a)"/>'],
    ['a url() to a missing id', '<rect width="1" height="1" fill="url(#nope)"/>'],
    ['javascript in a value', '<rect width="1" height="1" fill="javascript:alert(1)"/>'],
    ['a comment', '<!-- note -->'],
    ['text', '<g>hello</g>'],
    ['an entity', '<rect width="1" height="1" fill="&red;"/>'],
    ['CDATA', '<g><![CDATA[x]]></g>'],
    ['a nested svg', '<svg viewBox="0 0 1 1"></svg>'],
    ['an unclosed element', '<g>'],
    ['a stray closing tag', '</g>'],
    ['a duplicate attribute', '<rect width="1" width="2"/>'],
    ['a single-quoted attribute', "<rect width='1'/>"],
  ])('fails %s', (_, inner) => {
    expect(() => { checkArt(SVG(GOOD + inner), 'bad'); }).toThrow(ContentError);
  });

  it.each([
    ['a DOCTYPE', `<!DOCTYPE svg [<!ENTITY red "#f00">]>${SVG(GOOD)}`],
    ['an XML declaration', `<?xml version="1.0"?>${SVG(GOOD)}`],
    ['a second root', SVG(GOOD) + SVG('')],
    ['text after the root', `${SVG(GOOD)}x`],
    ['another root element', '<g></g>'],
    ['another viewBox', SVG(GOOD, 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"')],
    ['no viewBox', SVG(GOOD, 'xmlns="http://www.w3.org/2000/svg"')],
    ['another namespace', SVG(GOOD, 'xmlns="http://www.w3.org/1999/xhtml" viewBox="0 0 600 800"')],
    ['no namespace', SVG(GOOD, 'viewBox="0 0 600 800"')],
    ['a byte order mark', `\ufeff${SVG(GOOD)}`],
    ['a no-break space between attributes', SVG('<rect\u00a0width="1"/>')],
    ['a namespace prefix', SVG(GOOD, 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 600 800"')],
    ['an oversized file', SVG(GOOD + '<g></g>'.repeat(ART_MAX_BYTES / 7 + 1))],
  ])('fails %s', (_, svg) => {
    expect(() => { checkArt(svg, 'bad'); }).toThrow(ContentError);
  });
});
