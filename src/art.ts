// The card drawings, one per key a catalog entry may name; an unknown key draws the default.
import cone from './art/cone.svg?raw';
import fallback from './art/default.svg?raw';
import sky from './art/sky.svg?raw';
import sun from './art/sun.svg?raw';

interface Art {
  readonly drawing: string;
  /** The night sky behind it on the phone's large card. */
  readonly sky: boolean;
}

const DEFAULT: Art = { drawing: fallback, sky: false };
const ART: Readonly<Record<string, Art>> = { sun: { drawing: sun, sky: false }, cone: { drawing: cone, sky: true }, default: DEFAULT };

const known = (key: string) => (key in ART ? key : 'default');

/** Fills `span` with the drawing for `key` (the build's own SVG files, never content text),
 *  with the sky behind it where `withSky`. */
function fill(span: HTMLElement, key: string, withSky: boolean): HTMLElement {
  const id = known(key);
  const art = ART[id] ?? DEFAULT;
  span.dataset.art = id;
  span.innerHTML = (withSky && art.sky ? sky : '') + art.drawing;
  return span;
}

/** The card's art. */
export function renderArt(key: string): HTMLElement {
  const span = document.createElement('span');
  span.className = 'story-art';
  span.setAttribute('aria-hidden', 'true');
  return fill(span, key, true);
}

/** The player's tile, drawn for `key`. */
export function drawTile(tile: HTMLElement, key: string): void {
  fill(tile, key, false);
}
