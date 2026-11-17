# The content contract

The one interface between the stories and the app. A content directory is
what `STORIES_CONTENT` points the build at: `demo/` here, the exports of the
private stories repo in the real builds. `src/content.ts` checks every file
before anything is bundled, and a build fails on the first problem.

    <content>/
      catalog.json
      stories/<route>.json
      art/<name>.svg|webp       the pictures the catalog names
      compose.json              the family build's only: what a child picks from
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
      "art": "siil-otsis-und.svg",
      "duration": 98.181,
      "audio": "fe8b1fa7…",
      "author": null
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
- `art`: the story's picture, a file name under `art/` matching
  `^[a-z0-9-]+\.(svg|webp)$`, or absent (or `null`) to draw the app's fallback scene.
  A name that does not match, or a file that is missing or fails the picture
  rules below, fails the build.
- `duration`: seconds of audio, or `null` for a story read as text only.
- `audio`: the sha256 of the story's m4a, or `null` for text only. Both or
  neither of `duration` and `audio` are set.
- `author`: the name of the child who made the story, at most 40 characters,
  or absent (or `null`) for the family's own. A story with an author is on
  the children's shelf, "Meie enda jutud", below the family's stories, and
  its card names the author (estate
  [ADR-037](https://github.com/khelias/khe-architecture/blob/main/decisions/037-childrens-stories-are-made-by-an-unattended-job.md)).

The order of the list is the order of the library: the family's stories in
that order, then the children's shelf in that order.

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

## art/&lt;name&gt;.webp

A raster picture, for a story on the children's shelf (estate ADR-037,
which amends ADR-033 point 1 for that shelf). The app draws it with `<img>`
as it does an SVG, and the build writes it as a hashed asset. `checkWebp` in
`src/content.ts` reads only the header:

- At most 400 KB.
- A RIFF `WEBP` file whose RIFF size is the file's, holding exactly one
  chunk, `VP8 ` (lossy, one key frame) or `VP8L` (lossless, version 0). An
  extended file (`VP8X`, which can carry metadata, an alpha chunk or
  animation) fails.
- 600 by 800 or 1200 by 1600, read from that chunk's header: the SVG frame,
  once or twice over, with the same composition.

## compose.json

What a child picks from when she asks for a story in the family build, each
choice an id a request carries and the name it shows:

```json
{
  "cast": [{ "id": "siil", "name": "Siil" }],
  "places": [{ "id": "mets", "name": "Mets" }],
  "kinds": [{ "id": "naljakas", "name": "Naljakas jutt" }]
}
```

Each list is non-empty, each id matches `^[a-z0-9-]+$` and is unique in its
list, each name is a non-empty string. The names are the family's, so the
public build fails when its content holds the file; the private repo stages
it for the family build only.

## art/&lt;name&gt;.svg

A story's picture (estate
[ADR-033](https://github.com/khelias/khe-architecture/blob/main/decisions/033-story-pictures-are-content.md)):
the library cover, the story page's header and the player's tile. The app
draws it with `<img>`, never inline, and the build writes it as a hashed asset
(`assets/<name>-<hash>.svg`) beside the story's JSON, so the service worker
holds it offline. Only the pictures of the stories a build holds are in it.

The files are served from the app's own origin, where an SVG opened by
itself is a page, so `checkArt` in `src/content.ts` holds them to an
allowlist, not a ban list:

- At most 200 KB, one `<svg>` root with `viewBox="0 0 600 800"`; `xmlns`
  only on the root and only the SVG namespace.
- Elements: `svg defs g path rect circle ellipse line polyline polygon
  linearGradient radialGradient stop clipPath filter feGaussianBlur`.
- Attributes, by name: `id`, the geometry (`width height viewBox
  preserveAspectRatio transform d x y x1 y1 x2 y2 cx cy r rx ry fx fy fr
  points pathLength`), the paint (`fill fill-opacity fill-rule opacity
  stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin
  stroke-dasharray stroke-dashoffset stroke-miterlimit`), the gradients
  (`offset stop-color stop-opacity gradientUnits gradientTransform
  spreadMethod`), clipping (`clip-path clip-rule clipPathUnits`) and the blur
  (`filter filterUnits primitiveUnits stdDeviation in result edgeMode`).
- Values are numbers, colours and keywords; `url(#id)` to an id in the same
  file is the only reference, and parentheses appear otherwise only in a
  transform.
- No text, comment, DOCTYPE, entity, CDATA or processing instruction; so no
  `style`, `href`, `on*`, `script`, `foreignObject`, `image`, `use` or
  animation element.

Composition: the frame is 600 by 800, and the app crops wide frames from the
bottom (`object-position: 50% 100%`), so the subject stays between y 380 and
780.

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
