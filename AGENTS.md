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

- `src/index.html` - the page; `build/chrome.ts` fills its markers per build:
  the family header and footer in the public build, the app's own
  (`renderStoriesHeader`, `renderStoriesFooter`) in the family build
  ([estate ADR-035](https://github.com/khelias/khe-architecture/blob/main/decisions/035-family-shell-and-design-check-with-its-exceptions.md) point 12).
- `src/main.ts` starts `offline.ts` (the worker's registration and saving),
  `stories.ts` (library with its hero and grid, the story page that turns into
  the listening view, the mini player) and `locale.ts`.
- `src/sleep.ts` - the sleep counter, `unejanku:v1:sleep`: how many stories
  play in a row (the next one in library order, from `stories.ts`'s `ended`
  handler) and the dim over the last one's final minute.
- `src/content.ts` - the contract's types and checks, shared with the build,
  `checkArt` among them: the allowlist every story picture passes
  ([estate ADR-031](https://github.com/khelias/khe-architecture/blob/main/decisions/031-stories-public-app-private-stories-audio-outside-git.md)
  point 13),
  and `checkWebp` for the raster pictures of the children's shelf
  ([estate ADR-037](https://github.com/khelias/khe-architecture/blob/main/decisions/037-childrens-stories-are-made-by-an-unattended-job.md)).
- `src/art.ts` - a story's picture as an `<img>`; `src/art/night.svg` is the
  fallback scene for a story without one.
- `src/compose.ts` - the compose view, `#uus-jutt`, in the family build only
  when its content has `compose.json`: pairing the phone, a child's request,
  the recording of her idea, her recent requests and the notification
  permission. It talks to `server/` under `/api/`.
- `src/resume.ts` - where listening stopped, `unejanku:v1:pos:<route>`.
- `src/sw.ts` - the service worker; `build/sw.ts` compiles it per build. A
  push wakes it with no payload, and it asks `/api/notices` what to show;
  `src/notices.ts` shows the newest notice of each story.
- `public/icon.svg` - the app icon's master. `icon-180.png` (opaque, for iOS),
  `icon-192.png` and `icon-512.png` are rendered from it with `rsvg-convert`,
  and `icon-maskable-512.png` from its artwork at 80% on the same background
  ([estate ADR-041](https://github.com/khelias/khe-architecture/blob/main/decisions/041-installed-apps-stay-on-their-paths-with-a-worker-each.md)).
- `src/shell.css` - the family shell restated, in Familjen Grotesk
  ([khe-sites `DESIGN.md` "Typography"](https://github.com/khelias/khe-sites/blob/main/DESIGN.md#typography));
  `src/stories.css` - the room's own look with its Source Serif 4 faces,
  outside the design check (estate ADR-035 point 10).
- `src/copy.ts` - every string, ET and EN.
- `src/builds.ts` `siteLinks` - the links the `data-link` attributes name, set
  per language by `locale.ts`; `family` is the demo line's link to
  stories.khe.ee, in the public build only
  ([khe-ui ADR-006](https://github.com/khelias/khe-ui/blob/main/docs/decisions/006-the-demo-line-links-the-real-site.md)).
- `demo/` - the demo content: invented stories, no family names, no real
  places, and their pictures in `demo/art/`. Its audio is all rights
  reserved (`demo/audio/LICENSE`).
- `e2e/server.ts` - serves a build as nginx will, for e2e and `preview`.
  The e2e family build adds `e2e/compose.json` to the demo content.
- `server/` - the request service
  ([ADR-002](docs/decisions/002-a-request-service-beside-the-app.md)):
  TypeScript that Node 26 runs as written, no dependencies. `app.ts` the
  routes, `service.ts` the queue, the job's report and the deploy's notices,
  `store.ts` the SQLite state, `auth.ts` pairing
  ([estate ADR-038](https://github.com/khelias/khe-architecture/blob/main/decisions/038-a-childs-device-is-paired-once-by-a-parent.md)),
  `push.ts` Web Push, `outbound.ts` GitHub and Gemini, `contract.ts` the
  limits and states the page and the worker share with it, `notify.ts` the
  command the stories job and the operator run in its container. A story's
  text is on the shelf once the family build's `catalog.json`, mounted
  read-only, lists it, and its reading once the entry has audio; the next
  request starts only after that.
  Its settings are in `server/.env.example`; the family's names and phrase
  are only in the homelab's `.env`.
- `reader/` - reads a story aloud (estate ADR-031 point 14): `read.py` the command,
  `reading.py` the pieces and pauses, `xtts.py` the TTS run with its Whisper
  and pitch checks, `whisper.py` the Whisper it checks with (mlx-whisper on
  Apple silicon, faster-whisper elsewhere), `pcm.py` silence and AAC, every
  package pinned in `requirements.txt` (macOS) and `requirements-linux.txt`
  (Linux x86_64, CPU torch). It holds no family content: the private repo passes the
  voice clips, the subtitle and the Whisper prompt. The method is
  [docs/reader.md](docs/reader.md).

## Commands

Node 26 (`.nvmrc`), npm.

- `npm run dev` - the public build over `demo/`; `STORIES_BUILD=family npm run dev` for the other.
- `npm run build` - typecheck, then `output/public` and `output/family`.
  `STORIES_CONTENT=<dir>` builds other content, `STORIES_OUT=<dir>` writes
  elsewhere.
- `npm run lint` - eslint and `khe-design-lint`.
- `npm run typecheck`, `npm test` (Vitest: the contract, the resume rules,
  both builds' output, the request service), `npm run test:e2e` (Playwright over both builds:
  offline, Range, the worker's update and prune, the kill-switch, resume, the listening view,
  the mini player, the sleep counter's chain, the family header's language,
  the compose view against a stubbed `/api/`).
- `npm run preview` - serves `output/public` with the demo audio.
- `docker build server` - the request service's image; its tests are in
  `npm test` (`tests/server.test.ts`).
- `python3 -m unittest discover -s reader -q` - the reader's tests.
- `uv run --no-project --python 3.11 --with-requirements reader/requirements.txt python reader/read.py --help` -
  the reader (docs/reader.md "Running it"): Apple silicon, or Linux x86_64
  with `reader/requirements-linux.txt`, `uv`, and `afconvert` or `ffmpeg`. The private repo's export runs it; the
  demo stories are not read with it, since the only voice with permission is
  private.

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
patches of devDependencies, GitHub Actions minor and patch updates, digests
and pins (`renovate.json`), through a pull request whose required checks
pass; an npm or Actions update waits until its release is three days old,
lock file maintenance waits for a merge by hand, the Grype image scanner
never automerges and waits seven days (estate ADR-008), and `@khelias/ui`
is never automerged (estate ADR-014).
Renovate leaves `reader/` alone (`ignorePaths`): its pins decide how a story
sounds, so they move by hand, with a new voice tag in the private repo.
The app does not deploy from here: the private stories repo builds the
commit its `app.ref` names. The request service does: every merge to `main`
publishes `ghcr.io/khelias/khe-stories-server` (`sha-<commit>` with SBOM,
provenance and an attestation, then `main`), and CI's `Pin homelab` job runs
`scripts/pin-homelab.sh` with the `khe-stories-pins` App's token from the
`homelab-pin` environment, opening an auto-merging pin PR in khe-homelab
([estate ADR-008](https://github.com/khelias/khe-architecture/blob/main/decisions/008-container-images.md)),
whose merge is the deploy. The image job scans with Grype (`.grype.yaml`).
The way back from a bad update is to revert its merge on `main` through a
pull request, or to pin the service to an earlier `sha-` digest in
khe-homelab.

## Kill-switch

`sw.js` stays at its URL for good
([estate ADR-041](https://github.com/khelias/khe-architecture/blob/main/decisions/041-installed-apps-stay-on-their-paths-with-a-worker-each.md)):
a deleted file falls through to `index.html` and the old worker keeps running.
If a deployed worker misbehaves, replace `sw.js` in the build's output with
this and deploy; every visitor's worker updates to it on the next visit,
removes the app's caches and unregisters itself. `e2e/kill-switch.spec.ts`
runs this block as written, over both builds:

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
