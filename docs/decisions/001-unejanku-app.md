# ADR-001: Unejänku is a Vite and TypeScript app without a framework, shelled by @khelias/ui, fed through one content contract

- **Status:** Accepted (2026-11-16)
- **Related:** [estate ADR-031](https://github.com/khelias/khe-architecture/blob/main/decisions/031-stories-public-app-private-stories-audio-outside-git.md) (why the code is here and the stories are not), [estate ADR-028](https://github.com/khelias/khe-architecture/blob/main/decisions/028-the-stories-room-keeps-its-own-look.md) (its own look), [estate ADR-030](https://github.com/khelias/khe-architecture/blob/main/decisions/030-the-portfolio-frame-and-the-product-view.md) (the product view), [estate ADR-021](https://github.com/khelias/khe-architecture/blob/main/decisions/021-family-shell-and-design-check.md) (the family shell and the design check)

## Context

Unejänku started as one static page in khe-sites, `/stories/`: an HTML file,
a plain script and a stylesheet, the header and footer filled in by
khe-sites' own build. Estate ADR-031 moves it into a repo of its own that a
private repo builds with its stories, and adds what a page in khe-sites could
not have: two builds from one source, a listener's position per story, and a
service worker that keeps the shell, the texts and the saved audio offline.

The page is small: a library, a reading view and a player. It needs no
component model, and its state is one open story and one audio element.

## Decision

1. **Vite with TypeScript and no framework**, the khe-trips toolchain without
   React: `tsc` from TypeScript 7 for the typecheck, type-aware
   typescript-eslint on the TypeScript 6 alias, Vitest, Playwright. The page
   is `src/index.html` with the markup, and plain modules wire it.
2. **Two builds from one source**, picked by `STORIES_BUILD`. `public` is a
   product page of khe.ee under `/stories/` with the frame and the product
   view, the demo line and the consent banner from the origin root. `family`
   is at the root of its own host, shows only the product view, set on
   `<html>`, and has no analytics and no indexing. Neither has source maps.
3. **The shell comes from `@khelias/ui`**: the header and footer are rendered
   into `index.html` at build time by `renderSiteHeader` and
   `renderSiteFooter`, and the product view by `viewInitScript`. What the page
   took from khe-sites, the dark family tokens, the header and footer values
   and the base rules of `site.css`, is restated in `src/shell.css`, as
   khe-trips restates its own; no khe-sites file is copied or imported. The
   language switch (`src/locale.ts`) keeps khe-sites' behaviour: the
   `app_locale` key, `?lang`, `data-i18n*` and `setRoomsLocale`.
4. **One content contract**, `docs/content.md`: a `catalog.json` and a
   `stories/<route>.json` per story, audio addressed by its sha256 and never
   bundled. It is the only thing the private repo's tools and this app share;
   either side can change as long as the contract holds, and `src/content.ts`
   checks it at every build.
5. **The service worker decides by URL alone**: `audio/` is never handled,
   `saved/` only from Cache Storage with `workbox-range-requests` slicing the
   stored file, navigations network first, the shell and the texts from a
   cache named by the build's content hash. A new worker takes over at once
   only on a page that has just opened and played nothing.

## Alternatives considered

- **Keep the plain script and khe-sites' build.** Two builds, a content hash
  for the worker and the content checks would each need a script of their
  own; Vite gives all three.
- **React, as khe-trips.** Nothing on the page re-renders but a list of cards
  and a list of paragraphs; React would be most of the bundle.
- **Fetch `catalog.json` at run time.** The page would wait on a request
  before it could draw a card; the catalog in the bundle is one request
  fewer, and the bundle's hash already changes with it.

## Consequences

- The look is this repo's (estate ADR-028 point 1). `src/stories.css` and the
  drawings are outside the design check; `src/shell.css` is inside it.
- A change to the shell's values in khe-sites does not reach this app by
  itself; it is restated here when wanted, as in khe-trips.
- Any change to the content contract is a change on both sides: this repo
  first, then the private repo's export, then its pinned commit.
