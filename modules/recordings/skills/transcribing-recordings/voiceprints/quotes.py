"""The two quotes a label is shown by (design sections 6 and 22): taken from the two parts of the label that
sound least alike, so a label that holds two voices is most likely to show it.

    pick(label_windows, turns, label) -> [{at, text}, {at, text}]

The label's windows are split by spherical 2-means (`vec.two_means`); each group's centre is the window
nearest its centroid; the quote is the label's own transcript turn nearest that moment (a turn of 10 words
or more where there is one), cut to 10 to 25 whole words — whole sentences where the turn allows, else the
25 words around the moment. Never a word of another label: only that label's turns are read. A label with
no windows (removed, or none kept) is quoted from its earliest and latest turns.

`turns` are the transcript body's `[mm:ss] Speaker N: text` turns (`segments.parse_body_turns`), each lasting
until the next turn starts. `at` is `mm:ss` as the transcript writes it (minutes past 99 stay minutes).

Standard library only (the `engines.py` rule).
"""
from __future__ import annotations

import re

from voiceprints import vec

WORDS_MIN = 10
WORDS_MAX = 25
_SENTENCE_END = re.compile(r"(?<=[.!?…؟])\s+")


def at(seconds):
    """`mm:ss`, render.py's `fmt_ts`."""
    s = int(seconds)
    return f"{s // 60:02d}:{s % 60:02d}"


def label_turns(turns, label):
    """The label's turns with words, in time order, each `{start, end, text}`; `end` is the next turn's start
    (any label), None for the last."""
    ordered = sorted(turns or [], key=lambda t: float(t["start"]))
    out = []
    for i, t in enumerate(ordered):
        if t.get("label") != label or not str(t.get("text") or "").split():
            continue
        end = float(ordered[i + 1]["start"]) if i + 1 < len(ordered) else None
        out.append({"start": float(t["start"]), "end": end, "text": str(t["text"])})
    return out


def excerpt(text, frac=0.5):
    """10 to 25 whole words of `text` around the fraction `frac` of its length: all of it when it has 25 words
    or fewer; else the run of whole sentences of 10 to 25 words whose middle is nearest `frac`; else (no
    sentence fits) the 25 words around `frac`."""
    words = text.split()
    if len(words) <= WORDS_MAX:
        return " ".join(words)
    target = max(0.0, min(1.0, frac)) * len(words)
    sents, starts, pos = [], [], 0
    for s in _SENTENCE_END.split(text.strip()):
        w = s.split()
        if w:
            sents.append(len(w))
            starts.append(pos)
            pos += len(w)
    best = None
    for i in range(len(sents)):
        n = 0
        for j in range(i, len(sents)):
            n += sents[j]
            if n > WORDS_MAX:
                break
            if n >= WORDS_MIN:
                cand = (abs(starts[i] + n / 2.0 - target), starts[i], n)
                if best is None or cand < best:
                    best = cand
    if best is not None:
        _, a, n = best
        return " ".join(words[a:a + n])
    a = int(round(target - WORDS_MAX / 2.0))
    a = max(0, min(a, len(words) - WORDS_MAX))
    return " ".join(words[a:a + WORDS_MAX])


def _distance(turn, t):
    end = turn["end"] if turn["end"] is not None else turn["start"]
    if turn["start"] <= t <= max(end, turn["start"]):
        return 0.0
    return min(abs(t - turn["start"]), abs(t - end))


def _nearest(lt, t, skip=()):
    """The turn nearest the moment `t`, preferring one of WORDS_MIN words or more and one not in `skip`."""
    def key(i):
        long_enough = len(lt[i]["text"].split()) >= WORDS_MIN
        return (i in skip, not long_enough, _distance(lt[i], t), lt[i]["start"])
    return min(range(len(lt)), key=key)


def _frac(turn, t):
    if turn["end"] is None or turn["end"] <= turn["start"]:
        return 0.5
    return (t - turn["start"]) / (turn["end"] - turn["start"])


def _centres(windows):
    """The moments of the two least alike parts: per `vec.two_means` group, the middle of the window nearest
    the group's centroid. One window gives one moment; none gives none."""
    ws = [w for w in windows or [] if w.get("vector")]
    if not ws:
        return []
    if len(ws) == 1:
        return [(float(ws[0]["start"]) + float(ws[0]["end"])) / 2.0]
    big, small, share, groups = vec.two_means([w["vector"] for w in ws])
    out = []
    for g, c in ((0, big), (1, small)):
        members = [w for w, k in zip(ws, groups) if k == g]
        if not members:
            continue
        rep = max(members, key=lambda w: (vec.cos(w["vector"], c), -float(w["start"])))
        out.append((float(rep["start"]) + float(rep["end"])) / 2.0)
    return out


def pick(label_windows, turns, label):
    """`[{at, text}]` — two quotes of `label` (fewer only when it has fewer turns), in time order."""
    lt = label_turns(turns, label)
    if not lt:
        return []
    moments = _centres(label_windows)
    if not moments:
        moments = [lt[0]["start"], lt[-1]["start"]]
    chosen = []
    for t in moments[:2]:
        i = _nearest(lt, t, skip={c for c, _ in chosen})
        if i in {c for c, _ in chosen}:
            continue
        chosen.append((i, t))
    if len(chosen) == 1 and len(lt) > 1:
        # one part only (one window, or groups that met in one turn): the turn farthest from it
        i0, t0 = chosen[0]
        far = max((i for i in range(len(lt)) if i != i0),
                  key=lambda i: (len(lt[i]["text"].split()) >= WORDS_MIN, abs(lt[i]["start"] - lt[i0]["start"])))
        chosen.append((far, lt[far]["start"]))
    chosen.sort(key=lambda c: lt[c[0]]["start"])
    return [{"at": at(lt[i]["start"]), "text": excerpt(lt[i]["text"], _frac(lt[i], t))} for i, t in chosen]
