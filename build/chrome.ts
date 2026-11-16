import type { Plugin } from 'vite';
import { escapeHtml, renderSiteHeader } from '@khelias/ui/site-header';
import { renderSiteFooter } from '@khelias/ui/site-footer';
import { viewInitScript } from '@khelias/ui/view';
import { BUILDS, PAPER, siteLinks } from '../src/builds.ts';
import { COPY, type CopyKey } from '../src/copy.ts';
import type { BuildName } from '../src/content.ts';

// The public build is a product page of khe.ee (estate ADR-030); the family build on
// stories.khe.ee shows only the product view, set on <html> (estate ADR-031).
const PUBLIC_URL = `https://khe.ee${BUILDS.public.base}`;
// Cloudflare Web Analytics' site token, public by design: the beacon sends it from every page.
const ANALYTICS_TOKEN = '58734ed4ae1e4b4e8a8f8f7d50ff74f2';
export const MARKERS = ['stories-head', 'site-view', 'site-header', 'site-footer'] as const;

const et = (key: CopyKey): string => COPY.et[key];
/** The same, for an attribute value or text in the head. */
const etHtml = (key: CopyKey): string => escapeHtml(et(key));

function head(build: BuildName): string {
  const { base, frame } = BUILDS[build];
  const icons = [
    `<link rel="icon" href="${base}icon.svg" type="image/svg+xml" sizes="any">`,
    `<link rel="apple-touch-icon" href="${base}icon-180.png">`,
  ];
  if (!frame) {
    return [
      '<meta name="robots" content="noindex, nofollow">',
      ...icons,
      `<link rel="manifest" href="${base}manifest.webmanifest" crossorigin="use-credentials">`,
    ].join('\n  ');
  }
  return [
    `<link rel="canonical" href="${PUBLIC_URL}">`,
    `<link rel="alternate" hreflang="et" href="${PUBLIC_URL}?lang=et">`,
    `<link rel="alternate" hreflang="en" href="${PUBLIC_URL}?lang=en">`,
    `<link rel="alternate" hreflang="x-default" href="${PUBLIC_URL}">`,
    ...icons,
    `<link rel="manifest" href="${base}manifest.webmanifest">`,
    '<meta property="og:type" content="website">',
    `<meta property="og:url" content="${PUBLIC_URL}">`,
    '<meta property="og:site_name" content="Kaido Henrik Elias">',
    `<meta property="og:title" content="${etHtml('title')}">`,
    `<meta property="og:description" content="${etHtml('description')}">`,
    '<meta property="og:image" content="https://khe.ee/og-image.png">',
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    '<meta name="twitter:card" content="summary">',
    `<meta name="twitter:title" content="${etHtml('title')}">`,
    `<meta name="twitter:description" content="${etHtml('description')}">`,
    '<meta name="twitter:image" content="https://khe.ee/og-image.png">',
    // The consent banner from the origin root, as every khe.ee page loads it (estate ADR-019).
    `<script vite-ignore defer src="/assets/analytics-consent.js" data-analytics-token="${ANALYTICS_TOKEN}" data-analytics-privacy-url="/privacy?lang=et"></script>`,
  ].join('\n  ');
}

function header(build: BuildName, indent: string): string {
  const { base, frame } = BUILDS[build];
  const homeKey = frame ? 'headerHomeLanding' : 'headerHomeKheEe';
  return renderSiteHeader({
    brand: { href: siteLinks(build).home('et'), label: et(homeKey) },
    rooms: frame ? { current: 'stories', locale: 'et' } : undefined,
    context: { title: et('appName') },
    demo: frame
      ? { label: et('headerDemo'), note: et('headerDemoNoteStories'), link: { href: siteLinks(build).family('et'), label: et('headerDemoLink') } }
      : undefined,
    product: frame ? { root: base } : undefined,
    locales: [
      { code: 'et', label: 'ET' },
      { code: 'en', label: 'EN' },
    ],
    activeLocale: 'et',
    languageLabel: et('headerLanguage'),
    indent,
    attrs: {
      brand: { 'data-link': 'home', 'data-i18n-aria': homeKey },
      title: { 'data-i18n': 'appName' },
      ...(frame && {
        demoLabel: { 'data-i18n': 'headerDemo' },
        demoText: { 'data-i18n': 'headerDemoNoteStories' },
        demoLink: { 'data-i18n': 'headerDemoLink', 'data-link': 'family' },
      }),
      switcher: { 'data-i18n-aria': 'headerLanguage' },
    },
  });
}

function footer(build: BuildName, indent: string): string {
  const links = siteLinks(build);
  return renderSiteFooter({
    label: et('footerLinksLabel'),
    home: { label: 'KHE.ee', href: links.home('et'), attrs: { 'data-link': 'home' } },
    links: [
      { label: 'GitHub', href: 'https://github.com/khelias', icon: 'github' },
      { label: 'LinkedIn', href: 'https://www.linkedin.com/in/kaido-henrik-elias/', icon: 'linkedin' },
      { label: et('privacyLink'), href: links.privacy('et'), attrs: { 'data-link': 'privacy', 'data-i18n': 'privacyLink' } },
    ],
    lines: [{ text: et('footer'), attrs: { 'data-i18n': 'footer' } }],
    attrs: { nav: { 'data-i18n-aria': 'footerLinksLabel' } },
    indent,
  });
}

function manifest(base: string): string {
  const icon = (size: number) => ({ src: `${base}icon-${String(size)}.png`, sizes: `${String(size)}x${String(size)}`, type: 'image/png' });
  return `${JSON.stringify(
    {
      name: et('appName'),
      short_name: et('appName'),
      description: et('description'),
      lang: 'et',
      id: base,
      start_url: base,
      scope: base,
      display: 'standalone',
      background_color: PAPER,
      theme_color: PAPER,
      icons: [icon(180), { ...icon(512), purpose: 'any maskable' }],
    },
    null,
    2,
  )}\n`;
}

const marker = (name: string) => new RegExp(`^([ \\t]*)<!-- ${name} -->$`, 'm');

/** The build's site files: index.html's markers filled (its head, the view script before the
 *  first stylesheet, the header and the footer), the web app manifest and, where the build
 *  is not indexed, a robots.txt. A marker left unfilled fails the build. */
export function chromePlugin(build: BuildName): Plugin {
  const { base, frame } = BUILDS[build];
  return {
    name: 'stories-chrome',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const filled = html
          .replace(/<html lang="et"/, frame ? '<html lang="et"' : '<html lang="et" data-khe-view="product"')
          .replace(marker('stories-head'), (_, indent: string) => `${indent}${head(build)}`)
          .replace(marker('site-view'), (_, indent: string) => (frame ? `${indent}<script>${viewInitScript(base)}</script>` : ''))
          .replace(marker('site-header'), (_, indent: string) => header(build, indent))
          .replace(marker('site-footer'), (_, indent: string) => footer(build, indent));
        const left = MARKERS.find((name) => filled.includes(`<!-- ${name} -->`));
        if (left) throw new Error(`index.html: the ${left} marker was not filled`);
        return filled;
      },
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: manifest(base) });
      if (!frame) this.emitFile({ type: 'asset', fileName: 'robots.txt', source: 'User-agent: *\nDisallow: /\n' });
    },
  };
}
