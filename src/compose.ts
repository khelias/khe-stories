// The compose view, `#uus-jutt`, in the family build only (estate ADR-037): a child asks for a
// story, written by her or told as an idea, and sees how her requests are getting on. A parent
// pairs the phone first with the family phrase (estate ADR-038). The request service is under
// /api/ on the same origin (docs/decisions/002).
import { CLIP_MAX, RECORD_SECONDS, TEXT_MAX, type ClipType, type RequestState } from '../server/contract.ts';
import { fill, type CopyKey } from './copy.ts';
import type { Compose, ComposeChoice } from './content.ts';
import { COMPOSE_HASH } from './offline-names.ts';
import { clock, need } from './stories.ts';

type Me = { paired: true; child: string; minutesPerStory: number } | { paired: false; children: string[] };
type Mode = 'oma' | 'idee';

interface Recent {
  readonly id: string;
  readonly state: RequestState;
  readonly kind: string;
  readonly title: string | null;
  readonly route: string | null;
}

const STATE_KEYS: Record<RequestState, CopyKey> = {
  queued: 'stateQueued',
  running: 'stateRunning',
  committed: 'stateCommitted',
  ready: 'stateReady',
  failed: 'stateFailed',
};

/** The service's refusal codes the child can do something about; anything else is errFailed. */
const ERROR_KEYS: Record<string, CopyKey> = {
  day: 'errDay',
  month: 'errMonth',
  queue: 'errQueue',
  speech: 'errSpeech',
  phrase: 'pairWrong',
  tries: 'pairTries',
};

class ApiError extends Error {
  readonly status: number;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
  }
}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  // nginx answers its own refusals (413, 429, 502) with HTML; only the service's are JSON.
  const isJson = (response.headers.get('content-type') ?? '').startsWith('application/json');
  const json = (isJson ? await response.json() : null) as (T & { error?: string }) | null;
  if (!response.ok) throw new ApiError(response.status, json?.error ?? 'server');
  return json as T;
}

const errorKey = (error: unknown): CopyKey => (error instanceof ApiError ? ERROR_KEYS[error.message] : undefined) ?? 'errFailed';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attributes: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  node.append(...children);
  return node;
}

/** A label that follows the language: locale.ts fills every `data-i18n` node on a switch. */
const label = <K extends keyof HTMLElementTagNameMap>(tag: K, key: CopyKey, text: (key: CopyKey) => string, attributes: Record<string, string> = {}) =>
  el(tag, { ...attributes, 'data-i18n': key }, text(key));

/** A row of choices as radio buttons or checkboxes, the same look either way. */
function chips(name: string, choices: readonly ComposeChoice[], multiple: boolean, required = false): HTMLElement {
  return el('div', { class: 'compose-chips' }, ...choices.map((choice) => el('label', { class: 'compose-chip' },
    el('input', { type: multiple ? 'checkbox' : 'radio', name, value: choice.id, ...(required ? { required: '' } : {}) }),
    el('span', {}, choice.name))));
}

/** The recording's type as the service and Gemini name it: Safari records MPEG-4 audio. */
function clipType(type: string): ClipType | null {
  if (type.startsWith('audio/mp4')) return 'audio/m4a';
  if (type.startsWith('audio/webm')) return 'audio/webm';
  return null;
}

