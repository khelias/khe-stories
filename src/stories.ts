// The Unejänku player: the library of stories, the story page and, once it plays, the same
// page as the listening view, with the paragraph being read lit. The stories come from the
// build's catalog (`virtual:stories`, docs/content.md); paragraph starts are seconds into the
// audio. The sleep counter (sleep.ts) chains the next story when one ends.
import { drawTile, pictureImage, renderArt } from './art.ts';
import { fill as fillTemplate, type CopyKey } from './copy.ts';
import type { CatalogEntry, Paragraph, Story } from './content.ts';
import { audioUrl, savedUrl } from './offline-names.ts';
import type { OfflineStore } from './offline.ts';
import { localPositions, positionFor, savePosition, SAVE_EVERY_MS } from './resume.ts';
import { COUNTS, DIM_SECONDS, startSleep } from './sleep.ts';

export interface BuiltStory extends CatalogEntry {
  /** The URL of the story's JSON. */
  readonly data: string;
  /** The URL of the story's picture, or null for the fallback scene. */
  readonly picture: string | null;
}

interface Card {
  readonly card: HTMLAnchorElement;
  /** The hero's button: listen, listen on or read. */
  readonly action: HTMLElement;
  /** The length, what is left, or where to continue. */
  readonly label: HTMLElement;
  /** How far listening got, on the hero. */
  readonly progress: HTMLElement;
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

const PLAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5.2v13.6c0 .8.9 1.3 1.6.9l10.6-6.8c.6-.4.6-1.3 0-1.7L9.6 4.3C8.9 3.9 8 4.4 8 5.2z"/></svg>';
const BOOK_ICON = '<svg class="icon-line" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 5.5c3-1 5.7-.8 8 1 2.3-1.8 5-2 8-1v13c-3-1-5.7-.8-8 1-2.3-1.8-5-2-8-1zM12 6.5v13"/></svg>';
const SAVED_ICON = '<svg class="icon-line" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

function span(className: string, html = ''): HTMLSpanElement {
  const node = document.createElement('span');
  node.className = className;
  node.innerHTML = html;
  return node;
}

/** One card, the same markup in the grid and as the hero; the stylesheet tells them apart. */
function renderCard(entry: BuiltStory): Card {
  const card = document.createElement('a');
  card.className = 'story-card';
  card.href = `#${entry.route}`;
  card.append(renderArt(entry.picture));
  const body = span('story-card-body');
  const title = span('story-card-title');
  title.lang = 'et';
  title.textContent = entry.title;
  const meta = span('story-card-meta');
  const action = span('story-card-action', entry.audio ? PLAY_ICON : BOOK_ICON);
  action.append(span(''));
  const length = span('story-card-length', entry.audio ? '' : BOOK_ICON);
  const label = span('');
  label.dataset.cardLength = '';
  length.append(label);
  const saved = span('story-card-saved', SAVED_ICON);
  saved.hidden = true;
  saved.dataset.cardSaved = '';
  const savedLabel = span('');
  savedLabel.dataset.i18n = 'saved';
  saved.append(savedLabel);
  meta.append(action, length, saved);
  body.append(title, meta);
  const track = span('story-card-progress');
  const progress = span('');
  track.append(progress);
  card.append(body, track);
  return { card, action, label, progress, saved };
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
  const playButtons = document.querySelectorAll<HTMLButtonElement>('[data-player-play]');
  const tile = need<HTMLElement>('[data-player-tile]');
  const picture = need<HTMLElement>('[data-story-picture]');
  const textBox = need<HTMLElement>('[data-story-text]');
  const noReading = need<HTMLElement>('[data-story-no-reading]');
  const startButton = need<HTMLButtonElement>('[data-story-play]');
  const startLabel = need<HTMLElement>('[data-story-play-label]');
  const saveBox = need<HTMLElement>('[data-story-save]');
  const saveButton = need<HTMLButtonElement>('[data-save-button]');
  const saveLabel = need<HTMLElement>('[data-save-label]');
  const saveError = need<HTMLElement>('[data-save-error]');
  const storyLength = need<HTMLElement>('[data-story-length]');
  const hero = need<HTMLElement>('[data-hero]');
  const list = need<HTMLElement>('[data-cards]');
  const mini = need<HTMLElement>('[data-mini]');
  const miniLink = need<HTMLAnchorElement>('[data-mini-link]');
  const miniArt = need<HTMLElement>('[data-mini-art]');
  const miniTime = need<HTMLElement>('[data-mini-time]');
  const sheet = need<HTMLDialogElement>('[data-sleep-sheet]');
  const dimSwitch = need<HTMLButtonElement>('[data-sleep-dim]');
  const dim = need<HTMLElement>('[data-dim]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const sleep = startSleep();
  // A refused play() (no AAC support, or a pause right after) leaves the button on play, as
  // the pause event never came; nothing else to do.
  const play = () => { audio.play().catch(() => {}); };

  if (!entries.length) throw new Error('the build holds no story');
  const items: Item[] = entries.map((entry) => ({ ...renderCard(entry), entry, text: null }));
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
  // The hero card, which the grid leaves out.
  let heroItem: Item | null = null;
  let dimmed = false;

  const inStory = () => body.getAttribute('data-view') === 'story';
  const resumeLabel = (t: number) => fillTemplate(text('resume'), { t: clock(t) });
  const minutes = (key: CopyKey, seconds: number) => fillTemplate(text(key), { n: Math.max(1, Math.round(seconds / 60)) });
  const resumeAt = ({ entry }: Item) => (entry.duration === null ? null : positionFor(localPositions.read(entry.route), entry.duration));

  /** The hero: the first story in library order that can be resumed, else the first. */
  function placeCards(): void {
    const next = items.find((item) => resumeAt(item)) ?? items[0] ?? null;
    if (next === heroItem && hero.firstChild) return;
    heroItem = next;
    items.forEach((item) => { item.card.classList.toggle('is-hero', item === next); });
    if (next) hero.replaceChildren(next.card);
    list.replaceChildren(...items.filter((item) => item !== next).map(({ card }) => card));
  }

  function showCard(item: Item): void {
    const { entry } = item;
    const position = resumeAt(item);
    const isHero = item === heroItem;
    const actionLabel = item.action.lastElementChild;
    if (actionLabel) actionLabel.textContent = text(entry.audio === null ? 'readOnly' : position ? 'listenOn' : 'play');
    item.progress.style.transform = `scaleX(${String(position && entry.duration ? position.t / entry.duration : 0)})`;
    if (entry.audio === null || entry.duration === null) {
      item.label.textContent = isHero ? '' : text('readOnly');
    } else if (position) {
      item.label.textContent = isHero ? minutes('minutesLeft', entry.duration - position.t) : resumeLabel(position.t);
    } else {
      item.label.textContent = minutes('minutesShort', entry.duration);
    }
    item.saved.hidden = !(entry.audio && offline.isSaved(entry.audio));
  }

  function showSave(): void {
    const sha = open?.entry.audio ?? null;
    saveBox.hidden = sha === null || !offline.available;
    if (sha === null) return;
    const isSaved = offline.isSaved(sha);
    // A toggle keeps one name; pressed says whether the story is on the phone.
    saveButton.setAttribute('aria-pressed', String(isSaved));
    saveButton.setAttribute('aria-label', text(saving ? 'saving' : 'save'));
    saveButton.toggleAttribute('data-saving', saving);
    saveLabel.textContent = text(saving ? 'saving' : 'save');
  }

  function showLabels(): void {
    placeCards();
    items.forEach(showCard);
    const position = open ? resumeAt(open) : null;
    startLabel.textContent = text(position ? 'listenOn' : 'play');
    storyLength.textContent = position ? resumeLabel(position.t) : open?.entry.duration ? minutes('minutes', open.entry.duration) : '';
    playButtons.forEach((button) => { button.setAttribute('aria-label', text(audio.paused ? 'play' : 'pause')); });
    showSave();
  }

  function remember(): void {
    if (!open || open.entry.audio === null || !Number.isFinite(audio.duration)) return;
    savePosition(localPositions, open.entry.route, audio.currentTime, audio.duration, Date.now());
    lastSaved = Date.now();
  }

  function showDim(time: number): void {
    // The last story is the last the count allows, or the library's last with audio.
    const due = sleep.settings().dim && (sleep.isLast() || !nextStory()) && !dimmed && duration > 0 && time >= duration - DIM_SECONDS && !audio.paused;
    if (!due || !dim.hidden) return;
    dim.hidden = false;
    // The fade runs over what is left, at most the last minute; at once under reduced motion.
    dim.style.transitionDuration = reducedMotion.matches ? '0s' : `${String(Math.max(0, duration - time))}s`;
    requestAnimationFrame(() => { dim.classList.add('is-dark'); });
  }

  function clearDim(): void {
    dim.classList.remove('is-dark');
    dim.hidden = true;
  }

  /** Lifted by a tap, it stays away for this story; a story started by hand may dim again. */
  function resetDim(lifted: boolean): void {
    dimmed = lifted;
    clearDim();
  }

  dim.addEventListener('click', () => { resetDim(true); });

  function showTime(): void {
    const time = audio.currentTime;
    seek.value = String(Math.round(time));
    seek.setAttribute('aria-valuetext', `${clock(time)} / ${clock(duration)}`);
    fill.style.transform = `scaleX(${String(duration ? Math.min(1, time / duration) : 0)})`;
    elapsed.textContent = clock(time);
    left.textContent = `−${clock(duration - time)}`;
    if (!mini.hidden) miniTime.textContent = `${clock(time)} / ${clock(duration)}`;
    showDim(time);

    if (!audio.paused && Date.now() - lastSaved >= SAVE_EVERY_MS) remember();
    if (!body.hasAttribute('data-started')) return;
    let index = 0;
    while (index + 1 < starts.length && (starts[index + 1] ?? Infinity) <= time) index += 1;
    if (index === current) return;
    current = index;
    paragraphs.forEach((paragraph, i) => { paragraph.classList.toggle('is-current', i === index); });
    if (!audio.paused && inStory()) {
      paragraphs[index]?.scrollIntoView({ block: body.hasAttribute('data-listening') ? 'center' : 'start', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    }
  }

  function showDuration(): void {
    if (Number.isFinite(audio.duration) && audio.duration > 0) duration = audio.duration;
    seek.max = String(Math.ceil(duration));
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

  function showMini(): void {
    mini.hidden = !(open && body.hasAttribute('data-started') && !inStory());
    if (!mini.hidden) miniTime.textContent = `${clock(audio.currentTime)} / ${clock(duration)}`;
  }

  /** The next story in library order that has audio, after the open one; none at the end. */
  function nextStory(): Item | null {
    const at = open ? items.indexOf(open) : -1;
    return items.slice(at + 1).find((item) => item.entry.audio !== null) ?? null;
  }

  audio.addEventListener('play', () => {
    offline.hold();
    body.setAttribute('data-started', '');
    body.setAttribute('data-playing', '');
    if (inStory()) body.setAttribute('data-listening', '');
    showLabels();
    showTime();
    showMini();
  });
  audio.addEventListener('pause', () => {
    body.removeAttribute('data-playing');
    remember();
    showLabels();
  });
  audio.addEventListener('ended', () => {
    if (open) localPositions.clear(open.entry.route);
    const next = sleep.takeNext() ? nextStory() : null;
    if (next) goTo(next, false);
    else showLabels();
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

  /** Goes on to `next` from inside a media event, from its start: synchronously, with no
   *  await, since iOS lets the same <audio> go on only from the event's own task. */
  function goTo(next: Item, byHand: boolean): void {
    openStory(next, true);
    if (byHand) sleep.restart();
    if (inStory()) window.history.replaceState(window.history.state, '', `#${next.entry.route}`);
    play();
  }

  playButtons.forEach((button) => {
    button.addEventListener('click', () => { if (audio.paused) play(); else audio.pause(); });
  });
  startButton.addEventListener('click', play);
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

  function showSheet(): void {
    const { count, dim: dims } = sleep.settings();
    sheet.querySelectorAll('[data-sleep-count]').forEach((option) => {
      option.setAttribute('aria-checked', String(option.getAttribute('data-sleep-count') === String(count)));
    });
    dimSwitch.setAttribute('aria-checked', String(dims));
  }
  need<HTMLButtonElement>('[data-sleep-open]').addEventListener('click', () => {
    showSheet();
    sheet.showModal();
  });
  sheet.querySelectorAll('[data-sleep-count]').forEach((option) => {
    option.addEventListener('click', () => {
      const count = COUNTS.find((n) => String(n) === option.getAttribute('data-sleep-count'));
      if (count) sleep.choose({ ...sleep.settings(), count });
      showSheet();
    });
  });
  dimSwitch.addEventListener('click', () => {
    sleep.choose({ ...sleep.settings(), dim: !sleep.settings().dim });
    if (!sleep.settings().dim) clearDim();
    showSheet();
  });
  // A tap on the backdrop, outside the sheet's box, closes it.
  sheet.addEventListener('click', (event) => {
    const box = sheet.getBoundingClientRect();
    const inside = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
    if (!inside) sheet.close();
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
          if (audio.paused) play();
        });
      }
      return paragraph;
    });
    textBox.replaceChildren(...paragraphs);
    current = -1;
    showTime();
  }

  // Synchronous, so a tap or a story's end that opens a story can start it in the same task
  // (iOS). A chained story starts from its beginning, not where it was left.
  function openStory(item: Item, chained = false): void {
    if (item === open) return;
    remember();
    open = item;
    audio.pause();
    const { entry } = item;
    showReading(entry.audio !== null);
    if (entry.audio) {
      audio.src = offline.playsSaved(entry.audio) ? savedUrl(base, entry.audio) : audioUrl(base, entry.audio);
      pendingResume = chained ? null : positionFor(localPositions.read(entry.route), entry.duration)?.t ?? null;
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
    if (!chained) body.removeAttribute('data-listening');
    saveError.hidden = true;
    // Opened by hand, the sleep count starts again with this story; a pause keeps it.
    if (!chained) {
      sleep.restart();
      resetDim(false);
    }
    document.querySelectorAll('[data-story-title]').forEach((node) => { node.textContent = entry.title; });
    items.forEach(({ card }) => { card.setAttribute('aria-current', String(card === item.card)); });
    picture.replaceChildren(pictureImage(entry.picture));
    drawTile(tile, entry.picture);
    drawTile(miniArt, entry.picture);
    miniLink.href = `#${entry.route}`;
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: entry.title,
        artist: 'Jänkujutud',
        album: 'Unejänku',
        artwork: [{ src: `${base}icon-512.png`, sizes: '512x512', type: 'image/png' }],
      });
    }
    showDuration();
    showMini();
  }

  if ('mediaSession' in navigator) {
    const actions: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', play],
      ['pause', () => { audio.pause(); }],
      ['seekbackward', (details) => { skip(-(details.seekOffset ?? 15)); }],
      ['seekforward', (details) => { skip(details.seekOffset ?? 15); }],
      ['seekto', (details) => { if (details.seekTime !== undefined) audio.currentTime = details.seekTime; }],
      ['nexttrack', () => {
        const next = nextStory();
        if (next) goTo(next, true);
      }],
    ];
    for (const [action, handler] of actions) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // A browser that does not know the action throws; the others still work.
      }
    }
  }

  // One view at a time: the library, or the story whose hash the address holds. Without a
  // story's hash the library shows, with the open story (or the first) loaded in the player.
  // The query the library had when the story was opened from it, or null. Going back through
  // history is right only while it is unchanged: a language switch in between rewrites ?lang
  // in place, and the entry behind holds the old language.
  let openedFrom: string | null = null;
  function showView(): void {
    const item = itemAt(window.location.hash);
    const target = item ?? open ?? items[0];
    if (target) openStory(target);
    const view = item ? 'story' : 'library';
    if (body.getAttribute('data-view') !== view) {
      body.setAttribute('data-view', view);
      if (view === 'library') openedFrom = null;
      window.scrollTo(0, 0);
    }
    if (view === 'library') showLabels();
    showMini();
  }
  items.forEach((item) => {
    item.card.addEventListener('click', (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      openedFrom = itemAt(window.location.hash) ? null : window.location.search;
      const isHero = item === heroItem;
      openStory(item);
      // The hero's button is "listen on": it starts the story in the same tap.
      if (isHero && item.entry.audio) play();
    });
  });
  miniLink.addEventListener('click', () => {
    openedFrom = window.location.search;
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
