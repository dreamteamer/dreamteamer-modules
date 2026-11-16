"""Window embedding with a pinned speaker model (design §7 seams 3 and 4).

The one voiceprints file that needs the venv: sherpa-onnx and numpy (and soundfile in `read_audio`).
Import it only where audio is embedded — every judgement of a vector lives in standard-library files a
bare python3 runs.

    emb = Embedder(models.active_model(skill_dir), models_dir)
    emb.model                       # store.Model(id, sha256, dim): what a print or signature carries
    emb.embed(samples, sr, windows) # [{start, end, vector}] for the windows with enough speech

A window is embedded from its speech only: near-silent 20 ms frames (below segments.FLOOR_DB) are
dropped, and a window left with under segments.MIN_SPEECH seconds is skipped. Vectors are unit length.
"""
from __future__ import annotations

import math

import numpy as np

from voiceprints import models, segments


def read_audio(path):
    """(samples float32 mono, sample rate) of an audio file soundfile can read."""
    import soundfile as sf

    samples, sr = sf.read(path, dtype="float32", always_2d=True)
    return samples.mean(axis=1).astype(np.float32), int(sr)


def speech_frames(chunk, sr, frame=segments.FRAME, floor_db=segments.FLOOR_DB):
    """(the chunk with its near-silent frames dropped, seconds of speech) — the same rule as
    segments.speech_seconds, applied to the samples."""
    n = max(1, int(round(frame * sr)))
    whole = len(chunk) // n
    if whole == 0:
        return chunk[:0], 0.0
    frames = np.asarray(chunk[: whole * n], dtype=np.float32).reshape(whole, n)
    rms = np.sqrt(np.mean(np.square(frames, dtype=np.float64), axis=1))
    seconds = segments.speech_seconds([float(r) for r in rms], frame=frame, floor_db=floor_db)
    floor = 10.0 ** (floor_db / 20.0)
    keep = (rms > 0) & (rms >= floor)
    return frames[keep].reshape(-1), seconds


def _unit(v):
    norm = math.sqrt(sum(x * x for x in v))
    return [x / norm for x in v] if norm > 0 else None


class Embedder:
    def __init__(self, model_id, models_dir, num_threads=2, extractor=None):
        self.model = models.pin(model_id, models_dir)
        if extractor is None:
            import sherpa_onnx

            extractor = sherpa_onnx.SpeakerEmbeddingExtractor(sherpa_onnx.SpeakerEmbeddingExtractorConfig(
                model=models.model_path(model_id, models_dir), num_threads=num_threads))
        if extractor.dim != self.model.dim:
            raise models.ModelRefused(
                f"speaker model {model_id} gives {extractor.dim}-dimensional vectors; the registry says {self.model.dim}")
        self._x = extractor

    def embed(self, samples, sr, windows):
        """`windows` [(start, end)] in seconds → [{start, end, vector}], in window order, for the
        windows holding at least MIN_SPEECH seconds of speech; the others are left out."""
        samples = np.asarray(samples, dtype=np.float32)
        out = []
        for start, end in windows:
            a, b = max(0, int(round(start * sr))), min(len(samples), int(round(end * sr)))
            if b <= a:
                continue
            speech, seconds = speech_frames(samples[a:b], sr)
            if seconds < segments.MIN_SPEECH:
                continue
            stream = self._x.create_stream()
            stream.accept_waveform(sr, speech)
            stream.input_finished()
            if not self._x.is_ready(stream):
                continue
            vector = _unit([float(x) for x in self._x.compute(stream)])
            if vector is None:
                continue
            out.append({"start": float(start), "end": float(end), "vector": vector})
        return out
