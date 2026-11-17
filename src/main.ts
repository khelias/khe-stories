import { BUILD, compose, stories } from 'virtual:stories';
import { siteLinks } from './builds.ts';
import { startCompose } from './compose.ts';
import { COPY, type CopyKey, type Locale } from './copy.ts';
import { startLocale } from './locale.ts';
import { COMPOSE_HASH } from './offline-names.ts';
import { startOffline } from './offline.ts';
import { startStories } from './stories.ts';

const base = import.meta.env.BASE_URL;
let active: Locale = 'et';
const text = (key: CopyKey) => COPY[active][key];

const offline = await startOffline(base, BUILD);
const view = compose ? startCompose(compose, text) : null;
const player = startStories({ base, stories, text, offline, composeHash: view ? COMPOSE_HASH : null });
startLocale(siteLinks(BUILD), (locale) => {
  active = locale;
  player.showLabels();
  view?.showLabels();
});
