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

An entry whose key is not the label it sat on (an `earlier:<key>`, carried from an older diarisation) also
carries `label`: that label of `diarization_id`, so a later forget reaches its windows (task 10, finding
`earlier-key-drops-its-label`). A forgotten mark carries `forgotten_at`, the forget's instant: a source named
or confirmed after it lifts the mark (design section 8 step 4, finding
`sticky-forgotten-overrides-later-confirmation`); a mark with no instant stays.

The old label's time comes from the old segments when the caller hands a matching ASR cache, else from
the `[mm:ss] Speaker N:` turns of the body `run` is about to replace, each turn lasting until the next
starts. Two old labels on one new label are both `offered: false`; so is an old label mapped nowhere.
`/identify-speakers` offers the others as proposals; nothing here is ever a name.

No earlier name is ever lost by transcribing again: the entries of an earlier `previous_speakers` are
carried too, offered or not, forgotten or not, and a part of the map that cannot be read is kept as it
was written under `unreadable` (`earlier` reads it all, before any audio is decoded, and never raises).

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


def _unset(v):
    return v is None or (isinstance(v, str) and v.strip() == "")


def _label(v):
    return v.strip() if isinstance(v, str) and v.strip() else None


def earlier(fm):
    """`(entries, unreadable)`: every earlier name the record holds, read so that nothing in it can raise.

    `entries` are `{key, at, name, source?, forgotten?}` — the names of `speakers` (with their
    `speaker_sources` entry) on their own label, then every entry of an earlier `previous_speakers`,
    offered or not, forgotten or not: on the label it was mapped to (`at`, a label of the diarisation the
    record holds now) when that label is free, else under its own key as `earlier:<key>`; `at` is None
    when it was mapped nowhere. The same name twice on one label is one entry. `unreadable` is
    `[{field, value}]`, each part that is not the shape it should be, kept as it was written (with the
    earlier run's own `unreadable`), so transcribing again loses nothing of the record."""
    unreadable, entries = [], []
    t = (fm or {}).get("transcription") if isinstance(fm, dict) else None
    if t is None:
        return entries, unreadable
    if not isinstance(t, dict):
        return entries, [{"field": "transcription", "value": t}]

    def a_map(v, field):
        if v is None:
            return {}
        if isinstance(v, dict):
            return v
        unreadable.append({"field": field, "value": v})
        return {}

    names = {}
    for k, v in a_map(t.get("speakers"), "transcription.speakers").items():
        if _named(v):
            names[str(k)] = v.strip()
        elif not _unset(v):
            unreadable.append({"field": f"transcription.speakers.{k}", "value": v})
    sources = {}
    for k, v in a_map(t.get("speaker_sources"), "transcription.speaker_sources").items():
        if str(k) not in names:
            continue
        if isinstance(v, dict):
            sources[str(k)] = dict(v)
        elif v is not None:
            unreadable.append({"field": f"transcription.speaker_sources.{k}", "value": v})
    for k in sorted(names):
        e = {"key": k, "at": k, "name": names[k]}
        if k in sources:
            e["source"] = sources[k]
        entries.append(e)

    prev = t.get("previous_speakers")
    if prev is not None and not isinstance(prev, dict):
        unreadable.append({"field": "transcription.previous_speakers", "value": prev})
        prev = None
    if prev is not None:
        old = prev.get("unreadable")
        if isinstance(old, list):
            unreadable[:0] = [u for u in old if isinstance(u, dict) and "field" in u]
        elif old is not None:
            unreadable.append({"field": "transcription.previous_speakers.unreadable", "value": old})
        keys = {e["key"] for e in entries}
        for k, e in a_map(prev.get("labels"), "transcription.previous_speakers.labels").items():
            k = str(k)
            if not isinstance(e, dict) or not _named(e.get("name")):
                unreadable.append({"field": f"transcription.previous_speakers.labels.{k}", "value": e})
                continue
            name, at = e["name"].strip(), _label(e.get("new_label"))
            same = next((x for x in entries if x["at"] == at and _same_name(x["name"], name)), None)
            if same is not None:   # the same claim twice: one entry, nothing of either lost
                if "source" not in same and isinstance(e.get("source"), dict):
                    same["source"] = dict(e["source"])
                if e.get("forgotten") is True and not _lifted(same, e.get("forgotten_at")):
                    same["forgotten"] = True
                    if e.get("forgotten_at"):
                        same["forgotten_at"] = e["forgotten_at"]
                continue
            key = at if at and at not in keys else (k if k.startswith("earlier:") else f"earlier:{k}")
            base, n = key, 2
            while key in keys:
                key, n = f"{base}#{n}", n + 1
            keys.add(key)
            x = {"key": key, "at": at, "name": name}
            if isinstance(e.get("source"), dict):
                x["source"] = dict(e["source"])
            if e.get("forgotten") is True:
                x["forgotten"] = True
                if e.get("forgotten_at"):
                    x["forgotten_at"] = e["forgotten_at"]
            entries.append(x)
    return entries, unreadable


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _cache_spans(cache, duration):
    """`{label: [(start, end)]}` from a matching ASR cache's segments, any malformed segment left out."""
    asr = cache.get("asr") if isinstance(cache.get("asr"), dict) else {}
    old_duration = _num(asr.get("duration")) or duration
    good = []
    raw = cache.get("segments") if isinstance(cache.get("segments"), list) else []
    for s in raw:
        if isinstance(s, dict) and _label(s.get("speaker")) and _num(s.get("start")) is not None \
                and _num(s.get("end")) is not None:
            good.append({"speaker": s["speaker"].strip(), "start": _num(s["start"]), "end": _num(s["end"])})
    spans = {}
    for s in _effective(good, old_duration):
        spans.setdefault(s["speaker"], []).append((float(s["start"]), float(s["end"])))
    return spans


