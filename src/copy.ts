// Every string the app shows, in both languages. The build renders the header and footer in
// Estonian from these (build/chrome.ts) and the page switches language from them at run time
// (src/locale.ts). Header and footer strings restate khe-sites' SITE_HEADER_COPY and
// SITE_FOOTER_COPY, which this app does not import.

export const LOCALES = ['et', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

const et = {
  title: 'Unejänku',
  appName: 'Unejänku',
  description: 'Unejutud jänkuperest, ette loetud.',
  seriesNote: 'Unejutud ühest jänkuperest',
  more: 'Uusi jutte tuleb siia aegamööda.',
  back: 'Jänkujutud',
  credit: 'Loeb kõnesüntees <a href="https://huggingface.co/cbentes/pocket-tts-estonian">Pocket TTS Estonian</a> issi hääle järgi.',
  aiVoice: 'Ette loeb tehisintellekti hääl.',
  noReading: 'Ettelugemist praegu ei ole.',
  readOnly: 'Loe',
  playerLabel: 'Mängija',
  seek: 'Koht jutus',
  back15: '15 sekundit tagasi',
  forward15: '15 sekundit edasi',
  play: 'Kuula',
  pause: 'Paus',
  minutes: '{n} minutit',
  minutesShort: '{n} min',
  resume: 'Jätka {t}',
  save: 'Hoia telefonis',
  saving: 'Salvestan…',
  saved: 'Telefonis',
  saveFailed: 'Salvestamine ei õnnestunud.',
  textFailed: 'Jutu teksti ei saanud praegu laadida.',

  headerLanguage: 'Keel',
  headerHomeLanding: 'KHE avaleht',
  headerHomeKheEe: 'KHE.ee avaleht',
  headerDemo: 'Demo',
  headerDemoNoteStories: 'Mõned jutud kogust, ülejäänud jäävad perele.',
  footerLinksLabel: 'Lehe lingid',
  footer: 'Ise majutatud Eestis',
  privacyLink: 'Privaatsus',
};

export type CopyKey = keyof typeof et;

const en: Record<CopyKey, string> = {
  title: 'Sleepy Bunny',
  appName: 'Sleepy Bunny',
  description: 'Bedtime stories about a bunny family, read aloud in Estonian.',
  seriesNote: 'Bedtime stories about a bunny family, in Estonian',
  more: 'New stories will come here over time.',
  back: 'Jänkujutud',
  credit: 'Read by the <a href="https://huggingface.co/cbentes/pocket-tts-estonian">Pocket TTS Estonian</a> speech synthesis in Dad’s voice.',
  aiVoice: 'Read aloud by an AI voice.',
  noReading: 'The reading is not available right now.',
  readOnly: 'Read',
  playerLabel: 'Player',
  seek: 'Position in the story',
  back15: '15 seconds back',
  forward15: '15 seconds forward',
  play: 'Play',
  pause: 'Pause',
  minutes: '{n} minutes',
  minutesShort: '{n} min',
  resume: 'Continue {t}',
  save: 'Keep on this phone',
  saving: 'Saving…',
  saved: 'On this phone',
  saveFailed: 'Saving did not work.',
  textFailed: 'The story text could not be loaded right now.',

  headerLanguage: 'Language',
  headerHomeLanding: 'KHE home',
  headerHomeKheEe: 'KHE.ee home',
  headerDemo: 'Demo',
  headerDemoNoteStories: 'A few stories from the collection; the rest stay with the family.',
  footerLinksLabel: 'Page links',
  footer: 'Self-hosted in Estonia',
  privacyLink: 'Privacy',
};

export const COPY: Readonly<Record<Locale, Readonly<Record<CopyKey, string>>>> = { et, en };

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}
