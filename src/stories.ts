// The Unejänku player: the library of stories and the reading view of the open one, with the
// paragraph being read marked as the audio plays. The stories come from the build's catalog
// (`virtual:stories`, docs/content.md); paragraph starts are seconds into the audio.
import { drawTile, renderArt } from './art.ts';
import type { CopyKey } from './copy.ts';
import type { CatalogEntry, Paragraph, Story } from './content.ts';
import { audioUrl, savedUrl } from './offline-names.ts';
import type { OfflineStore } from './offline.ts';
import { localPositions, positionFor, savePosition, SAVE_EVERY_MS } from './resume.ts';

export interface BuiltStory extends CatalogEntry {
  /** The URL of the story's JSON. */
  readonly data: string;
  /** The URL of the story's picture, or null for the fallback scene. */
  readonly picture: string | null;
}

interface Card {
  readonly card: HTMLAnchorElement;
  /** The length, or where to continue. */
  readonly label: HTMLElement;
  /** The mark of a story kept on this phone. */
  readonly saved: HTMLElement;
}

interface Item extends Card {
  readonly entry: BuiltStory;
  text: Promise<Story> | null;
}

function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(whole / 60))}:${String(whole % 60).padStart(2, '0')}`;
}

function need<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`index.html has no ${selector}`);
  return node;
}

const PLAY_ICON = '<svg viewBox="0 0 13 14" aria-hidden="true" focusable="false"><path d="M1 1.6v10.8a1 1 0 0 0 1.5.86l9.2-5.4a1 1 0 0 0 0-1.72L2.5.74A1 1 0 0 0 1 1.6z"/></svg>';
const SAVED_ICON = '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M4.5 10.5 8 14l7.5-8"/></svg>';

function renderCard(entry: BuiltStory): Card {
  const card = document.createElement('a');
  card.className = 'story-card';
  card.href = `#${entry.route}`;
  card.append(renderArt(entry.picture));
  const body = document.createElement('span');
  body.className = 'story-card-body';
  const title = document.createElement('span');
  title.className = 'story-card-title';
  title.lang = 'et';
  title.textContent = entry.title;
  const meta = document.createElement('span');
  meta.className = 'story-card-meta';
  const length = document.createElement('span');
  length.className = 'story-card-length';
  length.innerHTML = entry.audio ? PLAY_ICON : '';
  const label = document.createElement('span');
  label.dataset.cardLength = '';
  length.append(label);
  const saved = document.createElement('span');
  saved.className = 'story-card-saved';
  saved.hidden = true;
  saved.dataset.cardSaved = '';
  saved.innerHTML = SAVED_ICON;
  const savedLabel = document.createElement('span');
  savedLabel.dataset.i18n = 'saved';
  saved.append(savedLabel);
  meta.append(length, saved);
  body.append(title, meta);
  card.append(body);
  return { card, label, saved };
}

async function loadText(entry: BuiltStory): Promise<Story> {
  const response = await fetch(entry.data);
  if (!response.ok) throw new Error(`${entry.data}: ${String(response.status)}`);
  return (await response.json()) as Story;
}

export interface StoriesOptions {
  readonly base: string;
  readonly stories: readonly BuiltStory[];
  readonly text: (key: CopyKey) => string;
  readonly offline: OfflineStore;
}

export interface Stories {
  /** Labels in the current language, after a switch. */
  readonly showLabels: () => void;
}

