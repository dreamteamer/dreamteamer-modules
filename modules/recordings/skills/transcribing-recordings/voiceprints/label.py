"""`label <record> [--only <label>]` — the developer's listening session (design section 13).

For each diarised label it picks 6 windows of 4 to 8 s spread over the recording, always including the
first, middle and last third of any turn longer than five minutes, and plays them in shuffled order
WITHOUT showing the label. The person answers a digit for an attendee, `x` for unsure, overlap or noise,
or `r` to replay. The answers go to

    <store>/calibration-labels/<audio>/<diarization>.json
      {version, audio, diarization, record: {workspace, record}, candidates: [<person ref>…],
       labels: {<label>: {windows: [{start, end, answer: <person ref> | "x"}]}}, complete, updated}

written after every answer, so an interrupted session keeps what was heard. `--only <label>` replays one
label and keeps the others' answers. Nothing else is written anywhere.

A window is cut from the recording by ffmpeg into a temp file, played with `afplay` on macOS or
`ffplay -nodisp -autoexit` elsewhere, and removed after; with neither player it stops before anything
and names both.

Standard library only (the `engines.py` rule); the record is read through an injected reader.
"""
from __future__ import annotations

import os
import random
import re
import shutil
import subprocess
import sys
import tempfile

from voiceprints import segments as vp_segments
from voiceprints import signatures as vp_signatures
from voiceprints import store as vp_store

WINDOWS = 6           # windows per label
WIN_MIN, WIN_MAX = 4.0, 8.0
LONG_TURN = 300.0     # a turn longer than this gets a window in each of its thirds
JOIN_GAP = 1.0        # a label's segments closer than this are one stretch to cut windows from
MAX_DIGITS = 9

USAGE = "label <record.md> [--only <label>] --context <file.json>"


class NoPlayer(Exception):
    """Neither afplay nor ffplay is on PATH."""


class LabelError(Exception):
    """The recording cannot be labelled (no diarisation, no audio, no segments)."""


# -- the store path -----------------------------------------------------------------------------------
_SAFE = re.compile(r"[0-9A-Za-z_.-]+")


def labels_path(store, audio, diarization):
    """`<store>/calibration-labels/<audio>/<diarization>.json`."""
    for what, v in (("audio key", audio), ("diarisation id", diarization)):
        if not isinstance(v, str) or not _SAFE.fullmatch(v) or v in (".", ".."):
            raise ValueError(f"not a usable {what}: {v!r}")
    return os.path.join(store.calibration_labels_dir(), audio, f"{diarization}.json")


# -- which windows ------------------------------------------------------------------------------------
def _label_key(label):
    m = re.fullmatch(r"(.*?)(\d+)", label or "")
    return (m.group(1), int(m.group(2))) if m else (label or "", -1)


def _stretches(segs, label):
    """The label's segments, those under JOIN_GAP apart joined: `[(start, end)]` in time order."""
    out = []
    for s in sorted((s for s in segs if s["speaker"] == label), key=lambda s: (float(s["start"]), float(s["end"]))):
        a, b = float(s["start"]), float(s["end"])
        if b <= a:
            continue
        if out and a - out[-1][1] < JOIN_GAP:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return [(a, b) for a, b in out]


def _pieces(a, b):
    """`[a, b]` cut into windows of at most WIN_MAX seconds; a remainder under WIN_MIN is left out."""
    out = []
    while b - a >= WIN_MIN - 1e-9:
        e = min(b, a + WIN_MAX)
        out.append((round(a, 3), round(e, 3)))
        a = e
    return out


def choose_windows(segs, label, n=WINDOWS):
    """`[(start, end)]` in time order: `n` windows of 4 to 8 s of `label`, spread over the label's whole
    time range, always including a window in the first, middle and last third of every turn of the label
    longer than five minutes (so a long turn may give more than `n`). A label with no stretch of 4 s gets
    its longest stretches as they are."""
    segs = [{"speaker": s["speaker"], "start": float(s["start"]), "end": float(s["end"])} for s in segs]
    stretches = _stretches(segs, label)
    cands = [p for a, b in stretches for p in _pieces(a, b)]
    if not cands:
        return sorted(sorted(stretches, key=lambda w: (-(w[1] - w[0]), w[0]))[:n])
    must = []
    for t in vp_segments.turns(segs):
        if t["speaker"] != label or t["end"] - t["start"] <= LONG_TURN:
            continue
        third = (t["end"] - t["start"]) / 3.0
        for i in range(3):
            lo, hi = t["start"] + i * third, t["start"] + (i + 1) * third
            centre = (lo + hi) / 2.0
            inside = [w for w in cands if lo <= (w[0] + w[1]) / 2.0 <= hi]
            if inside:
                w = min(inside, key=lambda w: (abs((w[0] + w[1]) / 2.0 - centre), w[0]))
            else:
                w = (round(max(t["start"], centre - WIN_MAX / 2), 3), round(min(t["end"], centre + WIN_MAX / 2), 3))
            if w not in must:
                must.append(w)
    rest = [w for w in cands if w not in must]
    k = max(0, n - len(must))
    return sorted(set(must) | set(vp_segments.spread(rest, k) if k else []))


