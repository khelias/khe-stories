"""How a story is read aloud: the pieces the voice reads, in order, and the
silence before each.

XTTS pauses and lets the voice fall at a full stop by itself, so a piece is one or
more whole sentences of a paragraph. It invents speech, sometimes foreign-sounding,
when given only a few words, and fails or rushes on long inputs, so a sentence
under MIN_CHARS is read with a neighbour, joins stay under JOIN_LIMIT, and a
sentence over JOIN_LIMIT is cut at its middle comma. Pieces never span two
paragraphs, since the reading records where each paragraph starts. The title is
read with a subtitle for the same reason. docs/reader.md "Pieces" has the
findings behind each rule.
"""

import re
from dataclasses import dataclass

CLAUSE_GAP = 0.35
SENTENCE_GAP = 1.0
PARAGRAPH_GAP = 1.5
TITLE_GAP = 2.0
SPOKEN_TITLE = "{title}. {subtitle}"
MIN_CHARS = 60
JOIN_LIMIT = 220
SENTENCE_END = re.compile(r"(?<=[.!?…“])\s+(?=[„A-ZÕÄÖÜ])")
QUOTES = dict.fromkeys(map(ord, "„“”\"«»"), None)


@dataclass(frozen=True)
class Piece:
    text: str  # what the voice reads
    gap: float  # seconds of silence before it
    paragraph: str | None = None  # the paragraph it opens, for the export


def spoken_length(text: str) -> int:
    """Characters the voice reads; xtts.py drops the quotes."""
    return len(text.translate(QUOTES))


def halved(sentence: str) -> list[str]:
    """A sentence too long to read at once, cut after the comma nearest its middle
    (which leaves the shorter part as long as it can be), never inside an aside
    between dashes ("– Mia, Oskar ja väike Liisa –")."""
    if spoken_length(sentence) <= JOIN_LIMIT:
        return [sentence]
    asides = [m.span() for m in re.finditer(r"–[^–]*–", sentence)]
    commas = [m.end() for m in re.finditer(r",\s", sentence) if not any(a < m.start() < b for a, b in asides)]
    if not commas:
        return [sentence]
    cut = min(commas, key=lambda i: abs(i - len(sentence) / 2))
    return halved(sentence[:cut].strip()) + halved(sentence[cut:].strip())


def chunks_of(paragraph: str) -> list[str]:
    """The paragraph's sentences, a short one joined to its neighbour."""
    chunks: list[str] = []
    for sentence in SENTENCE_END.split(paragraph):
        for part in halved(sentence):
            last = spoken_length(chunks[-1]) if chunks else None
            if last is not None and (last < MIN_CHARS or spoken_length(part) < MIN_CHARS) and last + 1 + spoken_length(part) <= JOIN_LIMIT:
                chunks[-1] += " " + part
            else:
                chunks.append(part)
    return chunks


def plan(title: str, paragraphs: list[str], subtitle: str) -> list[Piece]:
    """The title with its subtitle, then every paragraph as its chunks; after a
    sentence cut at a comma, the clause pause."""
    pieces = [Piece(SPOKEN_TITLE.format(title=title, subtitle=subtitle), 0)]
    for i, paragraph in enumerate(paragraphs):
        gap = PARAGRAPH_GAP if i else TITLE_GAP
        opens = paragraph
        for chunk in chunks_of(paragraph):
            pieces.append(Piece(chunk, gap, opens))
            gap = CLAUSE_GAP if chunk.endswith(",") else SENTENCE_GAP
            opens = None
    return pieces
