# ADR-002: A small request service beside the app, in TypeScript on Node with no framework and a local SQLite file

- **Status:** Accepted (2026-11-17)
- **Related:** [estate ADR-037](https://github.com/khelias/khe-architecture/blob/main/decisions/037-childrens-stories-are-made-by-an-unattended-job.md) (what the service is for), [estate ADR-038](https://github.com/khelias/khe-architecture/blob/main/decisions/038-a-childs-device-is-paired-once-by-a-parent.md) (pairing, written here first), [estate ADR-008](https://github.com/khelias/khe-architecture/blob/main/decisions/008-container-images.md) (the image), [estate ADR-009](https://github.com/khelias/khe-architecture/blob/main/decisions/009-backend-language-per-app.md) (the backend language per app), [ADR-001](001-unejanku-app.md) (the app it sits beside)

## Context

Estate ADR-037 has a child ask for a story in the family build and a job in
the private stories repo make it. Something in the homelab must take that
request, hold it while the job runs, start the next one when it is done, and
tell the child's phone when her story is on the shelf. Estate ADR-038 has a
parent pair the phone first, and the service is where the paired devices are
kept. The app itself is static files; this is its first code that runs on a
server.

The work is small: a handful of routes, one queue that runs one request at a
time, a few devices and their push subscriptions.

## Decision

1. **`server/` is a second deployable in this repo**, beside the app it
   serves, with its own image (`ghcr.io/khelias/khe-stories-server`) built in
   this repo's CI, attested and pinned by digest in khe-homelab (estate
   ADR-008). Every route is under `/api/`, which the stories nginx passes to
   it.
2. **TypeScript run by Node 26 as it is**, with `node:http` and no framework
   or runtime dependency: Node strips the types, so there is no build step,
   and the image holds the source and Node. The code stays in the subset
   Node can strip (`erasableSyntaxOnly`).
3. **State in one SQLite file through the built-in `node:sqlite`**, on a
   local Docker volume, not NFS and not in the backup: the queue, the paired
   devices, their push subscriptions and the notices waiting for them. No
   story is in it. Losing it means pairing again and asking for
   notifications again.
4. **Web Push without a payload**, signed with the VAPID key by `node:crypto`:
   a push only wakes the service worker, which asks the service what is new
   for this device and shows it. No message is encrypted, so no library does
   it.
5. **A recorded idea becomes text by one call to Gemini**, after which the
   clip is gone: it is sent as JSON, never written to disk or to the
   database.

## Alternatives considered

- **Express or Fastify.** A router and a body parser for a handful of routes;
  `node:http` with a small dispatch table is shorter than their setup.
- **Postgres in the homelab.** A second container and a backup job for state
  that may be lost.
- **The `web-push` package.** It encrypts payloads this service does not
  send; signing a JWT is a few lines of `node:crypto`.
- **A build to JavaScript.** Node 26 runs the TypeScript as written; a build
  would be one more step that can differ from what the tests ran.

## Consequences

- The repo has two images' worth of CI: the app is still built by the
  private repo, the service by this one.
- The service holds the family's names and phrase only in its `.env`, never
  in the repo (rule 1).
- Pairing is tried at most five times an hour per address and twenty in all,
  since a client on the home network can make the proxy forward an address of
  its choosing. What holds then is the phrase itself: four random words, not
  a sentence the family would say.
- A notification says only that something is new; what it says comes from
  the service, so it can name the story without a payload crossing the push
  service.
