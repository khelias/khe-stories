// A story's picture: its own file from the content (estate ADR-033), or the fallback night
// scene. Always an <img>, never inline, so nothing in a file reaches the page.
import fallback from './art/night.svg';

export function pictureImage(picture: string | null, loading: 'eager' | 'lazy' = 'eager'): HTMLImageElement {
  const image = document.createElement('img');
  image.loading = loading;
  image.src = picture ?? fallback;
  image.alt = '';
  image.decoding = 'async';
  return image;
}

/** The card's picture. */
export function renderArt(picture: string | null): HTMLElement {
  const span = document.createElement('span');
  span.className = 'story-art';
  span.setAttribute('aria-hidden', 'true');
  span.append(pictureImage(picture, 'lazy'));
  return span;
}

/** The player's tile, drawn with the open story's picture. */
export function drawTile(tile: HTMLElement, picture: string | null): void {
  tile.replaceChildren(pictureImage(picture));
}
