# The content contract

The one interface between the stories and the app. A content directory is
what `STORIES_CONTENT` points the build at: `demo/` here, the exports of the
private stories repo in the real builds. `src/content.ts` checks every file
before anything is bundled, and a build fails on the first problem.

    <content>/
      catalog.json
      stories/<route>.json
      audio/<sha256>.m4a        not read by the build; served beside it

## catalog.json

```json
{
  "stories": [
    {
      "route": "siil-otsis-und",
      "title": "Siil, kes otsis und",
      "told": "2026-01-10",
      "published": "2026-11-16",
      "art": "default",
      "duration": 98.181,
      "audio": "fe8b1fa7…"
    }
  ]
}
```

- `route`: the story's hash in the address (`#siil-otsis-und`), matching
  `^[a-z0-9-]+$`, unique, and never changed once a story is published, since
  it is in every shared link and in the listener's stored position.
- `title`: the story's title, equal to its story file's.
- `told`: `YYYY-MM-DD`, or `YYYY-<spring|summer|autumn|winter>`.
- `published`: the day the story was published, or `null`. The public build
  holds only stories with a date; the family build holds all.
- `art`: a drawing key from `src/art.ts` (`sun`, `cone`, `default`); a key the
  app does not know draws the default.
- `duration`: seconds of audio, or `null` for a story read as text only.
- `audio`: the sha256 of the story's m4a, or `null` for text only. Both or
  neither of `duration` and `audio` are set.

The order of the list is the order of the library.

## stories/&lt;route&gt;.json

```json
{
  "title": "Siil, kes otsis und",
  "paragraphs": [{ "text": "Sügisõhtul, kui lehed …", "start": 5.13 }]
}
```

- `paragraphs`: at least one, each with non-empty `text`.
- `start`: seconds into the audio where the paragraph is read, rising and
  within `duration`; `null` in a story without audio.

The build writes each story file as a hashed asset
(`assets/<route>-<hash>.json`), so a changed text is a new URL that no cache
holds, and writes the build's own `catalog.json` beside `index.html` for the
deploy and its leak check. The page itself takes the catalog from its bundle.

## Audio

Audio is never bundled. Under the build's base (`/stories/` for the public
build, `/` for the family build):

- `audio/<sha256>.m4a` is the network copy. The server answers it with
  `Range`. The service worker never handles it, so audio the listener has not
  saved behaves as if there were no worker.
- `saved/<sha256>.m4a` is answered only by the service worker, from the copy
  the listener saved with "Hoia telefonis" (Cache Storage
  `unejanku-audio-<build>`, the whole file, fetched without `Range`), with
  `Range` answered by slicing it. Where the cache has no copy, the worker
  fetches `audio/` instead. Without a worker the path does not exist.

A story whose audio is `null`, or whose audio answers an error, shows its text
with "Ettelugemist praegu ei ole".
