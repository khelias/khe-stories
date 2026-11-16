"""Read a story aloud: story.m4a and story.json in the out directory.

    uv run --no-project --python 3.11 --with-requirements reader/requirements.txt
        python reader/read.py --story <story.json> --voice <clip.wav>...
        --subtitle <text> --prompt <text> --out <dir>

The story is JSON with `title` and `paragraphs` (a list of strings). story.json
is `{title, paragraphs: [{text, start}], duration}`, each `start` the second
its paragraph begins in story.m4a. Every piece is read by xtts.py as reading.py
plans it, its silence trimmed, and the pieces joined with reading.py's pauses.
docs/reader.md has the method; it runs on Apple silicon (mlx-whisper).
"""

import argparse
import json
import sys
from array import array
from pathlib import Path

from pcm import silence, trim, write_m4a
from reading import plan
from xtts import synthesise


def read_aloud(title: str, texts: list[str], subtitle: str, clips: list[Path], prompt: str, m4a: Path) -> tuple[list[dict], float]:
    """Read the story into m4a; the paragraphs with their starts, and the duration."""
    pieces = plan(title, texts, subtitle)
    readings = synthesise([piece.text for piece in pieces], clips, prompt)
    rate = readings[0][0]  # the model reads every piece at its one rate
    audio = array("h")
    entries = []
    for piece, (_, samples) in zip(pieces, readings):
        audio.extend(silence(piece.gap, rate))
        if piece.paragraph:
            entries.append({"text": piece.paragraph, "start": round(len(audio) / rate, 3)})
        audio.extend(trim(samples, rate, piece.text))
    write_m4a(audio, rate, m4a)
    return entries, round(len(audio) / rate, 3)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--story", type=Path, required=True, help="JSON with title and paragraphs")
    parser.add_argument("--voice", type=Path, nargs="+", required=True, metavar="WAV", help="clips of the voice to read in")
    parser.add_argument("--subtitle", required=True, help="read after the title: a whole sentence, with its full stop")
    parser.add_argument("--prompt", required=True, help="Whisper's initial prompt: the names the stories use")
    parser.add_argument("--out", type=Path, required=True, metavar="DIR")
    args = parser.parse_args()
    story = json.loads(args.story.read_text(encoding="utf-8"))
    title, texts = story["title"], story["paragraphs"]
    if not texts:
        sys.exit(f"{args.story}: no paragraphs")
    args.out.mkdir(parents=True, exist_ok=True)
    entries, duration = read_aloud(title, texts, args.subtitle, args.voice, args.prompt, args.out / "story.m4a")
    out = {"title": title, "paragraphs": entries, "duration": duration}
    (args.out / "story.json").write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