def previous(fm, body, cache_or_none, new_segments, duration, earlier_names=None, spans_out=None):
    """`transcription.previous_speakers` for a record `run` is about to transcribe again, or None when its
    transcription holds no name and nothing unreadable. `cache_or_none` is the old ASR cache, handed only
    when it matches the record, the audio and the old diarisation id (`meeting_io.asr_cache_matches`);
    `body` is the body about to be replaced; `new_segments` and `duration` are this run's.
    `earlier_names` is `earlier(fm)` when the caller read it already. `spans_out`, when given, is filled
    with each carried entry's earlier time (`{key: [(start, end)]}`), for `forgotten_new_labels`.

    Every earlier name survives: one whose time is known is mapped to the new label it overlaps most;
    one whose time is not (mapped nowhere before, no timestamps) keeps `new_label: null`, `offered:
    false`. A name marked forgotten stays forgotten and is never offered."""
    entries, unreadable = earlier_names if earlier_names is not None else earlier(fm)
    if not entries and not unreadable:
        return None
    t = (fm or {}).get("transcription") if isinstance(fm, dict) else None
    note = None
    if isinstance(cache_or_none, dict):
        spans = _cache_spans(cache_or_none, duration)
    else:
        turns = vp_segments.parse_body_turns(body if isinstance(body, str) else "")
        spans = vp_segments.body_spans(turns, duration)
        if not turns and entries:
            note = NO_TIMESTAMPS
    placed = sorted({e["at"] for e in entries if e["at"]})
    mapped = vp_segments.overlap_map({at: spans.get(at, []) for at in placed}, _effective(new_segments, duration))
    landed = {}
    for e in entries:
        nl = mapped[e["at"]]["new_label"] if e["at"] else None
        if nl:
            landed[nl] = landed.get(nl, 0) + 1
    labels = {}
    for e in entries:
        m = mapped[e["at"]] if e["at"] else {"new_label": None, "share": 0.0}
        x = {"name": e["name"]}
        if "source" in e:
            x["source"] = e["source"]
        if e["at"] and e["key"] != e["at"]:
            x["label"] = e["at"]          # the label of `diarization_id` it sat on (finding earlier-key-drops-its-label)
        x["new_label"] = m["new_label"]
        x["share"] = round(m["share"], 3)
        x["offered"] = bool(m["new_label"]) and landed[m["new_label"]] == 1 and not e.get("forgotten")
        if e.get("forgotten"):
            x["forgotten"] = True
            if e.get("forgotten_at"):
                x["forgotten_at"] = e["forgotten_at"]
        labels[e["key"]] = x
        if spans_out is not None:
            spans_out[e["key"]] = list(spans.get(e["at"], [])) if e["at"] else []
    out = {"diarization_id": t.get("diarization_id") if isinstance(t, dict) else None, "labels": labels}
    if note:
        out["note"] = note
    if unreadable:
        out["unreadable"] = unreadable
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


