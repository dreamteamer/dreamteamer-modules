"""Earlier names, carried across a re-run (design section 7, seam 5).

`run` writes no name. Over a record that has names it moves `speakers`, `speaker_sources` and the old
`diarization_id` to `transcription.previous_speakers`, each old label with the new label its time
overlaps most:

    previous_speakers:
      diarization_id: 0123456789ab           # the diarisation the old labels belong to (null before 0.6.0)
      labels:
        speaker_0: {name: Dana Oren, source: {...}, new_label: speaker_1, share: 0.93, offered: true}
        speaker_1: {name: Sam Diaz, new_label: null, share: 0.0, offered: false, forgotten: true}
      note: ...                              # only when the earlier transcript has no timestamps

The old label's time comes from the old segments when the caller hands a matching ASR cache, else from
the `[mm:ss] Speaker N:` turns of the body `run` is about to replace, each turn lasting until the next
starts. Two old labels on one new label are both `offered: false`; so is an old label mapped nowhere.
`/identify-speakers` offers the others as proposals; nothing here is ever a name.

Standard library only.
"""
from __future__ import annotations

from datetime import datetime

from voiceprints import segments as vp_segments
from voiceprints import store as vp_store

NO_TIMESTAMPS = ("the earlier transcript has no timestamps, so no earlier name is mapped to a new label; "
                 "the names stay here")


def _effective(segments, duration):
    """The diariser's segments, or — when it gave none (one speaker declared, or a fallback) — the one
    label render.py writes, `speaker_0`, over the whole recording."""
    segs = list(segments or [])
    if segs:
        return segs
    try:
        d = float(duration or 0.0)
    except (TypeError, ValueError):
        d = 0.0
    return [{"speaker": "speaker_0", "start": 0.0, "end": d}] if d > 0 else []


def _named(v):
    return isinstance(v, str) and v.strip() != ""


def _carried_names(t):
    """`(names, sources)` of the old transcription: its `speakers` with a name, their `speaker_sources`
    entries, and — for a record transcribed again before `/identify-speakers` ran — each still-offered
    entry of its own `previous_speakers`, on the label it was mapped to (unless that label has a name)."""
    names = {k: v.strip() for k, v in (t.get("speakers") or {}).items() if _named(v)}
    sources = {k: dict(v) for k, v in (t.get("speaker_sources") or {}).items()
               if k in names and isinstance(v, dict)}
    prev = t.get("previous_speakers")
    if isinstance(prev, dict):
        for e in (prev.get("labels") or {}).values():
            if not isinstance(e, dict) or not e.get("offered") or e.get("forgotten"):
                continue
            nl = e.get("new_label")
            if nl and nl not in names and _named(e.get("name")):
                names[nl] = e["name"].strip()
                if isinstance(e.get("source"), dict):
                    sources[nl] = dict(e["source"])
    return names, sources


def previous(fm, body, cache_or_none, new_segments, duration):
    """`transcription.previous_speakers` for a record `run` is about to transcribe again, or None when its
    transcription names nobody. `cache_or_none` is the old ASR cache, handed only when it matches the
    record, the audio and the old diarisation id (`meeting_io.asr_cache_matches`); `body` is the body
    about to be replaced; `new_segments` and `duration` are this run's."""
    t = (fm or {}).get("transcription") or {}
    if not isinstance(t, dict):
        return None
    names, sources = _carried_names(t)
    if not names:
        return None
    note = None
    if cache_or_none is not None:
        old_duration = (cache_or_none.get("asr") or {}).get("duration") or duration
        spans = {}
        for s in _effective(cache_or_none.get("segments"), old_duration):
            spans.setdefault(s["speaker"], []).append((float(s["start"]), float(s["end"])))
    else:
        turns = vp_segments.parse_body_turns(body)
        spans = vp_segments.body_spans(turns, duration)
        if not turns:
            note = NO_TIMESTAMPS
    mapped = vp_segments.overlap_map({old: spans.get(old, []) for old in names},
                                     _effective(new_segments, duration))
    landed = {}
    for m in mapped.values():
        if m["new_label"]:
            landed[m["new_label"]] = landed.get(m["new_label"], 0) + 1
    labels = {}
    for old in sorted(names):
        m = mapped[old]
        e = {"name": names[old]}
        if old in sources:
            e["source"] = sources[old]
        e["new_label"] = m["new_label"]
        e["share"] = round(m["share"], 3)
        e["offered"] = bool(m["new_label"]) and landed[m["new_label"]] == 1
        labels[old] = e
    out = {"diarization_id": t.get("diarization_id"), "labels": labels}
    if note:
        out["note"] = note
    return out


def _instant(s):
    """An instant with an offset, or None. PyYAML reads an unquoted `named:` as a datetime already."""
    if isinstance(s, datetime):
        return s if s.tzinfo is not None and s.utcoffset() is not None else None
    try:
        return vp_store.parse_instant(s)
    except (TypeError, ValueError):
        return None


def _same_name(a, b):
    return _named(a) and _named(b) and a.strip().casefold() == b.strip().casefold()


def _forgotten(entry, forgotten_entries, workspace):
    """Whether a carried name is a person forgotten in `workspace`: matched by the source's `person`, or —
    when no source names a person — by the name string, against each forgotten.json entry's `known_as`
    for this workspace. A name confirmed after that entry's `at` is a later enrolment, not forgotten
    (design section 8, step 4)."""
    src = entry.get("source") if isinstance(entry.get("source"), dict) else {}
    person = src.get("person")
    named = _instant(src.get("named") or src.get("confirmed"))
    for f in forgotten_entries or []:
        if not isinstance(f, dict):
            continue
        at = _instant(f.get("at"))
        for ka in f.get("known_as") or []:
            if not isinstance(ka, dict) or ka.get("workspace") != workspace:
                continue
            hit = (ka.get("person") == person) if person else _same_name(ka.get("name"), entry.get("name"))
            if hit and (named is None or at is None or named < at):
                return True
    return False


def forgotten_new_labels(previous, forgotten_entries, workspace):
    """The new labels that carry the earlier name of a person forgotten in `workspace` (seam 5): their
    windows are never embedded and they go to the signature file's `removed`. Each such carried name is
    marked in place `offered: false, forgotten: true`, so it is never proposed."""
    out = set()
    if not previous or not workspace:
        return out
    for e in (previous.get("labels") or {}).values():
        if _forgotten(e, forgotten_entries, workspace):
            e["offered"] = False
            e["forgotten"] = True
            if e.get("new_label"):
                out.add(e["new_label"])
    return out
