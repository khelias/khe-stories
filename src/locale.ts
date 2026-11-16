import { setRoomsLocale } from '@khelias/ui/rooms';
import { COPY, isLocale, type CopyKey, type Locale } from './copy.ts';
import { storage } from './storage.ts';

// The language the visitor chose, the key every khe.ee page shares on its origin.
const STORAGE_KEY = 'app_locale';

function initialLocale(): Locale {
  const params = new URLSearchParams(window.location.search);
  const asked = params.get('lang') ?? params.get('locale');
  if (isLocale(asked)) return asked;
  const kept = storage.get(STORAGE_KEY);
  return isLocale(kept) ? kept : 'et';
}

function each(selector: string, apply: (node: Element, key: CopyKey) => void, attribute: string): void {
  document.querySelectorAll(selector).forEach((node) => {
    const key = node.getAttribute(attribute) as CopyKey | null;
    if (key) apply(node, key);
  });
}

/**
 * Shows the page in the language from `?lang`, then the stored choice, then Estonian, and
 * switches it from the header's buttons: every `data-i18n*` node, the head's title and
 * descriptions, the header's rooms menu and the `data-link` hrefs from `links`.
 */
export function startLocale(links: Readonly<Record<string, (locale: Locale) => string>>, onChange: (locale: Locale) => void): void {
  // iOS Safari applies :active only once the page listens for touchstart.
  document.addEventListener('touchstart', () => {}, { passive: true });
  const builtLocale = document.documentElement.lang;
  function apply(locale: Locale): void {
    const copy = COPY[locale];
    if (document.querySelector('.site-header__rooms') && (locale !== builtLocale || document.documentElement.lang !== locale)) {
      setRoomsLocale(document, locale);
    }
    document.documentElement.lang = locale;
    document.title = copy.title;
    for (const selector of ['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]']) {
      document.querySelector(selector)?.setAttribute('content', copy.description);
    }
    for (const selector of ['meta[property="og:title"]', 'meta[name="twitter:title"]']) {
      document.querySelector(selector)?.setAttribute('content', copy.title);
    }
    storage.set(STORAGE_KEY, locale);
    const url = new URL(window.location.href);
    url.searchParams.set('lang', locale);
    url.searchParams.delete('locale');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);

    each('[data-i18n]', (node, key) => { node.textContent = copy[key]; }, 'data-i18n');
    each('[data-i18n-html]', (node, key) => { node.innerHTML = copy[key]; }, 'data-i18n-html');
    each('[data-i18n-aria]', (node, key) => { node.setAttribute('aria-label', copy[key]); }, 'data-i18n-aria');
    document.querySelectorAll('[data-lang-option]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.getAttribute('data-lang-option') === locale));
    });
    document.querySelectorAll('[data-link]').forEach((anchor) => {
      const href = links[anchor.getAttribute('data-link') ?? '']?.(locale);
      if (href) anchor.setAttribute('href', href);
    });
    onChange(locale);
  }

  document.querySelectorAll('[data-lang-option]').forEach((button) => {
    button.addEventListener('click', () => {
      const locale = button.getAttribute('data-lang-option');
      if (isLocale(locale)) apply(locale);
    });
  });
  apply(initialLocale());
}