def _source_instant(entry):
    src = entry.get("source") if isinstance(entry.get("source"), dict) else {}
    return _instant(src.get("named") or src.get("confirmed"))


def _lifted(entry, forgotten_at):
    """Whether `entry`'s own source was named or confirmed after the forget's instant `forgotten_at` — a later
    enrolment that lifts a forgotten mark (design section 8 step 4). A mark with no instant is never lifted:
    privacy first."""
    at = _instant(forgotten_at)
    named = _source_instant(entry)
    if at is None or named is None:
        return False
    return named > at


def _forgotten(entry, forgotten_entries, workspace):
    """The instant (`at`) of the forgotten.json entry that forgets this carried name in `workspace`, or None:
    matched by the source's `person`, or — when no source names a person — by the name string, against each
    entry's `known_as` for this workspace. A name confirmed after that entry's `at` is a later enrolment, not
    forgotten (design section 8, step 4)."""
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
                return f.get("at") if isinstance(f.get("at"), str) and f.get("at") else True
    return None


FORGOTTEN_UNPLACED = "an earlier speaker who was forgotten cannot be placed in this transcript"


def _union(spans):
    out = []
    for a, b in sorted(spans):
        if b <= a:
            continue
        if out and a <= out[-1][1]:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return out


def _mostly(forgotten_spans, new_segments):
    """The new labels more than half of whose time lies inside `forgotten_spans`."""
    cover = _union(forgotten_spans)
    total, inside = {}, {}
    for s in new_segments or []:
        try:
            label, a, b = s["speaker"], float(s["start"]), float(s["end"])
        except (KeyError, TypeError, ValueError):
            continue
        if b <= a:
            continue
        total[label] = total.get(label, 0.0) + (b - a)
        inside[label] = inside.get(label, 0.0) + sum(max(0.0, min(b, y) - max(a, x)) for x, y in cover)
    return {label for label in total if inside[label] > 0.5 * total[label]}


def forgotten_new_labels(previous, forgotten_entries, workspace, spans=None, new_segments=None):
    """The new labels that carry the earlier name of a person forgotten in `workspace` (seam 5): their
    windows are never embedded and they go to the signature file's `removed`. A carried name is
    forgotten when `forgotten.json` says so (`_forgotten`) or an earlier run already marked it and no
    source of its own was named or confirmed after the mark's `forgotten_at`; each is marked in place
    `offered: false, forgotten: true, forgotten_at: <the forget's instant>`, so it is never proposed. Removed are the new
    label each such name was mapped to and — given `spans` (`previous(..., spans_out=)`) and this run's
    `new_segments` — every new label whose time is mostly (over half) those names' earlier time, so an
    over-split voice keeps no windows on any of its pieces."""
    out = set()
    if not previous or not workspace:
        return out
    gone = []
    for key, e in (previous.get("labels") or {}).items():
        marked = e.get("forgotten") is True and not _lifted(e, e.get("forgotten_at"))
        if e.get("forgotten") is True and not marked:      # confirmed again after the forget: enrols again
            e.pop("forgotten", None)
            e.pop("forgotten_at", None)
        at = None if marked else _forgotten(e, forgotten_entries, workspace)
        if marked or at:
            e["offered"] = False
            e["forgotten"] = True
            if isinstance(at, str):
                e["forgotten_at"] = at
            if e.get("new_label"):
                out.add(e["new_label"])
            gone.extend((spans or {}).get(key) or [])
    if gone and new_segments:
        out |= _mostly(gone, new_segments)
    return out


def forgotten_unplaced(previous):
    """Whether a carried name marked forgotten could not be placed in this transcript (`new_label`
    null: no timestamps, no matching cache, no overlap). Then none of this diarisation's windows are
    kept: there is no telling which label is that person's voice."""
    return any(isinstance(e, dict) and e.get("forgotten") is True and not e.get("new_label")
               for e in ((previous or {}).get("labels") or {}).values())
