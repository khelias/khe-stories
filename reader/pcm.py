"""16-bit mono PCM: trimming silence, writing a WAV and encoding AAC."""

import shutil
import subprocess
import sys
import tempfile
import wave
from array import array
from pathlib import Path

EDGE_SILENCE = 0.05  # seconds kept before and after each piece's speech
SILENCE_LEVEL = 328  # 16-bit peak below this (about -40 dBFS) counts as silence
BITRATE = 64000


def trim(samples: array, rate: int, what: str) -> array:
    """The samples without the silence before and after the speech."""
    loud = (i for i in range(len(samples)) if abs(samples[i]) >= SILENCE_LEVEL)
    first = next(loud, None)
    if first is None:
        sys.exit(f"no sound above the silence level in {what!r}")
    last = next(i for i in range(len(samples) - 1, -1, -1) if abs(samples[i]) >= SILENCE_LEVEL)
    keep = round(EDGE_SILENCE * rate)
    return samples[max(first - keep, 0) : last + 1 + keep]


def write_wav(path: Path, samples: array, rate: int) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(samples.tobytes())


def silence(seconds: float, rate: int) -> array:
    return array("h", [0]) * round(seconds * rate)


def write_m4a(samples: array, rate: int, m4a: Path) -> None:
    """Encode the samples as AAC, through a temporary WAV."""
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "story.wav"
        write_wav(wav, samples, rate)
        if shutil.which("afconvert"):
            cmd = ["afconvert", "-f", "m4af", "-d", "aac", "-c", "1", "-b", str(BITRATE), str(wav), str(m4a)]
        elif shutil.which("ffmpeg"):
            cmd = ["ffmpeg", "-loglevel", "error", "-y", "-i", str(wav), "-ac", "1", "-c:a", "aac", "-b:a", str(BITRATE), str(m4a)]
        else:
            sys.exit("neither afconvert nor ffmpeg found: one is needed to encode AAC")
        subprocess.run(cmd, check=True)
