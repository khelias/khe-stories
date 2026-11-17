import { describe, expect, it } from 'vitest';
import type { Notice } from '../server/contract.ts';
import { COPY } from '../src/copy.ts';
import { shownNotices } from '../src/notices.ts';

const copy = COPY.et;
const notice = (kind: Notice['kind'], route: string | null, title: string | null = null): Notice => ({ kind, route, title });

describe('shownNotices', () => {
  it('says the text is on the shelf and the reading is coming', () => {
    expect(shownNotices([notice('ready', 'konn', 'Konn tahtis lennata')], copy)).toEqual([
      { title: 'Sinu jutt on riiulil', body: 'Konn tahtis lennata. Ettelugemine tuleb varsti.', tag: 'konn', route: 'konn' },
    ]);
  });

  it('adds no second stop after a title that ends in one', () => {
    expect(shownNotices([notice('ready', 'konn', 'Kas konn lendab?')], copy)[0]?.body).toBe('Kas konn lendab? Ettelugemine tuleb varsti.');
  });

  it('shows only the newest notice of a story', () => {
    expect(shownNotices([notice('ready', 'konn', 'Konn'), notice('read', 'konn', 'Konn'), notice('ready', 'siil', 'Siil')], copy)).toEqual([
      { title: 'Ettelugemine on valmis', body: 'Konn', tag: 'konn', route: 'konn' },
      { title: 'Sinu jutt on riiulil', body: 'Siil. Ettelugemine tuleb varsti.', tag: 'siil', route: 'siil' },
    ]);
  });

  it('skips a kind it does not know', () => {
    expect(shownNotices([{ kind: 'later', route: 'konn', title: 'Konn' } as unknown as Notice], copy)).toEqual([]);
  });

  it('links a failed request nowhere', () => {
    expect(shownNotices([notice('failed', null)], copy)).toEqual([{ title: 'Jutt jäi seekord tegemata', body: 'Proovi uuesti.', tag: 'failed', route: null }]);
  });
});
