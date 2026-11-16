// What differs between the two builds, decided here alone (docs/decisions/001 point 2).
import type { BuildName } from './content.ts';

export interface BuildSettings {
  /** The path the build is served under. */
  readonly base: string;
  /** How the build links khe.ee: from its own origin, or by full address. */
  readonly site: string;
  /** khe.ee's frame and product view (estate ADR-030); the family build shows only the product. */
  readonly frame: boolean;
}

export const BUILDS: Readonly<Record<BuildName, BuildSettings>> = {
  public: { base: '/stories/', site: '', frame: true },
  family: { base: '/', site: 'https://khe.ee', frame: false },
};

/** The app's background, in its theme-color, its manifest and `--paper` in shell.css. */
export const PAPER = '#0b0f1d';

export function buildName(value: string | undefined): BuildName {
  const name = value ?? 'public';
  if (name !== 'public' && name !== 'family') throw new Error(`STORIES_BUILD=${name} is neither public nor family`);
  return name;
}

/** khe.ee's front page and privacy page as this build links them, and the family's own app. */
export const siteLinks = (build: BuildName) => ({
  home: (locale: string) => `${BUILDS[build].site}/?lang=${locale}`,
  privacy: (locale: string) => `${BUILDS[build].site}/privacy?lang=${locale}`,
  family: (locale: string) => `https://stories.khe.ee/?lang=${locale}`,
});
