"""Whisper for xtts.py's checks, behind one function: mlx-whisper on Apple
silicon, faster-whisper (CTranslate2, int8 on the CPU) elsewhere. Both run
large-v3-turbo greedily at temperature 0, so a machine checks a reading the
same way every time; the two may hear a reading differently.
"""

import platform
from typing import Callable, NamedTuple


class Whisper(NamedTuple):
    repo: str
    revision: str
    weights: str  # a file a complete snapshot holds


MLX = Whisper("mlx-community/whisper-large-v3-turbo", "a4aaeec0636e6fef84abdcbe3544cb2bf7e9f6fb", "weights.safetensors")
# faster-whisper's own "large-v3-turbo", under the name its repo moved to.
CT2 = Whisper("dropbox-dash/faster-whisper-large-v3-turbo", "0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf", "model.bin")


def pick(system: str | None = None, machine: str | None = None) -> Whisper:
    """The Whisper this machine runs."""
    system, machine = system or platform.system(), machine or platform.machine()
    return MLX if (system, machine) == ("Darwin", "arm64") else CT2


def transcriber(whisper: Whisper, path: str, prompt: str) -> Callable:
    """A function from 16 kHz mono float32 samples to their transcript, with
    `prompt` as Whisper's initial prompt. `path` is `whisper`'s snapshot."""
    if whisper is MLX:
        import mlx_whisper

        return lambda audio: mlx_whisper.transcribe(audio, path_or_hf_repo=path, language="et", temperature=0.0, initial_prompt=prompt)["text"].strip()

    from faster_whisper import WhisperModel

    model = WhisperModel(path, device="cpu", compute_type="int8")

    def transcribe(audio) -> str:
        segments, _ = model.transcribe(audio, language="et", temperature=0.0, beam_size=1, initial_prompt=prompt)
        return "".join(segment.text for segment in segments).strip()

    return transcribe
