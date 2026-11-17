# The reader

How the stories are read aloud: `reader/` turns a story's text into
`story.m4a` and `story.json`, the paragraphs with the second each one starts
at, which is the shape the content contract's story file takes
([content.md](content.md)). The engine is TartuNLP's XTTS v2 Estonian,
reading in the voice of a few reference clips, with Whisper listening to
every piece. This page is what was learnt choosing and tuning it, so that a
later choice of voice or model starts from here.

The reader holds no content. The private stories repo passes the story, the
voice clips, the subtitle read after each title and the Whisper prompt, and
builds the reader from the same commit as the app
([estate ADR-036](https://github.com/khelias/khe-architecture/blob/main/decisions/036-the-stories-reader-is-app-code.md)).

## Running it

    uv run --no-project --python 3.11 --with-requirements reader/requirements.txt \
        python reader/read.py --story story.json --voice clip-1.wav clip-2.wav \
        --subtitle "Unejutt metsast." --prompt "Mia, Oskar, unejutt." --out out/

`--story` is a JSON file of the story's title and its paragraphs as plain
text:

    {"title": "Kuu akna taga", "paragraphs": ["Mia ja Oskar ...", "..."]}

`out/story.json` repeats the title and each paragraph with the second it
starts at in `out/story.m4a`, and the reading's length in seconds:

    {"title": "Kuu akna taga", "paragraphs": [{"text": "Mia ja Oskar ...", "start": 4.21}], "duration": 192.31}

`--subtitle` is a whole sentence with its full stop, read after the title;
`--prompt` lists the names and unusual words of the stories, for Whisper.
Needed to run it:

- macOS on Apple silicon: Whisper runs through `mlx-whisper`. The model
  itself runs on the CPU (below): a story of 3 minutes 12 seconds took
  3 minutes 40 seconds on an M4 Pro, the Whisper checks and the re-reads
  included.
- `uv`, which fetches the pinned packages of `reader/requirements.txt` and,
  on the first run, the 5.6 GB model and Whisper from Hugging Face.
- `afconvert` (macOS) or `ffmpeg` to encode AAC, 64 kbit/s mono.
- `python3 -m unittest discover -s reader` runs the tests of how a story is
  cut into pieces; they need nothing but Python.

## The model

- [`tartuNLP/XTTS-v2-est`](https://huggingface.co/tartuNLP/XTTS-v2-est):
  Coqui XTTS v2 fine-tuned on Estonian by TartuNLP, pinned by revision in
  `reader/xtts.py`. It ships its own fork of Coqui TTS with Estonian text
  normalisation (`tts_preprocess_et`), which the reader imports from the
  downloaded snapshot. Output is 24 kHz mono.
- Licence: the Coqui Public Model License
  ([`LICENSE.txt` of `coqui/XTTS-v2`](https://huggingface.co/coqui/XTTS-v2/blob/main/LICENSE.txt);
  coqui.ai is gone). Non-commercial use of the model and its output, no
  direct or indirect payment from it, and whoever gets the output must also
  get the terms or their URL, so the app's credit line under each story
  names the model and links them. The fork's code is MPL-2.0;
  `load_audio` in `xtts.py` is adapted from it.
- CPU only: on MPS (the Apple GPU) the speaker encoder fails on a conv1d
  with more than 65536 output channels.
- torchaudio 2.9 and later loads audio only through torchcodec and FFmpeg,
  so the reader gives the fork a soundfile loader. spacy below 3.8, the
  fork's bound, needs numpy 1.
- Whisper is `mlx-community/whisper-large-v3-turbo`, also pinned by
  revision.

## Settings

Temperature 0.1, top_k 10, top_p 0.3, repetition penalty 10, speed 1.0.

- The low temperature with a narrow top_k and top_p, the sampler of
  TartuNLP's demo, dropped the fewest words by Whisper and does not depend
  on the seed. Temperatures of 0.3 to 0.75 and the model's own sampler
  (top_k 50, top_p 0.85) dropped more.
- Speed works (the latents are stretched), but every step below 1.0 cost
  words, vowel length among them: a long vowel read short changes an
  Estonian word.
- The voice falls at the end of a sentence by itself, from peaks of about
  170-210 Hz to 105-130 Hz on the last syllables, close to a person reading
  aloud. So a piece is whole sentences, never a clause on its own.

## Pieces

`reader/reading.py` decides what the voice reads at once and the silence
before each piece.

- A piece is one or more whole sentences of one paragraph. It never spans
  two paragraphs, since the reading records where each paragraph starts.
- A sentence under 60 characters is read with its neighbour. Read alone,
  short sentences come out as invented words at any temperature: a
  three-word sentence such as "Ta avas silmad." may end in a made-up word,
  and a name called out alone ("Mia,") is not a word at all.
- A join stays within 220 characters. Long inputs fail or rush; TartuNLP's
  demo failed outright on a passage of 368.
- A sentence over 220 characters is cut at the comma nearest its middle,
  never inside an aside between dashes, and the pause after the cut is a
  clause pause.
- Quote marks are dropped before reading: with them, as with very short
  inputs, the model invented speech.
- The title is read with a subtitle ("Kuu akna taga. Unejutt metsast."),
  since a title alone is a short piece.
- Silence: 2 s after the title, 1.5 s between paragraphs, 1.0 s between
  sentences, 0.35 s after a cut at a comma. Each piece's own silence is
  trimmed to 0.05 s first, at about -40 dBFS.

## Checks

Every piece is transcribed by Whisper as it is read, and read again, up to
three more times at temperature 0.3, when it is off:

- the similarity of text and transcript is under 0.93;
- Whisper hears two or more letters after the text's end: the model adds a
  made-up word to short pieces, most of all to titles;
- a statement's last syllable is over 1.25 times the piece's median pitch
  (librosa `pyin`), a voice that rises as if asking. A sentence ending in a
  question mark may rise.

A fault costs a reading 0.05 of its score, so a good reading with a slip
still beats one that is cut short or garbled; the best of the tries is
kept, and those still off are listed at the end for listening.

Whisper needs the prompt: without the story's names spelled out it never
writes them right, and a good reading is sent to be read again. It cannot
hear how hard a consonant is, so a name read with the wrong t or d passes
the check; only listening catches that.

## The same reading every time

Each try is seeded by the CRC32 of its text plus the try's number, and
Whisper is greedy, so a re-read gives the same pieces: read twice, a story
gave the same timings, the same Whisper scores and sample-identical audio.
Editing one sentence changes only its own piece. Only 12 bytes of the m4a's
header differ between two encodings (timestamps), so the file's sha256
changes with every reading.

The packages, the model and Whisper are pinned, so a reading made at one
commit of this repo can be made again from it.

## Clips

The clip matters more than the settings. XTTS takes up to 30 s of
reference for its GPT latents and averages the speaker embedding over every
clip, so it gets several: four clips of 11 to 24 s, cut from a one-minute
recording made for it. A recording made for cloning (a quiet room, a
lossless format, no voice processing on the microphone) did much better
than clips cut from a long reading aloud, where a rolling r started to
rattle. Cloning a real speaker needs their permission.

## Checking a finished reading

Beyond the per-piece check, transcribe each paragraph between its `start`
times and compare word counts with the text:

    mlx_whisper.transcribe(<16 kHz float array>, path_or_hf_repo="mlx-community/whisper-large-v3-turbo", language="et")

Pass an array, not a path: without ffmpeg it cannot open files. Whisper
writes "hea tööd" for "head ööd" and splits compounds in a person's reading
too, so a low score is a reason to listen, not a fault. Have someone listen
before a reading is published.

## What did not work

- Time-stretching the output (WSOLA) to slow it: audible wavering.
- A slower reference clip, for XTTS or Pocket TTS: the tempo stays the
  model's.
- Long XTTS pieces (they fail) and very short ones (invented speech).
- XTTS slower than speed 1.0: words lost, some of them vowel length.
- XTTS on MPS: the speaker encoder fails.
- Neurokõne at any speed: flat, and the vocoder crackles.
- Google's multilingual voices for Estonian stress and vowel length.

## The options compared

Tried in November 2026; prices and licences as the vendors' pages gave them
then.

| Option | Runs | Estonian | Result |
|---|---|---|---|
| TartuNLP XTTS v2 Estonian | locally, CPU | fine-tuned on Estonian | in use |
| Pocket TTS Estonian (Kyutai, community model `cbentes/pocket-tts-estonian`) | locally, about a minute a story | trained on 1192 h of Estonian | used before XTTS; barely pauses at a full stop, so it was read clause by clause, and sounded flatter |
| Neurokõne (TartuNLP API) | free API, no key | one model per speaker, from 2020 | flat, crackling vocoder |
| Google Chirp 3 HD et-EE | paid API, about USD 30 per 1M characters | multilingual | better at first, then wrong stress and vowel length |
| TartuNLP's XTTS demo (Hugging Face Space) | the same model, no settings | fine-tuned | good per sentence, fails on long passages; sends the reference clip to a third party |
| ElevenLabs v3 | paid plan for cloning | listed | not tried: multilingual like Google |
| Azure (Anu, Kert) | API, free tier, card needed | recorded Estonian voices | not tried |
| EKI Minu Hääl | trains from many recordings | native, older | not recommended |
| Chatterbox, Qwen3-TTS, F5-TTS, Google Instant Custom Voice | - | no Estonian | ruled out |

Several voices on one page would need one reading per voice: a story has one
`start` time per paragraph, and it differs between voices.
