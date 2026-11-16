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
  more: 'Uusi jutte tuleb siia aegamööda.',
  back: 'Jänkujutud',
  credit: 'Loeb kõnesüntees <a href="https://huggingface.co/tartuNLP/XTTS-v2-est">TartuNLP XTTS v2</a> (<a href="https://huggingface.co/coqui/XTTS-v2/blob/6c2b0d75eae4b7047358e3b6bd9325f857d43f77/LICENSE.txt">Coqui avaliku mudeli litsents</a>) issi hääle järgi.',
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
  listenOn: 'Kuula edasi',
  minutesLeft: '{n} min jäänud',
  sleepTimer: 'Unetaimer',
  sleepAfter1: 'Pärast seda juttu',
  sleepAfter2: 'Pärast kahte juttu',
  sleepAfter3: 'Pärast kolme juttu',
  sleepDim: 'Ekraan tumeneb tasapisi',
  sleepNote: 'Kui viimane jutt saab läbi, jääb mängija vaikseks.',
  save: 'Hoia telefonis',
  saving: 'Salvestan…',
  saved: 'Telefonis',
  saveFailed: 'Salvestamine ei õnnestunud.',
  textFailed: 'Jutu teksti ei saanud praegu laadida.',

  headerLanguage: 'Keel',
  headerHomeLanding: 'KHE avaleht',
  headerDemo: 'Demo',
  headerDemoNoteStories: 'Mõned jutud kogust, ülejäänud jäävad perele.',
  headerDemoLink: 'Perele →',
  footerLinksLabel: 'Lehe lingid',
  footer: 'Ise majutatud Eestis',
  privacyLink: 'Privaatsus',
};

export type CopyKey = keyof typeof et;

const en: Record<CopyKey, string> = {
  title: 'Sleepy Bunny',
  appName: 'Sleepy Bunny',
  description: 'Bedtime stories about a bunny family, read aloud in Estonian.',
  more: 'New stories will come here over time.',
  back: 'Jänkujutud',
  credit: 'Read by the <a href="https://huggingface.co/tartuNLP/XTTS-v2-est">TartuNLP XTTS v2</a> speech synthesis (<a href="https://huggingface.co/coqui/XTTS-v2/blob/6c2b0d75eae4b7047358e3b6bd9325f857d43f77/LICENSE.txt">Coqui Public Model License</a>) in Dad’s voice.',
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
  listenOn: 'Continue listening',
  minutesLeft: '{n} min left',
  sleepTimer: 'Sleep timer',
  sleepAfter1: 'After this story',
  sleepAfter2: 'After two stories',
  sleepAfter3: 'After three stories',
  sleepDim: 'Dim the screen slowly',
  sleepNote: 'When the last story ends, the player goes quiet.',
  save: 'Keep on this phone',
  saving: 'Saving…',
  saved: 'On this phone',
  saveFailed: 'Saving did not work.',
  textFailed: 'The story text could not be loaded right now.',

  headerLanguage: 'Language',
  headerHomeLanding: 'KHE home',
  headerDemo: 'Demo',
  headerDemoNoteStories: 'A few stories from the collection; the rest stay with the family.',
  headerDemoLink: 'For family →',
  footerLinksLabel: 'Page links',
  footer: 'Self-hosted in Estonia',
  privacyLink: 'Privacy',
};

export const COPY: Readonly<Record<Locale, Readonly<Record<CopyKey, string>>>> = { et, en };

/** A string with its `{name}` slots filled. */
export function fill(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (slot, name: string) => (name in values ? String(values[name]) : slot));
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}