export function startStories({ base, stories: entries, text, offline }: StoriesOptions): Stories {
  const body = document.body;
  const audio = need<HTMLAudioElement>('[data-story-audio]');
  const seek = need<HTMLInputElement>('[data-player-seek]');
  const fill = need<HTMLElement>('[data-player-fill]');
  const elapsed = need<HTMLElement>('[data-player-elapsed]');
  const left = need<HTMLElement>('[data-player-left]');
  const total = need<HTMLElement>('[data-player-total]');
  const playButton = need<HTMLButtonElement>('[data-player-play]');
  const tile = need<HTMLElement>('[data-player-tile]');
  const textBox = need<HTMLElement>('[data-story-text]');
  const noReading = need<HTMLElement>('[data-story-no-reading]');
  const saveBox = need<HTMLElement>('[data-story-save]');
  const saveButton = need<HTMLButtonElement>('[data-save-button]');
  const saveLabel = need<HTMLElement>('[data-save-label]');
  const saveError = need<HTMLElement>('[data-save-error]');
  const storyLength = need<HTMLElement>('[data-story-length]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  // A refused play() (no AAC support, or a pause right after) leaves the button on play, as
  // the pause event never came; nothing else to do.
  const play = () => { audio.play().catch(() => {}); };

  if (!entries.length) throw new Error('the build holds no story');
  const list = need<HTMLElement>('[data-cards]');
  const items: Item[] = entries.map((entry) => {
    const card = renderCard(entry);
    list.append(card.card);
    return { ...card, entry, text: null };
  });
  // Every text up front: a few KB each, and ready when a card is tapped.
  const textOf = (item: Item) => (item.text ??= loadText(item.entry));
  items.forEach((item) => { void textOf(item).catch(() => {}); });
  const itemAt = (hash: string) => items.find((item) => `#${item.entry.route}` === hash);

  let open: Item | null = null;
  let duration = 0;
  let starts: number[] = [];
  let paragraphs: HTMLParagraphElement[] = [];
  let current = -1;
  let pendingResume: number | null = null;
  let lastSaved = 0;
  let saving = false;

  const minutes = (key: CopyKey, seconds: number) => text(key).replace('{n}', String(Math.max(1, Math.round(seconds / 60))));

  function cardLabel({ entry }: Item): string {
    if (entry.audio === null || entry.duration === null) return text('readOnly');
    const position = positionFor(localPositions.read(entry.route), entry.duration);
    return position ? text('resume').replace('{t}', clock(position.t)) : minutes('minutesShort', entry.duration);
  }

  function showSave(): void {
    const sha = open?.entry.audio ?? null;
    saveBox.hidden = sha === null || !offline.available;
    if (sha === null) return;
    const isSaved = offline.isSaved(sha);
    // A toggle keeps one name; pressed says whether the story is on the phone.
    saveButton.setAttribute('aria-pressed', String(isSaved));
    saveButton.toggleAttribute('data-saving', saving);
    saveLabel.textContent = text(saving ? 'saving' : 'save');
  }

  function showLabels(): void {
    items.forEach((item) => {
      item.label.textContent = cardLabel(item);
      item.saved.hidden = !(item.entry.audio && offline.isSaved(item.entry.audio));
    });
    storyLength.textContent = open?.entry.duration ? minutes('minutes', open.entry.duration) : '';
    playButton.setAttribute('aria-label', text(audio.paused ? 'play' : 'pause'));
    showSave();
  }

  function remember(): void {
    if (!open || open.entry.audio === null || !Number.isFinite(audio.duration)) return;
    savePosition(localPositions, open.entry.route, audio.currentTime, audio.duration, Date.now());
    lastSaved = Date.now();
  }

  function showTime(): void {
    const time = audio.currentTime;
    seek.value = String(Math.round(time));
    seek.setAttribute('aria-valuetext', `${clock(time)} / ${clock(duration)}`);
    fill.style.transform = `scaleX(${String(duration ? Math.min(1, time / duration) : 0)})`;
    elapsed.textContent = clock(time);
    left.textContent = `−${clock(duration - time)}`;

    if (!audio.paused && Date.now() - lastSaved >= SAVE_EVERY_MS) remember();
    if (!body.hasAttribute('data-started')) return;
    let index = 0;
    while (index + 1 < starts.length && (starts[index + 1] ?? Infinity) <= time) index += 1;
    if (index === current) return;
    current = index;
    paragraphs.forEach((paragraph, i) => { paragraph.classList.toggle('is-current', i === index); });
    if (!audio.paused) paragraphs[index]?.scrollIntoView({ block: 'start', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
  }

  function showDuration(): void {
    if (Number.isFinite(audio.duration) && audio.duration > 0) duration = audio.duration;
    seek.max = String(Math.ceil(duration));
    total.textContent = clock(duration);
    showLabels();
    showTime();
  }

  function skip(seconds: number): void {
    audio.currentTime = Math.min(Math.max(0, audio.currentTime + seconds), duration);
  }

  function showReading(available: boolean): void {
    body.toggleAttribute('data-no-audio', !available);
    noReading.hidden = available;
  }

  audio.addEventListener('play', () => {
    offline.hold();
    body.setAttribute('data-started', '');
    body.setAttribute('data-playing', '');
    showLabels();
    showTime();
  });
  audio.addEventListener('pause', () => {
    body.removeAttribute('data-playing');
    remember();
    showLabels();
  });
  audio.addEventListener('ended', () => {
    if (open) localPositions.clear(open.entry.route);
    showLabels();
  });
  audio.addEventListener('timeupdate', showTime);
  audio.addEventListener('loadedmetadata', () => {
    if (pendingResume !== null && audio.currentTime < 1) audio.currentTime = pendingResume;
    pendingResume = null;
    showDuration();
  });
  audio.addEventListener('error', () => {
    if (open?.entry.audio) showReading(false);
  });
  window.addEventListener('pagehide', remember);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') remember();
  });

  playButton.addEventListener('click', () => { if (audio.paused) play(); else audio.pause(); });
  document.querySelectorAll('[data-player-skip]').forEach((button) => {
    button.addEventListener('click', () => { skip(Number(button.getAttribute('data-player-skip'))); });
  });
  seek.addEventListener('input', () => { audio.currentTime = Number(seek.value); });

  saveButton.addEventListener('click', () => {
    const sha = open?.entry.audio;
    if (!sha || saving) return;
    saving = true;
    saveError.hidden = true;
    showSave();
    const done = offline.isSaved(sha) ? offline.remove(sha) : offline.save(sha);
    done
      .catch(() => { saveError.hidden = false; })
      .finally(() => {
        saving = false;
        showLabels();
      });
  });

  function showText(item: Item, story: Story): void {
    if (open !== item) return;
    starts = story.paragraphs.map(({ start }: Paragraph) => start ?? 0);
    paragraphs = story.paragraphs.map(({ text: words, start }: Paragraph) => {
      const paragraph = document.createElement('p');
      paragraph.textContent = words;
      if (start !== null && item.entry.audio) {
        paragraph.addEventListener('click', () => {
          audio.currentTime = start;
          play();
        });
      }
      return paragraph;
    });
    textBox.replaceChildren(...paragraphs);
    current = -1;
    showTime();
  }

  // Synchronous, so a card tap that opens a story can start it in the same task (iOS).
  function openStory(item: Item): void {
    if (item === open) return;
    remember();
    open = item;
    audio.pause();
    const { entry } = item;
    showReading(entry.audio !== null);
    if (entry.audio) {
      audio.src = offline.playsSaved(entry.audio) ? savedUrl(base, entry.audio) : audioUrl(base, entry.audio);
      pendingResume = positionFor(localPositions.read(entry.route), entry.duration)?.t ?? null;
    } else {
      audio.removeAttribute('src');
      audio.load();
      pendingResume = null;
    }
    duration = entry.duration ?? 0;
    textBox.replaceChildren();
    paragraphs = [];
    starts = [];
    textOf(item).then(
      (story) => { showText(item, story); },
      () => {
        if (open !== item) return;
        const failed = document.createElement('p');
        failed.className = 'story-text-failed';
        failed.textContent = text('textFailed');
        textBox.replaceChildren(failed);
      },
    );
    body.removeAttribute('data-started');
    body.removeAttribute('data-playing');
    saveError.hidden = true;
    document.querySelectorAll('[data-story-title]').forEach((node) => { node.textContent = entry.title; });
    items.forEach(({ card }) => { card.setAttribute('aria-current', String(card === item.card)); });
    drawTile(tile, entry.picture);
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: entry.title,
        artist: 'Jänkujutud',
        album: 'Unejänku',
        artwork: [{ src: `${base}icon-512.png`, sizes: '512x512', type: 'image/png' }],
      });
    }
    showDuration();
  }

  if ('mediaSession' in navigator) {
    const actions: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', play],
      ['pause', () => { audio.pause(); }],
      ['seekbackward', (details) => { skip(-(details.seekOffset ?? 15)); }],
      ['seekforward', (details) => { skip(details.seekOffset ?? 15); }],
      ['seekto', (details) => { if (details.seekTime !== undefined) audio.currentTime = details.seekTime; }],
    ];
    for (const [action, handler] of actions) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // A browser that does not know the action throws; the others still work.
      }
    }
  }

  // The phone shows one view at a time; from 960px both stand side by side and the hash only
  // says which story is open. Without a story's hash the library shows, with the first story
  // loaded in the player.
  // The query the library had when the story was opened from it, or null. Going back through
  // history is right only while it is unchanged: a language switch in between rewrites ?lang
  // in place, and the entry behind holds the old language.
  let openedFrom: string | null = null;
  function showView(): void {
    const item = itemAt(window.location.hash);
    const first = items[0];
    const target = item ?? open ?? first;
    if (target) openStory(target);
    const view = item ? 'story' : 'library';
    if (body.getAttribute('data-view') === view) return;
    body.setAttribute('data-view', view);
    if (view === 'library') openedFrom = null;
    window.scrollTo(0, 0);
  }
  items.forEach((item) => {
    item.card.addEventListener('click', (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      openedFrom = itemAt(window.location.hash) ? null : window.location.search;
      openStory(item);
      if (item.entry.audio) play();
    });
  });
  document.querySelectorAll('[data-story-close]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      if (openedFrom === window.location.search) {
        window.history.back();
      } else {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
        showView();
      }
    });
  });
  // Going back may change ?lang as well as the hash, and then only popstate fires.
  window.addEventListener('hashchange', showView);
  window.addEventListener('popstate', showView);
  showView();
  return { showLabels };
}