# -- the player ---------------------------------------------------------------------------------------
def find_player(which=shutil.which, platform=sys.platform):
    """The command that plays a WAV and returns when it ends: `afplay` on macOS, `ffplay -nodisp
    -autoexit` elsewhere (or on a Mac without afplay). Neither: NoPlayer naming both."""
    if platform == "darwin" and which("afplay"):
        return ["afplay"]
    if which("ffplay"):
        return ["ffplay", "-nodisp", "-autoexit", "-loglevel", "error"]
    raise NoPlayer("label needs an audio player and found none: afplay (macOS) or ffplay (part of ffmpeg: "
                   "`brew install ffmpeg`, `apt install ffmpeg`) on PATH")


def ffmpeg_cutter(which=shutil.which, runner=subprocess.run):
    """`cut(audio, start, end, dst)`: one window of the recording into a mono 16 kHz WAV with ffmpeg."""
    if not which("ffmpeg"):
        raise NoPlayer("label cuts each window with ffmpeg, which is not on PATH")

    def cut(audio, start, end, dst):
        r = runner(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-ss", f"{start:.3f}", "-t",
                    f"{max(0.1, end - start):.3f}", "-i", audio, "-vn", "-ac", "1", "-ar", "16000", dst],
                   capture_output=True, text=True)
        if r.returncode != 0:
            raise LabelError(f"ffmpeg could not cut {start:.1f}-{end:.1f} s: {(r.stderr or '').strip()[:200]}")
    return cut


def player(cmd, runner=subprocess.run):
    def play(path):
        runner(cmd + [path], capture_output=True)
    return play


# -- the segments of the diarisation ------------------------------------------------------------------
def _seconds(ts):
    try:
        parts = [int(p) for p in str(ts).split(":")]
    except ValueError:
        return None
    total = 0
    for p in parts:
        total = total * 60 + p
    return float(total)


def recording_segments(rctx, audio_sha, *, read, read_cache, cache_path_for, matches):
    """The diarisation segments of the record's current transcript: the ASR cache when it is this
    record's, this audio's and this diarisation's (its words under `speaker_0` when diarisation was
    skipped), else the transcript's own `[mm:ss] Speaker N:` turns. Returns `(segments, where)`."""
    fm, body = read(rctx["record_path"])
    t = (fm or {}).get("transcription") or {}
    diar = t.get("diarization_id") or rctx.get("diarization_id")
    cache = read_cache(cache_path_for(rctx["record_path"]))
    if matches(cache, rctx.get("record"), audio_sha, diar):
        segs = list(cache.get("segments") or [])
        if not segs:
            segs = vp_signatures.word_segments((cache.get("asr") or {}).get("words") or [])
        if segs:
            return segs, "the ASR cache"
    spans = vp_segments.body_spans(vp_segments.parse_body_turns(body), _seconds(t.get("duration")))
    segs = [{"speaker": lab, "start": a, "end": b} for lab, ss in spans.items() for a, b in ss]
    if segs:
        return segs, "the transcript's timestamps"
    raise LabelError("no diarisation segments: no ASR cache of this transcript and no timestamped turns in it — "
                     "transcribe it again (step 0)")


# -- the session --------------------------------------------------------------------------------------
def _fresh(rctx, audio, diar, cands):
    return {"version": 1, "audio": audio, "diarization": diar,
            "record": {"workspace": rctx.get("workspace"), "record": rctx.get("record")},
            "candidates": [c["person"] for c in cands], "labels": {}, "complete": False}


