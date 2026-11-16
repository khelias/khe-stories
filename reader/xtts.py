"""Read texts with TartuNLP's XTTS v2 Estonian in the voice of reference clips.
read.py calls `synthesise` once per story, so the model loads once.

Each reading is checked by Whisper and its pitch, and read again when it is off:
a transcript unlike the text, words after the text's end, or a voice that rises
at the end of a statement (docs/reader.md "Checks" says why).
"""

import difflib
import re
import sys
import zlib
from array import array
from pathlib import Path

import librosa
import mlx_whisper
import numpy as np
import soundfile
import torch
from huggingface_hub import snapshot_download
from huggingface_hub.errors import LocalEntryNotFoundError
from scipy.signal import resample_poly

from reading import QUOTES

MODEL = "tartuNLP/XTTS-v2-est"
MODEL_REVISION = "58478fd9a8bdaba60bf11068a7a6822a66d67fae"
MODEL_FILES = ["config.json", "model.pth", "dvae.pth", "mel_stats.pth", "vocab.json", "TTS/*.py", "TTS/*.json", "TTS/*.dat"]
WHISPER = "mlx-community/whisper-large-v3-turbo"
WHISPER_REVISION = "a4aaeec0636e6fef84abdcbe3544cb2bf7e9f6fb"
WHISPER_RATE = 16000

FIRST = {"temperature": 0.1, "top_k": 10, "top_p": 0.3, "repetition_penalty": 10.0, "speed": 1.0}
RETRY = {**FIRST, "temperature": 0.3}
ATTEMPTS = [FIRST, RETRY, RETRY, RETRY]
GOOD = 0.93  # similarity of text and transcript at which a reading is kept
EXTRA_CHARS = 2  # letters heard after the text's last one that mean invented speech
RISE = 1.25  # the last syllable this much above the reading's median pitch is a rise


def load_audio(path, sampling_rate):
    """Adapted from load_audio in TTS/tts/models/xtts.py of the Coqui TTS fork
    the model ships (MPL-2.0): the same, without torchaudio.load, which since
    torchaudio 2.9 reads only through torchcodec and FFmpeg."""
    audio, rate = soundfile.read(path, dtype="float32", always_2d=True)
    audio = torch.from_numpy(audio.mean(axis=1)).unsqueeze(0)
    if rate != sampling_rate:
        import torchaudio

        audio = torchaudio.functional.resample(audio, rate, sampling_rate)
    return audio.clip(-1, 1)


def fetch(repo_id: str, needs: str, **kwargs) -> Path:
    """A pinned Hugging Face snapshot, from the cache when it holds `needs`
    (a cache left by an interrupted download may not)."""
    try:
        path = Path(snapshot_download(repo_id, local_files_only=True, **kwargs))
        if (path / needs).exists():
            return path
    except LocalEntryNotFoundError:
        pass
    return Path(snapshot_download(repo_id, **kwargs))


def squash(text: str) -> str:
    return re.sub(r"\W", "", text.lower())


def heard_after_end(said: str, heard: str) -> int:
    """Letters in the transcript after the one matching the text's last letter,
    0 when the end of the text was not heard at all (the score says that)."""
    text, transcript = squash(said), squash(heard)
    blocks = [b for b in difflib.SequenceMatcher(None, text, transcript).get_matching_blocks() if b.size]
    if not blocks or blocks[-1].a + blocks[-1].size < len(text) - 2:
        return 0
    return len(transcript) - (blocks[-1].b + blocks[-1].size)


def rises_at_end(wav: np.ndarray, rate: int) -> bool:
    f0, voiced, _ = librosa.pyin(wav, fmin=70, fmax=300, sr=rate, frame_length=1024, hop_length=rate // 100)
    pitch = f0[voiced]
    return len(pitch) > 40 and np.median(pitch[-20:]) > RISE * np.median(pitch)


def synthesise(texts: list[str], clips: list[Path], prompt: str) -> list[tuple[int, array]]:
    """Rate and 16-bit samples of each text read in the voice of the clips.
    `prompt` is Whisper's initial prompt: the names and words of the stories,
    spelled out, since Whisper otherwise never writes them right and so sends a
    good reading to be read again."""
    repo = fetch(MODEL, "model.pth", revision=MODEL_REVISION, allow_patterns=MODEL_FILES)
    whisper = str(fetch(WHISPER, "weights.safetensors", revision=WHISPER_REVISION))
    sys.path.insert(0, str(repo))  # the model ships its own fork of Coqui TTS, with Estonian
    import TTS.tts.models.xtts as xtts_module
    from TTS.tts.configs.xtts_config import XttsConfig

    xtts_module.load_audio = load_audio
    config = XttsConfig()
    config.load_json(str(repo / "config.json"))
    model = xtts_module.Xtts.init_from_config(config)
    model.load_checkpoint(config, checkpoint_path=str(repo / "model.pth"), vocab_path=str(repo / "vocab.json"), use_deepspeed=False)
    latent, speaker = model.get_conditioning_latents(audio_path=[str(clip) for clip in clips], gpt_cond_len=config.gpt_cond_len, max_ref_length=config.max_ref_len)
    rate = config.audio.output_sample_rate

    doubtful = []
    readings = []
    for i, text in enumerate(texts):
        said = text.translate(QUOTES)
        best = None
        for attempt, params in enumerate(ATTEMPTS):
            # Seeded by the text, and Whisper greedy, so a re-export reads the same.
            torch.manual_seed(zlib.crc32(said.encode()) + attempt)
            wav = np.asarray(model.inference(said, "et", latent, speaker, **params)["wav"], np.float32)
            heard = mlx_whisper.transcribe(resample_poly(wav, WHISPER_RATE, rate).astype(np.float32), path_or_hf_repo=whisper, language="et", temperature=0.0, initial_prompt=prompt)["text"].strip()
            score = difflib.SequenceMatcher(None, squash(said), squash(heard)).ratio()
            faults = [
                *(["words after the end"] if heard_after_end(said, heard) >= EXTRA_CHARS else []),
                *(["rises at the end"] if not re.search(r"\?\W*$", said) and rises_at_end(wav, rate) else []),
            ]
            # A fault costs a reading 0.05 of score, so a good reading with a slip
            # still beats one that is cut short or garbled.
            rank = (score >= GOOD and not faults, score - 0.05 * len(faults))
            if best is None or rank > best[0]:
                best = (rank, score, wav, heard, attempt, faults)
            if score >= GOOD and not faults:
                break
        _, score, wav, heard, attempt, faults = best
        note = f" [{', '.join(faults)}]" if faults else ""
        print(f"{i + 1}/{len(texts)} {score:.3f} (try {attempt + 1}){note} | {heard}", file=sys.stderr, flush=True)
        if score < GOOD or faults:
            doubtful.append(f"  {score:.3f}{note} {said}\n        heard: {heard}")
        samples = array("h")
        samples.frombytes((np.clip(wav, -1, 1) * 32767).astype("<i2").tobytes())
        readings.append((rate, samples))
    if doubtful:
        print(f"{len(doubtful)} readings under {GOOD} or with a fault, listen to them:\n" + "\n".join(doubtful), file=sys.stderr)
    return readings
