"""Diarisation segments: the diarisation id, turns, per-label statistics, embedding windows, and the
`[mm:ss] Speaker N:` turns of a transcript body (design sections 4 and 7).

A segment is a dict `{speaker, start, end}` (what the diariser and render.py use); a
`(speaker, start, end)` sequence is read the same way. Standard library only.
"""
from __future__ import annotations

import bisect
import hashlib
import json
import math
import re

LONG_SEGMENT = 10.0   # a segment longer than this is cut into windows
WINDOW = 6.0          # the length of a cut window
MAX_WINDOWS = 80      # windows kept per label, spread over its whole time range
MIN_SPEECH = 2.0      # a window is embedded when it holds at least this much speech
FRAME = 0.02          # the frame the speech check drops near-silent frames from
FLOOR_DB = -45.0      # a frame below this RMS level (dBFS) is near-silent


def _seg(s):
    if isinstance(s, dict):
        return s["speaker"], float(s["start"]), float(s["end"])
    speaker, start, end = s[0], s[1], s[2]
    return speaker, float(start), float(end)


def _sorted(segments):
    return sorted((_seg(s) for s in segments), key=lambda t: (t[1], t[2], t[0]))


def diarization_id(segments):
    """First 12 hex characters of the sha256 of the canonical JSON of
    `[[speaker, round(start, 3), round(end, 3)], ...]`, sorted by start."""
    rows = [[sp, round(st, 3), round(en, 3)] for sp, st, en in _sorted(segments)]
    rows.sort(key=lambda r: (r[1], r[2], r[0]))
    canon = json.dumps(rows, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(canon.encode("ascii")).hexdigest()[:12]


def turns(segments):
    """Maximal runs of one label's consecutive segments with no other label's segment starting between
    them, in time order: `[{speaker, start, end}]`. A turn runs from its first segment's start to the
    latest end among its segments."""
    out = []
    for sp, st, en in _sorted(segments):
        if out and out[-1]["speaker"] == sp:
            out[-1]["end"] = max(out[-1]["end"], en)
        else:
            out.append({"speaker": sp, "start": st, "end": en})
    return out


def label_stats(segments):
    """`{label: {seconds, share, longest_turn}}` — seconds of segments, that label's share of all
    labels' seconds, and its longest turn in seconds."""
    segs = _sorted(segments)
    seconds = {}
    for sp, st, en in segs:
        seconds[sp] = seconds.get(sp, 0.0) + max(0.0, en - st)
    total = sum(seconds.values())
    longest = {}
    for t in turns(segs):
        longest[t["speaker"]] = max(longest.get(t["speaker"], 0.0), t["end"] - t["start"])
    return {
        sp: {
            "seconds": secs,
            "share": (secs / total) if total > 0 else 0.0,
            "longest_turn": longest.get(sp, 0.0),
        }
        for sp, secs in seconds.items()
    }


def cut_windows(segments, label, long=LONG_SEGMENT, size=WINDOW):
    """The candidate embedding windows of one label, in time order, as `(start, end)`.

    A segment of `long` seconds or less is one window as it is; a longer one is cut into consecutive
    `size`-second windows, the last one holding the remainder (the speech check drops it when short).
    """
    out = []
    for sp, st, en in _sorted(segments):
        if sp != label or en <= st:
            continue
        if en - st <= long:
            out.append((st, en))
            continue
        n = int(math.ceil((en - st) / size - 1e-9))
        for i in range(n):
            a = st + i * size
            b = min(en, a + size)
            if b - a > 1e-9:
                out.append((a, b))
    return out


def spread(windows, k=MAX_WINDOWS):
    """At most `k` of `windows`, spread evenly over their whole time range (not over their index), the
    first and the last always kept. Each window's time is its start (`w[0]`). Fewer than `k` come back
    unchanged; otherwise the result is in time order."""
    ws = list(windows)
    if len(ws) <= k:
        return ws
    if k <= 0:
        return []
    order = sorted(range(len(ws)), key=lambda i: (ws[i][0], i))
    ws = [ws[i] for i in order]
    times = [w[0] for w in ws]
    n = len(ws)
    if k == 1:
        return [ws[0]]
    t0, t1 = times[0], times[-1]
    picked = {0, n - 1}
    if t1 <= t0:
        for i in range(1, k - 1):
            picked.add(int(round(i * (n - 1) / (k - 1))))
        return [ws[i] for i in sorted(picked)]
    for i in range(1, k - 1):
        target = t0 + i * (t1 - t0) / (k - 1)
        j = bisect.bisect_left(times, target)
        lo, hi, best = j - 1, j, None
        while lo >= 0 or hi < n:
            if hi >= n or (lo >= 0 and target - times[lo] <= times[hi] - target):
                c, lo = lo, lo - 1
            else:
                c, hi = hi, hi + 1
            if c not in picked:
                best = c
                break
        if best is not None:
            picked.add(best)
    return [ws[i] for i in sorted(picked)]


def speech_seconds(frame_rms, frame=FRAME, floor_db=FLOOR_DB):
    """Seconds of speech in a window: its `frame`-second frames whose RMS level (1.0 full scale) is at
    least `floor_db` dBFS. Near-silent frames are dropped; a window is embedded when this is at least
    MIN_SPEECH."""
    floor = 10.0 ** (floor_db / 20.0)
    return sum(1 for r in frame_rms if r > 0 and r >= floor) * frame


# `[02:14] Speaker 0: text`, `[100:05] …`, `[1:40:05] …`, optionally bold: `**[02:14] Speaker 0:** text`
_BODY_TURN = re.compile(
    r"^\s*(?:\*\*)?\[(?:(\d+):([0-5]\d):([0-5]\d)|(\d+):([0-5]\d))\]\s*(?:\*\*)?\s*"
    r"Speaker\s+(\d+)\s*:\s*(?:\*\*)?\s?(.*?)\s*$"
)


def parse_body_turns(body):
    """The timestamped turns of a transcript body, in body order: `[{label, start, text}]`.

    Reads `[mm:ss] Speaker N: text` with minutes of two or more digits (`[100:05]`) and
    `[h:mm:ss] Speaker N: text`; `Speaker N` is the label `speaker_N` (render.py writes `Speaker 0` for
    `speaker_0`); `text` is the rest of the line. A line with no timestamp is not a turn, so a body with
    no timestamps maps nothing."""
    out = []
    for line in (body or "").splitlines():
        m = _BODY_TURN.match(line)
        if not m:
            continue
        h, hm, hs, mm, ms, n, text = m.groups()
        if h is not None:
            start = int(h) * 3600 + int(hm) * 60 + int(hs)
        else:
            start = int(mm) * 60 + int(ms)
        out.append({"label": f"speaker_{int(n)}", "start": float(start), "text": text})
    return out


def body_spans(turns, duration):
    """`{label: [(start, end)]}` from body turns: each turn lasts until the next one starts, the last
    until `duration`. With no `duration` the last turn's end is unknown and it is left out; a turn of no
    length is left out."""
    ordered = sorted(turns, key=lambda t: float(t["start"]))
    out = {}
    for i, t in enumerate(ordered):
        start = float(t["start"])
        if i + 1 < len(ordered):
            end = float(ordered[i + 1]["start"])
        elif duration is not None:
            end = float(duration)
        else:
            continue
        if end > start:
            out.setdefault(t["label"], []).append((start, end))
    return out


def overlap_map(old_spans, new_segments):
    """For each old label, the new label its time overlaps most: `{old: {new_label, share}}`, `share`
    the part of the old label's time that new label covers. No overlap gives `new_label: None` and
    `share: 0.0`; a tie goes to the label that sorts first."""
    new = _sorted(new_segments)
    out = {}
    for old, spans in old_spans.items():
        total = sum(max(0.0, e - s) for s, e in spans)
        by_new = {}
        for s, e in spans:
            for sp, st, en in new:
                o = min(e, en) - max(s, st)
                if o > 0:
                    by_new[sp] = by_new.get(sp, 0.0) + o
        if not by_new or total <= 0:
            out[old] = {"new_label": None, "share": 0.0}
            continue
        best = sorted(by_new.items(), key=lambda kv: (-kv[1], kv[0]))[0]
        out[old] = {"new_label": best[0], "share": best[1] / total}
    return out
