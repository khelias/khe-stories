import { describe, expect, it } from 'vitest';
import { readSleep, startSleep } from '../src/sleep.ts';

describe('readSleep', () => {
  it('defaults to one story without the dim', () => {
    expect(readSleep(null)).toEqual({ count: 1, dim: false });
    expect(readSleep('not json')).toEqual({ count: 1, dim: false });
    expect(readSleep(JSON.stringify({ count: 7, dim: 'yes' }))).toEqual({ count: 1, dim: false });
  });

  it('reads a stored choice', () => {
    expect(readSleep(JSON.stringify({ count: 3, dim: true }))).toEqual({ count: 3, dim: true });
  });
});

describe('startSleep', () => {
  it('lets the chosen count of stories play, then stops, and starts over by hand', () => {
    const sleep = startSleep();
    sleep.choose({ count: 2, dim: false });
    sleep.restart();
    expect(sleep.isLast()).toBe(false);
    expect(sleep.takeNext()).toBe(true);
    expect(sleep.isLast()).toBe(true);
    expect(sleep.takeNext()).toBe(false);
    sleep.restart();
    expect(sleep.takeNext()).toBe(true);
  });

  it('stops after this story by default', () => {
    const sleep = startSleep();
    sleep.choose({ count: 1, dim: false });
    expect(sleep.takeNext()).toBe(false);
  });
});
