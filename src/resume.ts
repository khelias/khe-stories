// Where listening stopped, per story, in this browser's localStorage.
import { storage } from './storage.ts';

export const SAVE_EVERY_MS = 5000;
/** Nearer the start than this, the story starts over. */
const MIN_SECONDS = 10;
/** Nearer the end than this, the story counts as heard and starts over. */
const END_SECONDS = 20;

export interface Position {
  /** Seconds into the audio. */
  readonly t: number;
  /** The audio's duration then, so a re-recorded story does not resume at a wrong place. */
  readonly d: number;
  /** When it was stored, in milliseconds. */
  readonly at: number;
}

export const positionKey = (route: string) => `unejanku:v1:pos:${route}`;

/** Whether a stored position is worth resuming from. */
export function resumable(position: Position | null): position is Position {
  return position !== null && position.t > MIN_SECONDS && position.t < position.d - END_SECONDS;
}

export function parsePosition(text: string | null): Position | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as Partial<Position> | null;
    const { t, d, at } = value ?? {};
    if (typeof t !== 'number' || typeof d !== 'number' || typeof at !== 'number') return null;
    if (![t, d, at].every(Number.isFinite) || t < 0 || d <= 0) return null;
    return { t, d, at };
  } catch {
    return null;
  }
}

/** The stored position, if it is still for this recording (same duration within a second). */
export function positionFor(text: string | null, duration: number | null): Position | null {
  const position = parsePosition(text);
  if (!position || duration === null || Math.abs(position.d - duration) > 1) return null;
  return resumable(position) ? position : null;
}

export interface PositionStore {
  read(route: string): string | null;
  write(route: string, value: string): void;
  clear(route: string): void;
}

/** localStorage, or nothing where it is blocked. */
export const localPositions: PositionStore = {
  read: (route) => storage.get(positionKey(route)),
  write: (route, value) => { storage.set(positionKey(route), value); },
  clear: (route) => { storage.remove(positionKey(route)); },
};

/** Stores `t` of `d`, or clears the entry when the position is not worth resuming. */
export function savePosition(store: PositionStore, route: string, t: number, d: number, now: number): void {
  const position = { t: Math.round(t * 10) / 10, d, at: now };
  if (resumable(position)) store.write(route, JSON.stringify(position));
  else store.clear(route);
}
