"""Synthetic voices for the voice-print tests (cr-modules-019). Every test that needs a voice, a window
embedding or a diarisation imports this; nothing real ever stands in.

A voice is a seeded random unit vector; a window is that voice plus seeded noise. Vectors are plain
lists of floats. Everything is deterministic for its seed and touches no file.

Owned by task 1: later tasks import it and never edit it (a missing helper goes in that task's own
test file).
"""
from __future__ import annotations

import math
import random


def _unit(v):
    n = math.sqrt(sum(x * x for x in v))
    return [x / n for x in v] if n else list(v)


def _gauss(rng, dim):
    return [rng.gauss(0.0, 1.0) for _ in range(dim)]


def voice(seed, dim=64):
    """A synthetic speaker: a unit vector of `dim` floats drawn from `random.Random(seed)`. Two voices
    of different seeds are nearly orthogonal (cosine about +-1/sqrt(dim))."""
    return _unit(_gauss(random.Random(f"voice:{seed}:{dim}"), dim))


def windows(voice, n, noise=0.15, seed=0):
    """`n` window embeddings of `voice`: each the unit vector of `voice + e`, `e` Gaussian noise whose
    expected length is `noise` whatever the dimension (so a window's cosine to its voice is about
    1/sqrt(1 + noise**2): 0.99 at 0.15, 0.86 at 0.6, 0.71 at 1.0)."""
    dim = len(voice)
    rng = random.Random(f"windows:{seed}:{dim}")
    sigma = noise / math.sqrt(dim)
    return [_unit([x + sigma * g for x, g in zip(voice, _gauss(rng, dim))]) for _ in range(n)]


def mixed(a, b, n, share_b, seed=0, noise=0.15):
    """`n` windows of a label holding two voices: `round(n * share_b)` of `b`, the rest of `a`, in a
    seeded shuffled order (a mixed label's windows interleave in time)."""
    nb = int(round(n * share_b))
    ws = windows(a, n - nb, noise=noise, seed=(seed, "a")) + windows(b, nb, noise=noise, seed=(seed, "b"))
    random.Random(f"mixed:{seed}").shuffle(ws)
    return ws


def near(voice, cos, seed=0):
    """A unit vector whose cosine to `voice` is exactly `cos` (-1..1), in a seeded direction."""
    if not -1.0 <= cos <= 1.0:
        raise ValueError(f"a cosine is between -1 and 1, got {cos}")
    u = _unit(voice)
    rng = random.Random(f"near:{seed}:{len(u)}")
    while True:
        r = _gauss(rng, len(u))
        d = sum(x * y for x, y in zip(r, u))
        w = [x - d * y for x, y in zip(r, u)]
        if math.sqrt(sum(x * x for x in w)) > 1e-9:
            break
    w = _unit(w)
    s = math.sqrt(max(0.0, 1.0 - cos * cos))
    return _unit([cos * x + s * y for x, y in zip(u, w)])


def segments_two(turns_a, turns_b, seg_max=None, gap=0.0, labels=("speaker_0", "speaker_1"), start=0.0):
    """A hand-written two-label diarisation with chosen turn lengths, as `[{speaker, start, end}]`.

    Turns alternate a, b, a, b, ... from `start` (`turns_a[0]`, `turns_b[0]`, `turns_a[1]`, ...; when
    one list runs out the other's remaining turns follow back to back, so they merge into one turn),
    `gap` seconds of silence between turns. With `seg_max`, a turn is written as consecutive segments of
    at most `seg_max` seconds, as a diariser does; a turn's length is still what was asked.
    """
    out = []
    t = float(start)
    order = []
    for i in range(max(len(turns_a), len(turns_b))):
        if i < len(turns_a):
            order.append((labels[0], float(turns_a[i])))
        if i < len(turns_b):
            order.append((labels[1], float(turns_b[i])))
    for k, (label, length) in enumerate(order):
        if k:
            t += gap
        end = t + length
        if seg_max:
            a = t
            while end - a > 1e-9:
                b = min(end, a + seg_max)
                out.append({"speaker": label, "start": round(a, 6), "end": round(b, 6)})
                a = b
        else:
            out.append({"speaker": label, "start": round(t, 6), "end": round(end, 6)})
        t = end
    return out
