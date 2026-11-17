"""A diarisation's voice signature (design section 7 seam 3, section 8): every label's windows embedded
with the active speaker model, whether or not anyone knows who speaks.

    {"version": 1, "audio": <sha256 of the audio>,
     "diarization": {"id", "labels", "speakers_hint", "fallback"},
     "model": {"id", "sha256", "dim"},
     "labels": {"speaker_0": {"seconds", "share", "longest_turn", "windows": [{"start", "end", "vector"}]}},
     "removed": [<labels whose windows are never computed>]}

`records` is added by `Store.write_signature`. A signature holds no person's name.

Standard library only: the embedder is handed in (`embed.Embedder`, or a stand-in in tests).
"""
from __future__ import annotations

from voiceprints import segments as vp_segments

WORD_GAP = 1.0                          # words closer than this are one stretch of speech
CANDIDATES = 4 * vp_segments.MAX_WINDOWS  # windows handed to the embedder per label, spread like the kept ones


def word_segments(words, label="speaker_0", gap=WORD_GAP):
    """With no diarisation: the recogniser's word timings as segments of the one label, consecutive words
    less than `gap` seconds apart joined into one."""
    out = []
    for w in sorted(words or [], key=lambda w: float(w["start"])):
        s, e = float(w["start"]), float(w["end"])
        if e <= s:
            continue
        if out and s - out[-1]["end"] < gap:
            out[-1]["end"] = max(out[-1]["end"], e)
        else:
            out.append({"speaker": label, "start": s, "end": e})
    return out


def _windows(embedder, samples, sr, segs, label):
    """At most MAX_WINDOWS embedded windows of `label`, spread evenly over its whole time range: the cut
    windows (segments over 10 s in 6 s pieces) are spread to CANDIDATES first so a three-hour monologue
    costs a bounded embedding, the embedder drops those under 2.0 s of speech, and what is left is
    spread to MAX_WINDOWS."""
    cand = vp_segments.spread(vp_segments.cut_windows(segs, label), CANDIDATES)
    got = embedder.embed(samples, sr, cand)
    picked = vp_segments.spread([(w["start"], w["end"], i) for i, w in enumerate(got)], vp_segments.MAX_WINDOWS)
    return [{"start": round(float(got[i]["start"]), 3), "end": round(float(got[i]["end"]), 3),
             "vector": [float(x) for x in got[i]["vector"]]} for _, _, i in picked]


def compute(embedder, samples, sr, segments, words, *, audio_sha256, diarization_id, speakers_hint, fallback,
            removed=(), remove_all=False):
    """The signature file of one diarisation. `segments` empty (one speaker declared, or a fallback):
    the windows are cut from the recogniser's `words` under `speaker_0`. A label in `removed` keeps its
    statistics and no windows, and nothing of it is handed to the embedder; `remove_all` removes every
    label (a forgotten speaker who cannot be placed in this transcript, `carry.forgotten_unplaced`)."""
    segs = list(segments or []) or word_segments(words)
    stats = vp_segments.label_stats(segs)
    removed = set(stats) if remove_all else set(removed or ())
    labels = {}
    for label in sorted(stats):
        st = stats[label]
        labels[label] = {
            "seconds": round(st["seconds"], 3),
            "share": round(st["share"], 4),
            "longest_turn": round(st["longest_turn"], 3),
            "windows": [] if label in removed else _windows(embedder, samples, sr, segs, label),
        }
    m = embedder.model
    return {
        "version": 1,
        "audio": audio_sha256,
        "diarization": {"id": diarization_id, "labels": len(labels), "speakers_hint": speakers_hint,
                        "fallback": fallback},
        "model": {"id": m.id, "sha256": m.sha256, "dim": m.dim},
        "labels": labels,
        "removed": sorted(removed),
    }
