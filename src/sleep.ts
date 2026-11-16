// The sleep counter: how many stories play in a row before the player goes quiet, and
// whether the screen dims over the last one's final minute. The next story is started by
// stories.ts inside the audio's `ended` handler; this module keeps the count and the dim.
import { storage } from './storage.ts';

export const SLEEP_KEY = 'unejanku:v1:sleep';
export const COUNTS = [1, 2, 3] as const;
export type SleepCount = (typeof COUNTS)[number];
/** The dim fades in over this many seconds before the last story ends. */
export const DIM_SECONDS = 60;

export interface SleepSettings {
  readonly count: SleepCount;
  readonly dim: boolean;
}

const DEFAULT: SleepSettings = { count: 1, dim: false };

/** The stored choice, or one story without the dim, today's behaviour. */
export function readSleep(raw: string | null): SleepSettings {
  if (raw === null) return DEFAULT;
  try {
    const value = JSON.parse(raw) as { count?: unknown; dim?: unknown };
    const count = COUNTS.find((n) => n === value.count) ?? DEFAULT.count;
    return { count, dim: value.dim === true };
  } catch {
    return DEFAULT;
  }
}

export interface Sleep {
  readonly settings: () => SleepSettings;
  readonly choose: (settings: SleepSettings) => void;
  /** A story started by hand: the chosen count starts again, with this one as the first. */
  readonly restart: () => void;
  /** At a story's end: whether another story should follow, which counts it. */
  readonly takeNext: () => boolean;
  /** Whether the story playing now is the last one the count allows. */
  readonly isLast: () => boolean;
}

export function startSleep(): Sleep {
  let settings = readSleep(storage.get(SLEEP_KEY));
  let left: number = settings.count;
  return {
    settings: () => settings,
    choose(next) {
      // A changed count counts the story playing now as the first of it.
      if (next.count !== settings.count) left = next.count;
      settings = next;
      storage.set(SLEEP_KEY, JSON.stringify(settings));
    },
    restart() {
      left = settings.count;
    },
    takeNext() {
      if (left <= 1) return false;
      left -= 1;
      return true;
    },
    isLast: () => left <= 1,
  };
}