async function base64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function keyBytes(key: string): Uint8Array<ArrayBuffer> {
  const raw = atob(key.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

const standalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
const pushable = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export interface ComposeView {
  /** Labels that are not plain `data-i18n` text, after a language switch. */
  readonly showLabels: () => void;
}

export function startCompose(compose: Compose, text: (key: CopyKey) => string): ComposeView {
  const app = need('.stories-app');
  const shelf = need('[data-shelf]');
  const nameOf = (id: string) => compose.kinds.find((kind) => kind.id === id)?.name ?? id;

  shelf.querySelector('h2')?.after(el('a', { class: 'compose-link', href: COMPOSE_HASH },
    el('span', { class: 'compose-link-plus', 'aria-hidden': 'true' }, '+'), label('span', 'composeLink', text)));

  // Pairing.
  const phrase = el('input', { type: 'text', name: 'phrase', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', required: '', maxlength: '200' });
  const who = el('div', { class: 'compose-chips' });
  const pairError = el('p', { class: 'compose-error', role: 'alert' });
  const pairForm = el('form', { class: 'compose-panel', 'data-compose-pair': '' },
    label('h2', 'pairTitle', text),
    label('p', 'pairNote', text, { class: 'compose-note' }),
    ...(standalone() ? [] : [label('p', 'pairInstall', text, { class: 'compose-note' })]),
    el('label', { class: 'compose-field' }, label('span', 'pairPhrase', text), phrase),
    el('fieldset', { class: 'compose-field' }, label('legend', 'pairWho', text), who),
    pairError,
    label('button', 'pairButton', text, { class: 'pill', type: 'submit' }));

  // The request.
  const hello = el('h2', {});
  const modes = el('div', { class: 'compose-modes', role: 'radiogroup' }, ...(['oma', 'idee'] as const).map((mode) =>
    el('button', { type: 'button', role: 'radio', 'aria-checked': 'false', 'data-mode': mode, class: 'compose-mode' },
      label('strong', mode === 'oma' ? 'modeOwn' : 'modeIdea', text),
      label('span', mode === 'oma' ? 'modeOwnNote' : 'modeIdeaNote', text))));
  const kinds = el('fieldset', { class: 'compose-field' }, label('legend', 'kindLabel', text), chips('kind', compose.kinds, false, true));
  const cast = el('fieldset', { class: 'compose-field', 'data-idea': '' }, label('legend', 'castLabel', text), chips('cast', compose.cast, true));
  const places = el('fieldset', { class: 'compose-field', 'data-idea': '' }, label('legend', 'placeLabel', text), chips('place', compose.places, false));
  const recordButton = el('button', { type: 'button', class: 'compose-record' });
  const recordState = el('p', { class: 'compose-note', role: 'status' });
  const recorder = el('div', { class: 'compose-recorder', 'data-idea': '' }, recordButton, recordState);
  const textLabel = el('span', {});
  const words = el('textarea', { name: 'text', rows: '8', maxlength: String(TEXT_MAX) });
  const sendError = el('p', { class: 'compose-error', role: 'alert' });
  const sendButton = el('button', { class: 'pill', type: 'submit' });
  const requestForm = el('form', { class: 'compose-panel', 'data-compose-request': '' },
    hello, modes, kinds, cast, places, recorder, el('label', { class: 'compose-field' }, textLabel, words), sendError, sendButton);

  // After sending.
  const sentNote = el('p', { class: 'compose-sent-note' });
  const notifyButton = label('button', 'notify', text, { class: 'pill', type: 'button' });
  const notifyState = el('p', { class: 'compose-note', role: 'status' });
  const sent = el('div', { class: 'compose-panel', 'data-compose-sent': '' }, sentNote, notifyButton, notifyState);

  const recentList = el('ul', { class: 'compose-recent-list' });
  const recent = el('section', { class: 'compose-recent', 'data-compose-recent': '' }, label('h2', 'recent', text), recentList);
  const unpair = label('button', 'unpair', text, { class: 'compose-unpair', type: 'button' });
  const loadError = el('p', { class: 'compose-error', role: 'alert' });

  const view = el('section', { class: 'compose', 'aria-labelledby': 'compose-title', 'data-compose': '' },
    el('div', { class: 'compose-bar' },
      // The story page's back button: stories.ts takes it back to the library.
      el('a', { class: 'glass-button', href: './', 'aria-label': text('back'), 'data-i18n-aria': 'back', 'data-story-close': '' }),
      label('h1', 'composeTitle', text, { id: 'compose-title' })),
    loadError, pairForm, requestForm, sent, recent, unpair);
  const back = view.querySelector('[data-story-close]');
  if (back) back.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M15 5l-7 7 7 7"/></svg>';
  app.append(view);

  let me: Me | null = null;
  let mode: Mode | null = null;
  let minutes = 0;
  let requests: Recent[] = [];
  let clip: { blob: Blob; seconds: number } | null = null;
  let recording: { recorder: MediaRecorder; started: number; timer: number } | null = null;
  let sending = false;
  let errors: Partial<Record<'load' | 'pair' | 'send', CopyKey>> = {};

  function show(): void {
    const paired = me?.paired === true;
    pairForm.hidden = me === null || paired;
    requestForm.hidden = !paired || minutes > 0;
    sent.hidden = !paired || minutes === 0;
    recent.hidden = !paired || !requests.length;
    unpair.hidden = !paired;
    if (me && !me.paired && who.childElementCount !== me.children.length) {
      who.replaceChildren(...me.children.map((child) => el('label', { class: 'compose-chip' },
        el('input', { type: 'radio', name: 'child', value: child, required: '' }), el('span', {}, child))));
    }
    if (me?.paired) hello.textContent = fill(text('hello'), { name: me.child });
    modes.querySelectorAll('[data-mode]').forEach((button) => { button.setAttribute('aria-checked', String(button.getAttribute('data-mode') === mode)); });
    for (const part of [kinds, words.parentElement, sendButton]) if (part) part.hidden = mode === null;
    requestForm.querySelectorAll<HTMLElement>('[data-idea]').forEach((part) => { part.hidden = mode !== 'idee'; });
    textLabel.textContent = text(mode === 'idee' ? 'ideaText' : 'ownText');
    words.required = mode === 'oma';
    showRecorder();
    sendButton.textContent = text(sending ? 'sending' : 'send');
    sendButton.disabled = sending || recording !== null;
    sentNote.textContent = fill(text('sent'), { n: minutes });
    showNotify();
    loadError.textContent = errors.load ? text(errors.load) : '';
    pairError.textContent = errors.pair ? text(errors.pair) : '';
    sendError.textContent = errors.send ? text(errors.send) : '';
    loadError.hidden = !errors.load;
    recentList.replaceChildren(...requests.map((request) => {
      const name = request.state === 'ready' && request.route && request.title
        ? el('a', { href: `#${request.route}`, lang: 'et' }, request.title)
        : el('span', { lang: 'et' }, nameOf(request.kind));
      return el('li', { 'data-state': request.state }, name, el('span', { class: 'compose-state' }, text(STATE_KEYS[request.state])));
    }));
  }

  function showRecorder(): void {
    recordButton.textContent = text(recording ? 'recordStop' : clip ? 'recordAgain' : 'record');
    recordButton.toggleAttribute('data-recording', recording !== null);
    recordState.textContent = recording ? fill(text('recording'), { t: clock((Date.now() - recording.started) / 1000) }) : clip ? fill(text('recorded'), { t: clock(clip.seconds) }) : '';
  }

  function showNotify(): void {
    const can = pushable();
    const permission = can ? Notification.permission : 'denied';
    notifyButton.hidden = !can || permission !== 'default';
    notifyState.hidden = !can || permission === 'default';
    notifyState.textContent = text(permission === 'granted' ? 'notifyOn' : 'notifyDenied');
  }

  async function load(): Promise<void> {
    try {
      // Both at once; the list answers 401 on a phone that is not paired, and is then not needed.
      const list = api<{ requests: Recent[] }>('GET', 'requests').catch(() => ({ requests: [] }));
      me = await api<Me>('GET', 'me');
      requests = (await list).requests;
      delete errors.load;
      if (me.paired && pushable() && Notification.permission === 'granted') void subscribe().catch(() => undefined);
    } catch (error) {
      errors.load = errorKey(error);
    }
    show();
  }

  async function subscribe(): Promise<void> {
    const registration = await navigator.serviceWorker.ready;
    const subscription = (await registration.pushManager.getSubscription())
      ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes((await api<{ key: string }>('GET', 'push/key')).key) });
    await api('POST', 'push', { endpoint: subscription.endpoint });
  }

  pairForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const child = new FormData(pairForm).get('child');
    void api<Me>('POST', 'pair', { phrase: phrase.value, child })
      .then((paired) => {
        me = paired;
        phrase.value = '';
        errors = {};
        return load();
      })
      .catch((error: unknown) => {
        errors.pair = errorKey(error);
        show();
      });
  });

  modes.addEventListener('click', (event) => {
    const button = (event.target as Element).closest('[data-mode]');
    if (!button) return;
    mode = button.getAttribute('data-mode') as Mode;
    show();
  });

  function stopRecording(): void {
    if (!recording) return;
    window.clearInterval(recording.timer);
    recording.recorder.stop();
  }

  recordButton.addEventListener('click', () => {
    if (recording) {
      stopRecording();
      return;
    }
    delete errors.send;
    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      const type = ['audio/mp4', 'audio/webm'].find((each) => MediaRecorder.isTypeSupported(each));
      const media = new MediaRecorder(stream, type ? { mimeType: type } : {});
      const parts: Blob[] = [];
      media.addEventListener('dataavailable', (event) => { parts.push(event.data); });
      media.addEventListener('stop', () => {
        stream.getTracks().forEach((track) => { track.stop(); });
        const blob = new Blob(parts, { type: media.mimeType });
        const seconds = recording ? Math.min(RECORD_SECONDS, (Date.now() - recording.started) / 1000) : 0;
        recording = null;
        clip = clipType(blob.type) && blob.size <= CLIP_MAX ? { blob, seconds } : null;
        if (!clip) errors.send = 'errMic';
        show();
      });
      const started = Date.now();
      const timer = window.setInterval(() => {
        if (Date.now() - started >= RECORD_SECONDS * 1000) stopRecording();
        else showRecorder();
      }, 250);
      recording = { recorder: media, started, timer };
      media.start();
      show();
    }).catch(() => {
      errors.send = 'errMic';
      show();
    });
  });

  requestForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!mode || sending) return;
    const form = new FormData(requestForm);
    const typed = words.value.trim();
    if (!typed && !(mode === 'idee' && clip)) {
      words.focus();
      return;
    }
    sending = true;
    delete errors.send;
    show();
    void (async () => {
      const recorded = mode === 'idee' && clip ? { data: await base64(clip.blob), type: clipType(clip.blob.type) } : undefined;
      const body = mode === 'idee'
        ? { mode, kind: form.get('kind'), place: form.get('place') ?? '', cast: form.getAll('cast'), text: typed, clip: recorded }
        : { mode, kind: form.get('kind'), text: typed };
      const answer = await api<{ id: string; minutes: number }>('POST', 'requests', body);
      minutes = answer.minutes;
      requestForm.reset();
      clip = null;
      mode = null;
      requests = (await api<{ requests: Recent[] }>('GET', 'requests')).requests;
    })().catch((error: unknown) => {
      errors.send = errorKey(error);
    }).finally(() => {
      sending = false;
      show();
    });
  });

  notifyButton.addEventListener('click', () => {
    void Notification.requestPermission()
      .then((permission) => (permission === 'granted' ? subscribe() : undefined))
      .catch(() => undefined)
      .finally(show);
  });

  unpair.addEventListener('click', () => {
    if (!window.confirm(text('unpairConfirm'))) return;
    void api('DELETE', 'pair').catch(() => undefined).finally(() => {
      me = null;
      requests = [];
      minutes = 0;
      return load();
    });
  });

  // Each time the view opens: what the service knows now, and a fresh form.
  const opened = () => {
    if (window.location.hash !== COMPOSE_HASH) return;
    minutes = 0;
    void load();
  };
  window.addEventListener('hashchange', opened);
  opened();
  show();
  return { showLabels: show };
}