def session(rctx, store, *, audio_sha, segments, ask, play, cut, out, only=None, seed=None):
    """Play every chosen window of every label (or of `only`) shuffled, ask who speaks, write the answers.
    Returns the answers file's path."""
    diar = rctx.get("diarization_id")
    if not diar:
        raise LabelError(f"{rctx.get('record')} has no diarisation id — transcribe it again first (step 0)")
    if not rctx.get("audio"):
        raise LabelError(f"{rctx.get('record')} has no audio this machine can read")
    labels = sorted({s["speaker"] for s in segments}, key=_label_key)
    if only is not None:
        if only not in labels:
            raise LabelError(f"{rctx.get('record')} has no label {only} in this diarisation")
        labels = [only]
    seen, cands = set(), []
    for c in rctx.get("candidates") or []:
        if c.get("person") and c["person"] not in seen:
            seen.add(c["person"])
            cands.append(c)
    cands = cands[:MAX_DIGITS]
    path = labels_path(store, audio_sha, diar)
    data = store.read_json(path) if only is not None else None
    if not isinstance(data, dict) or data.get("diarization") != diar:
        data = _fresh(rctx, audio_sha, diar, cands)
    data["candidates"] = [c["person"] for c in cands]
    data["complete"] = False
    items = []
    for lab in labels:
        data["labels"][lab] = {"windows": []}
        items.extend((lab, w) for w in choose_windows(segments, lab))
    random.Random(seed if seed is not None else f"label:{audio_sha}:{diar}:{only or ''}").shuffle(items)

    choices = "  ".join(f"{i} {c.get('name') or c['person']}" for i, c in enumerate(cands, 1))
    out(f"{rctx.get('record')}: {len(items)} windows of {len(labels)} diarised label"
        f"{'' if len(labels) == 1 else 's'}, shuffled. Answer {choices or 'x'}"
        f"{'' if not cands else ', x'} for unsure, overlap, noise or anyone else, r to replay.")
    tmp = tempfile.mkdtemp(prefix="dt-label-")
    try:
        for i, (lab, (a, b)) in enumerate(items, 1):
            clip = os.path.join(tmp, f"window-{i}.wav")
            cut(rctx["audio"], a, b, clip)
            try:
                play(clip)
                while True:
                    ans = (ask(f"[{i}/{len(items)}] who speaks? {choices}  x unsure  r replay > ") or "").strip().lower()
                    if ans == "r":
                        play(clip)
                        continue
                    if ans == "x":
                        answer = "x"
                        break
                    if ans.isdigit() and 1 <= int(ans) <= len(cands):
                        answer = cands[int(ans) - 1]["person"]
                        break
                    out(f"answer a digit from 1 to {len(cands)}, x or r")
            finally:
                try:
                    os.remove(clip)
                except FileNotFoundError:
                    pass
            data["labels"][lab]["windows"].append({"start": a, "end": b, "answer": answer})
            data["updated"] = vp_store.now()
            store.write_json(path, data)
        data["complete"] = True
        data["updated"] = vp_store.now()
        store.write_json(path, data)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    out(f"answers written: {path}")
    return path


# -- the verb -----------------------------------------------------------------------------------------
def _flag(args, name):
    if name in args:
        i = args.index(name)
        if i + 1 >= len(args):
            raise LabelError(f"{name} needs a value")
        return args[i + 1]
    return None


def main(args, *, ctx=None, store=None, read=None, read_cache=None, cache_path_for=None, matches=None,
         audio_key=None, which=shutil.which, platform=sys.platform, ask=input, out=print, runner=subprocess.run):
    """`label <record.md> [--only <label>] --context <file>` (args[0] is `label`). Returns the exit code."""
    try:
        play = player(find_player(which=which, platform=platform), runner=runner)
        cut = ffmpeg_cutter(which=which, runner=runner)
    except NoPlayer as e:
        out(f"✖ {e}")
        return 1
    try:
        only = _flag(args, "--only")
        if ctx is None:
            import json
            path = _flag(args, "--context")
            if not path:
                raise LabelError("no --context: run it through the module's entry (`transcribe.mjs label <record>`)")
            with open(path, encoding="utf-8") as f:
                ctx = json.load(f)
        if isinstance(ctx.get("records"), list):
            raise LabelError("label takes one recording")
        if store is None:
            store = vp_store.Store(vp_store.default_home(), guard=ctx.get("guard") or {})
        audio_sha = audio_key(ctx, ctx.get("audio"))
        segs, where = recording_segments(ctx, audio_sha, read=read, read_cache=read_cache,
                                         cache_path_for=cache_path_for, matches=matches)
        out(f"segments from {where}")
        session(ctx, store, audio_sha=audio_sha, segments=segs, ask=ask, play=play, cut=cut, out=out, only=only)
        return 0
    except (LabelError, vp_store.StoreRefused, OSError, ValueError) as e:
        out(f"✖ {e}")
        return 1
    except (KeyboardInterrupt, EOFError):
        out("stopped — the answers given so far are kept")
        return 130
