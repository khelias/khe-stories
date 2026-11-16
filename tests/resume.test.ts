import { describe, expect, it } from 'vitest';
import { parsePosition, positionFor, positionKey, resumable, savePosition, type PositionStore } from '../src/resume.ts';

function memory(): PositionStore & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    read: (route) => values.get(route) ?? null,
    write: (route, value) => { values.set(route, value); },
    clear: (route) => { values.delete(route); },
  };
}

describe('the resume rules', () => {
  it('keys each story under the versioned prefix', () => {
    expect(positionKey('siil')).toBe('unejanku:v1:pos:siil');
  });

  it('resumes only between 10 s in and 20 s before the end', () => {
    expect(resumable({ t: 10, d: 100, at: 0 })).toBe(false);
    expect(resumable({ t: 10.5, d: 100, at: 0 })).toBe(true);
    expect(resumable({ t: 79.9, d: 100, at: 0 })).toBe(true);
    expect(resumable({ t: 80, d: 100, at: 0 })).toBe(false);
  });

  it('reads only a well-formed position', () => {
    expect(parsePosition(null)).toBeNull();
    expect(parsePosition('nope')).toBeNull();
    expect(parsePosition('{"t":"20","d":100,"at":1}')).toBeNull();
    expect(parsePosition('{"t":-1,"d":100,"at":1}')).toBeNull();
    expect(parsePosition('{"t":20,"d":100,"at":1}')).toEqual({ t: 20, d: 100, at: 1 });
  });

  it('drops a position stored for a recording of another length', () => {
    const stored = '{"t":30,"d":100,"at":1}';
    expect(positionFor(stored, 100.4)?.t).toBe(30);
    expect(positionFor(stored, 120)).toBeNull();
    expect(positionFor(stored, null)).toBeNull();
  });

  it('stores a resumable position and clears one that is not', () => {
    const store = memory();
    savePosition(store, 'siil', 42.04, 98, 5);
    expect(JSON.parse(store.values.get('siil') ?? '')).toEqual({ t: 42, d: 98, at: 5 });
    savePosition(store, 'siil', 3, 98, 6);
    expect(store.values.has('siil')).toBe(false);
    savePosition(store, 'siil', 42, 98, 7);
    savePosition(store, 'siil', 90, 98, 8);
    expect(store.values.has('siil')).toBe(false);
  });
});
