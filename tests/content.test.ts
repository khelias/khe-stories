import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ContentError, parseCatalog, parseStory, storiesFor, type CatalogEntry } from '../src/content.ts';

const SHA = 'a'.repeat(64);
const entry = (overrides: Partial<CatalogEntry> = {}) => ({
  route: 'siil',
  title: 'Siil',
  told: '2026-01-10',
  published: '2026-11-16',
  art: 'sun',
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

  it('defaults the art key', () => {
    const withoutArt: Record<string, unknown> = { ...entry() };
    delete withoutArt.art;
    expect(parseCatalog({ stories: [withoutArt] }).stories[0]?.art).toBe('default');
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
