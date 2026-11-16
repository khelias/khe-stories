# khe-stories

Workspace-wide rules (push, review, docs, estate ADRs) are in [khe-workspace
`AGENTS.md`](https://github.com/khelias/khe-workspace/blob/main/AGENTS.md).

Unejänku, the bedtime stories app: public code with invented demo stories;
the family's stories live in a private repo that builds this app at a pinned
commit and deploys it
([estate ADR-031](https://github.com/khelias/khe-architecture/blob/main/decisions/031-stories-public-app-private-stories-audio-outside-git.md)).
The app's own decisions are in [docs/decisions/](docs/decisions/)
([ADR-001](docs/decisions/001-unejanku-app.md): Vite and TypeScript without a
framework, two builds, the shell from `@khelias/ui`, one content contract, the
worker deciding by URL). The content contract is
[docs/content.md](docs/content.md).

## Layout

- `src/index.html` - the page; `build/chrome.ts` fills its markers per build.
- `src/main.ts` starts `offline.ts` (the worker's registration and saving),
  `stories.ts` (library, reading view, player) and `locale.ts`.
- `src/content.ts` - the contract's types and checks, shared with the build.
- `src/resume.ts` - where listening stopped, `unejanku:v1:pos:<route>`.
- `src/sw.ts` - the service worker; `build/sw.ts` compiles it per build.
- `src/shell.css` - the family shell restated; `src/stories.css` - the
  room's own look, outside the design check (estate ADR-028 point 1).
- `src/copy.ts` - every string, ET and EN.
- `src/builds.ts` `siteLinks` - the links the `data-link` attributes name, set
  per language by `locale.ts`; `family` is the demo line's link to
  stories.khe.ee, in the public build only
  ([estate ADR-034](https://github.com/khelias/khe-architecture/blob/main/decisions/034-the-demo-line-links-the-real-site.md)).
- `demo/` - the demo content: invented stories, no family names, no real
  places. Its audio is all rights reserved (README).
- `e2e/server.ts` - serves a build as nginx will, for e2e and `preview`.

## Commands

Node 26 (`.nvmrc`), npm.

- `npm run dev` - the public build over `demo/`; `STORIES_BUILD=family npm run dev` for the other.
- `npm run build` - typecheck, then `output/public` and `output/family`.
  `STORIES_CONTENT=<dir>` builds other content, `STORIES_OUT=<dir>` writes
  elsewhere.
- `npm run lint` - eslint and `khe-design-lint`.
- `npm run typecheck`, `npm test` (Vitest: the contract, the resume rules,
  both builds' output), `npm run test:e2e` (Playwright over a public build:
  offline, Range, the worker's update and prune, resume).
- `npm run preview` - serves `output/public` with the demo audio.

TypeScript is two packages on purpose, as in khe-trips: `@typescript/native`
(TS 7) supplies `tsc`, and `typescript` is aliased to
`@typescript/typescript6` because typescript-eslint does not support TS 7
yet.

## Rules

1. **No family content in this repo.** No child's or parent's name, no real
   place, no real story, in any commit; the private repo's content never
   comes here. Before each merge, `git grep -nwiE` and `git log -p` over the
   names the private repo lists print nothing.
2. **The contract is the interface.** A change to it updates
   `docs/content.md`, `src/content.ts` and its tests in the same commit, and
   the private repo's export follows.
3. **The worker never handles `audio/`.** Unsaved audio goes to the network
   as if there were no worker; only a listener's tap puts audio in the cache.
4. **Strings** are in `src/copy.ts` in both languages, in correct Estonian.

## Automated writers

Automated writers
([estate ADR-007](https://github.com/khelias/khe-architecture/blob/main/decisions/007-automated-writers.md)):
Renovate automerges npm patch and minor updates of stable packages, 0.x
patches of devDependencies, GitHub Actions minor and patch updates, digests,
pins and lock file maintenance (`renovate.json`), through a pull request whose
required checks pass; `@khelias/ui` is never automerged (estate ADR-014).
Nothing here deploys: the private stories repo builds the commit its
`app.ref` names. The way back from a bad update is to revert its merge on
`main` through a pull request.

## Kill-switch

If a deployed worker misbehaves, replace `sw.js` in the build's output with
this and deploy; every visitor's worker updates to it on the next visit,
removes the app's caches and unregisters itself:

```js
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith('unejanku-')) await caches.delete(name);
    await self.registration.unregister();
    for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url);
  })());
});
```

Saved audio is removed with it. Then fix the cause and ship a normal build.
