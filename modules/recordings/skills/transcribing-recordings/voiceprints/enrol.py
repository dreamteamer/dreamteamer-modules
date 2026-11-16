"""Enrolment (design section 9): the checks a confirmed label passes before it teaches a voice print,
admission against the print as it stood, trust, the reseed notice, corrections (section 11), and ONE
replay that every rebuild and every live confirmation share.

A print's `sources` are the confirmation log. Each source is

    {audio, diarization, label, workspace, person, condition, seconds, confirmed, status, reason}

`status` is either COMPUTED by the replay — `admitted`, `held`, `uncalibrated` (ruling D4: the
confirmation failed only check 2) — and judged again from the start by every replay, or a person's
EXCLUSION stored as an input to every replay — `reseeded` (`prints reseed`) and `corrected` (a confirmed
name corrected to another person); an exclusion also carries `at`. A source holds a person's reference,
never their name: the only name in a print is in `known_as`.

The replay (`replay`, ruling D6) is one pass over every source of every print of a model, in the total
order `(confirmed, workspace, audio, diarization, label)` (person last, as a tie that should never
arise); checks 7 and 8 and admission bullet 4 read the other prints as they stand at that point of the
pass. `confirm` runs the same pass with the new confirmations in it, so a live answer and a rebuild from
nothing give the same prints and statuses. Both hold `Store.lock(model id)` (ruling D3).

Checks 4 and 5, the label centroid and step 3 are `naming`'s (ruling D15): imported, never re-implemented.

Standard library only (the `engines.py` rule).
"""
from __future__ import annotations

import copy
import hashlib
import os
from datetime import timezone

from . import naming, vec
from .store import check_model, now, parse_instant

# The plan's placeholders, for tests only until a calibration exists (equal to naming.UNCALIBRATED).
PLACEHOLDERS = {"accept": 0.80, "accept_open": 0.85, "margin": 0.10, "same": 0.75, "split": 0.55, "suggest": 0.65}

MIN_SPEECH = naming.MIN_SPEECH      # check 3: 20 s of speech
TRUST_SOURCES = 2                   # a print is trusted with at least two admitted sources ...
TRUST_SECONDS = 60.0                # ... and at least 60 s of speech across them

ADMITTED, HELD, UNCALIBRATED = "admitted", "held", "uncalibrated"
RESEEDED, CORRECTED = "reseeded", "corrected"
EXCLUSIONS = (RESEEDED, CORRECTED)  # a person's act, stored; every replay reads it

# Checks whose failure keeps a confirmation as a source rather than out of the print: 2 (no
# calibration: `uncalibrated`, judged again by the next replay with thresholds) and 7 as amended in
# design review round 5 (below `accept` against the person's print so far: `held`, counted by the
# reseed notice and replayed).
_KEEPS_A_SOURCE = (2, 7)

_SOURCE_KEYS = ("audio", "diarization", "label", "workspace", "person", "condition", "seconds", "confirmed",
                "status", "reason")


def reseed_notice(name, person):
    """The one sentence the reply and `prints` both use when a print is stuck on its first source."""
    return (f"{name}'s first recording may hold two voices; `prints reseed {person}` starts their voice print "
            f"again from their next confirmed recording.")


def _namesake_notice():
    return ("a person with this name was forgotten in another workspace; if this is the same person, run "
            "`prints forget` here")


# -- small helpers ----------------------------------------------------------------------------------------
def _norm(name):
    return " ".join(str(name or "").split()).casefold()


def _ref(s):
    return {"audio": s["audio"], "diarization": s["diarization"], "label": s["label"]}


def _ref_key(s):
    return (s.get("audio"), s.get("diarization"), s.get("label"))


def _known(p, workspace, person=None):
    for k in p.get("known_as") or []:
        if k.get("workspace") == workspace and (person is None or k.get("person") == person):
            return k
    return None


def _print_of(prints, workspace, person):
    for p in prints:
        if _known(p, workspace, person):
            return p
    return None


def _labels(sig):
    return (sig or {}).get("labels") or {}


def _has_windows(sig, label):
    st = _labels(sig).get(label)
    if not st or label in set((sig or {}).get("removed") or []):
        return False
    return any(w.get("vector") for w in st.get("windows") or [])


def _model_dict(model):
    return {"id": model.id, "sha256": model.sha256, "dim": model.dim}


def _today():
    return now()[:10]


def _tie(s):
    return tuple(str(s.get(k) or "") for k in ("workspace", "audio", "diarization", "label", "person"))


def _instant(c):
    try:
        return (1, parse_instant(c).astimezone(timezone.utc).timestamp())
    except (ValueError, TypeError):
        return (0, 0.0)


def total_order(s):
    """The replay's order (design review round 5): the confirmation instant (compared as instants, so
    offsets do not matter; a source with none sorts first), then workspace, audio, diarisation, label,
    and the person reference as a last tie."""
    return (_instant(s.get("confirmed")),) + _tie(s)


def _key_fn(order):
    if order is None:
        return total_order
    return lambda s: (order(s),) + _tie(s)


def _never_entry(who, never):
    """never.json matches by workspace and reference, and by name in other workspaces."""
    for e in never or []:
        if e.get("workspace") == who.get("workspace"):
            if e.get("person") and e.get("person") == who.get("person"):
                return e
        elif e.get("name") and _norm(e["name"]) == _norm(who.get("name")):
            return e
    return None


def _forgotten_entry(who, confirmed, forgotten):
    """The forgotten.json entry carrying this person's workspace and reference whose `at` is after the
    confirmation. A confirmation with no readable instant counts as before (nothing is brought back)."""
    for e in forgotten or []:
        if not any(k.get("workspace") == who.get("workspace") and k.get("person") == who.get("person")
                   for k in e.get("known_as") or []):
            continue
        try:
            when = parse_instant(e.get("at"))
        except ValueError:
            continue
        try:
            c = parse_instant(confirmed)
        except (ValueError, TypeError):
            return e
        if c < when:
            return e
    return None


def _namesake(who, forgotten):
    """A forgotten person of another workspace who shares only the name (under no reference of this one)."""
    for e in forgotten or []:
        ks = e.get("known_as") or []
        if any(k.get("workspace") == who.get("workspace") and k.get("person") == who.get("person") for k in ks):
            continue
        if any(k.get("workspace") != who.get("workspace") and k.get("name")
               and _norm(k["name"]) == _norm(who.get("name")) for k in ks):
            return e
    return None


class _Memo:
    """What one pass computes once per signature: label centroids, check 5 and step 3 (`naming.usable`),
    each a robust centroid or a spherical 2-means over up to 80 windows. Keyed by audio, diarisation and
    label; a pass reads each signature file once, so the key names one content."""

    def __init__(self):
        self._c = {}

    def _get(self, key, fn):
        if key not in self._c:
            self._c[key] = fn()
        return self._c[key]

    @staticmethod
    def _sk(sig):
        return ((sig or {}).get("audio"), ((sig or {}).get("diarization") or {}).get("id"))

    def centroid(self, sig, label):
        return self._get(("c",) + self._sk(sig) + (label,), lambda: naming.label_centroid(sig, label))

    def two_voices(self, sig, label, split):
        return self._get(("5",) + self._sk(sig) + (label, split), lambda: naming.two_voices(label, sig, split))

    def usable(self, sig, th):
        hint = ((sig or {}).get("diarization") or {}).get("speakers_hint")
        key = ("u",) + self._sk(sig) + (tuple(sorted(th.items())),)
        return self._get(key, lambda: naming.usable(sig, hint, hint is not None, th))


# -- trust ------------------------------------------------------------------------------------------------
def trust(p):
    """`trusted` with at least two admitted sources and at least 60 s of speech across them, else
    `proposing`. Held, uncalibrated and excluded sources never count."""
    adm = [s for s in p.get("sources") or [] if s.get("status") == ADMITTED]
    secs = sum(float(s.get("seconds") or 0.0) for s in adm)
    return "trusted" if len(adm) >= TRUST_SOURCES and secs >= TRUST_SECONDS else "proposing"


# -- checks 1 to 10 ---------------------------------------------------------------------------------------
def _judge(label, sig, who, own, others, never, th, different, memo=None):
    memo = memo or _Memo()
    out = []

    def fail(n, why):
        out.append({"check": n, "reason": f"check {n}: {why}"})

    if _never_entry(who, never):
        fail(1, "this person's voice must not be stored")
    if th is None:
        fail(2, "no calibration for the active speaker model; the name is kept and `prints rebuild` judges "
                "this recording once one exists")
    st = _labels(sig).get(label) or {}
    seconds = float(st.get("seconds") or 0.0)
    windows = _has_windows(sig, label)
    if not windows:
        fail(3, "no voice windows are kept for this speaker label")
    elif seconds < MIN_SPEECH:
        fail(3, f"less than {MIN_SPEECH:.0f} s of speech ({seconds:.0f} s)")
    if naming.long_turn(label, sig):
        fail(4, "a turn over five minutes or most of the speech: it can be named, it cannot teach")
    cent = memo.centroid(sig, label) if windows else None
    if th is not None and cent is not None:
        if memo.two_voices(sig, label, th["split"]):
            fail(5, "its windows hold two distinct voices")
        removed = set((sig or {}).get("removed") or [])
        for other in sorted(_labels(sig)):
            if other == label or other in removed:
                continue
            c = memo.centroid(sig, other)
            if c is not None and vec.cos(cent, c) >= th["same"]:
                fail(6, f"it sounds like {naming.display(other)} of the same recording")
                break
        if own is not None and own.get("vector"):
            s = vec.cos(cent, own["vector"])
            if s < th["accept"]:
                fail(7, f"it scores {s:.2f} against this person's voice print so far, below accept "
                        f"{th['accept']:.2f}; kept aside")
        for q in others:
            if q.get("vector") and vec.cos(cent, q["vector"]) >= th["accept"]:
                fail(8, f"it matches the voice print of another person known in this workspace "
                        f"(score {vec.cos(cent, q['vector']):.2f})")
                break
    if own is not None and any(_ref_key(n) == (sig.get("audio"), (sig.get("diarization") or {}).get("id"), label)
                               for n in own.get("negatives") or []):
        fail(9, "this speaker label was corrected as not this person")
    if different:
        fail(10, "the user said the label holds different people")
    return out


def checks(label, sig, person, prints, never, thresholds, user_said_different=False):
    """Design section 9's checks 1 to 10 for `label` of the signature `sig` confirmed as `person`
    (`{workspace, person, name}`), against `prints` (a list or a mapping, each as it stands BEFORE this
    label is added) and `never` (never.json's entries). `thresholds` None means no calibration (check 2).
    Each comparison is against things that do not contain the label: check 6 the other labels, check 7
    the person's own print, check 8 the prints of other people known in the person's workspace.

    Returns the failures in check order, `[{check, reason}]`; empty when all pass. Check 2 alone makes an
    `uncalibrated` source, check 7 a `held` one; any other failure keeps the label out of every print."""
    ps = list(prints.values()) if isinstance(prints, dict) else list(prints or [])
    own = _print_of(ps, person.get("workspace"), person.get("person"))
    others = [q for q in ps if q is not own and _known(q, person.get("workspace"))]
    return _judge(label, sig, person, own, others, never, thresholds, user_said_different)


# -- the replay -------------------------------------------------------------------------------------------
def _new_pid(workspace, person, taken):
    h = hashlib.sha256(f"{workspace}\0{person}".encode("utf-8")).hexdigest()
    n = 8
    while "p-" + h[:n] in taken and n < len(h):
        n += 2
    return "p-" + h[:n]


def _shell(p, model):
    """A print reduced to its inputs: identity, names, negatives, the correction hold; no vector, no
    sources yet (the replay appends them)."""
    out = {"version": 1, "id": p["id"], "known_as": copy.deepcopy(p.get("known_as") or []),
           "model": _model_dict(model), "vector": None, "seconds": 0.0, "trust": "proposing", "auto": True,
           "sources": [], "negatives": copy.deepcopy(p.get("negatives") or []),
           "created": p.get("created") or _today(), "updated": p.get("updated") or _today()}
    if p.get("auto_hold") is not None:
        out["auto_hold"] = p["auto_hold"]
    return out


def _source(item, sig, status, reason):
    s = {k: item.get(k) for k in _SOURCE_KEYS}
    s["seconds"] = float((_labels(sig).get(item["label"]) or {}).get("seconds") or 0.0) if sig else \
        float(item.get("seconds") or 0.0)
    s["status"], s["reason"] = status, reason
    return s


def _essence(p):
    return {k: v for k, v in p.items() if k not in ("created", "updated")}


def _stuck(p):
    ss = p.get("sources") or []
    return sum(s.get("status") == ADMITTED for s in ss) == 1 and sum(s.get("status") == HELD for s in ss) >= 2


def _run(store, model, th, stored, new=(), order=None):
    """The one pass. `stored` are the prints as read (inputs only are used), `new` confirmations not yet
    stored. Returns `(work, report)`, `work` the prints by id as they should now be stored."""
    never, forgotten = store.never(), store.forgotten()
    work, cents, adm_audio = {}, {}, {}
    for p in stored:
        work[p["id"]] = _shell(p, model)
        cents[p["id"]], adm_audio[p["id"]] = [], set()
    report = {"stored": [], "kept_out": [], "dropped": [], "skipped": [], "notices": [], "changed": [],
              "removed": [], "prints": {}}

    items = []
    for p in stored:
        for s in p.get("sources") or []:
            items.append(("stored", p["id"], dict(s)))
    for c in new:
        items.append(("new", None, dict(c)))
    key = _key_fn(order)
    items.sort(key=lambda it: (key(it[2]), 0 if it[0] == "stored" else 1))

    sigs = {}

    def sig_of(audio, diar):
        k = (audio, diar)
        if k not in sigs:
            sigs[k] = store.read_signature(model.id, audio, diar, model=model)
        return sigs[k]

    seen = set()
    namesakes = set()
    memo = _Memo()
    for kind, pid, s in items:
        ws, person = s.get("workspace"), s.get("person")
        target = work.get(pid) if kind == "stored" else _print_of(work.values(), ws, person)
        name = (_known(target, ws, person) or {}).get("name") if target else None
        who = {"workspace": ws, "person": person, "name": s.get("name") if kind == "new" else name}
        where = dict(_ref(s), workspace=ws, person=person)

        dup = (_ref_key(s), ws, person)
        if dup in seen:
            if kind == "stored":
                report["dropped"].append(dict(where, print=pid, why="a second copy of one confirmation"))
            continue

        if _never_entry(who, never):
            if kind == "stored":
                report["skipped"].append(dict(where, print=pid, why="never"))
            else:
                report["kept_out"].append(dict(where, checks=[{"check": 1, "reason":
                                                               "check 1: this person's voice must not be stored"}]))
            continue
        f = _forgotten_entry(who, s.get("confirmed"), forgotten)
        if f:
            if kind == "stored":
                report["skipped"].append(dict(where, print=pid, why="forgotten"))
            else:
                report["kept_out"].append(dict(where, checks=[{"check": None, "reason":
                                                               "this person was forgotten after this confirmation"}]))
            continue
        if _namesake(who, forgotten) and (pid or person, ws) not in namesakes:
            namesakes.add((pid or person, ws))
            report["notices"].append({"kind": "namesake", "print": pid, "workspace": ws, "person": person,
                                      "text": _namesake_notice()})

        sig = sig_of(s["audio"], s["diarization"])
        if kind == "stored" and (sig is None or not _has_windows(sig, s["label"])):
            why = "its diarisation file is gone" if sig is None else "its voice windows are gone"
            report["dropped"].append(dict(where, print=pid, why=why))
            continue
        seen.add(dup)

        if kind == "stored" and s.get("status") in EXCLUSIONS:
            kept = {k: s.get(k) for k in _SOURCE_KEYS}
            kept["at"] = s.get("at")
            target["sources"].append(kept)
            continue

        others = [q for q in work.values() if q is not target and _known(q, ws)]
        fails = _judge(s["label"], sig, who, target, others, never, th, s.get("different"), memo) if sig else \
            [{"check": 3, "reason": "check 3: no voice signature is kept for this diarisation"}]
        out = [x for x in fails if x["check"] not in _KEEPS_A_SOURCE]
        cent = None
        if out and kind == "new":
            report["kept_out"].append(dict(where, checks=fails))
            continue
        if out:
            status, reason = HELD, "; ".join(x["reason"] for x in out)
        elif any(x["check"] == 2 for x in fails):
            status, reason = UNCALIBRATED, "; ".join(x["reason"] for x in fails)
        elif fails:
            status, reason = HELD, "; ".join(x["reason"] for x in fails)
        else:
            cent = memo.centroid(sig, s["label"])
            status, reason = _admit(s, sig, cent, target, cents, work, adm_audio, th, memo)

        if target is None:
            pid = _new_pid(ws, person, set(work))
            target = work[pid] = {"version": 1, "id": pid,
                                  "known_as": [{"workspace": ws, "person": person, "name": s.get("name") or ""}],
                                  "model": _model_dict(model), "vector": None, "seconds": 0.0, "trust": "proposing",
                                  "auto": True, "sources": [], "negatives": [], "created": _today(),
                                  "updated": _today()}
            cents[pid], adm_audio[pid] = [], set()
        pid = target["id"]
        src = _source(s, sig, status, reason)
        target["sources"].append(src)
        if status == ADMITTED:
            cents[pid].append(cent)
            adm_audio[pid].add(s["audio"])
            target["vector"] = vec.mean_unit(cents[pid])
        if kind == "new":
            report["stored"].append(dict(where, print=pid, status=status, reason=reason))

    by_id = {p["id"]: p for p in stored}
    for pid, p in work.items():
        _finish(p, by_id.get(pid), th, sig_of, memo)
        report["prints"][pid] = {"trust": p["trust"], "auto": p["auto"],
                                 "admitted": sum(s["status"] == ADMITTED for s in p["sources"]),
                                 "held": sum(s["status"] == HELD for s in p["sources"]),
                                 "sources": len(p["sources"])}
    return work, report


def _admit(s, sig, cent, target, cents, work, adm_audio, th, memo):
    """Admission (design section 9) of a source that passed checks 1 to 10: the first is admitted; a later
    one is judged once against the print as it stands before it."""
    if target is None or not cents.get(target["id"]):
        return ADMITTED, None
    P = target["vector"]
    label = s["label"]
    u = memo.usable(sig, th)          # step 3 with the file's speakers_hint as the count
    if u["outcome"] in ("collapsed", naming.MIXED):
        return HELD, f"admission: the diarisation is {u['outcome']}; kept aside"
    if label in u["flags"]:
        return HELD, "admission: the speaker label may hold more than one voice; kept aside"
    score = vec.cos(cent, P)
    if score < th["accept"]:
        return HELD, f"admission: it scores {score:.2f} against the voice print, below accept {th['accept']:.2f}"
    removed = set((sig or {}).get("removed") or [])
    for other in sorted(_labels(sig)):
        if other == label or other in removed:
            continue
        c = memo.centroid(sig, other)
        if c is not None and score - vec.cos(c, P) < th["margin"]:
            return HELD, (f"admission: it does not beat {naming.display(other)} of the same recording against "
                          f"the voice print by the margin ({score - vec.cos(c, P):.2f}); kept aside")
    for q in work.values():
        if q is target or not q.get("vector") or s["audio"] not in adm_audio.get(q["id"], ()):
            continue
        lead = score - vec.cos(cent, q["vector"])
        if lead < th["margin"]:
            return HELD, (f"admission: it does not beat another voice print admitted in this recording by the "
                          f"margin ({lead:.2f}); kept aside")
    return ADMITTED, None


def _finish(p, old, th, sig_of, memo):
    """Trust, seconds, negatives and `auto` once every source is in."""
    adm = [s for s in p["sources"] if s["status"] == ADMITTED]
    p["seconds"] = round(sum(float(s.get("seconds") or 0.0) for s in adm), 3)
    p["trust"] = trust(p)
    kept, gone = [], False
    for n in p.get("negatives") or []:
        sig = sig_of(n.get("audio"), n.get("diarization"))
        if sig is not None and _has_windows(sig, n.get("label")):
            kept.append(n)
        else:
            gone = True
    p["negatives"] = kept
    if gone and old is not None and old.get("auto") is False:
        # Design section 8: the print then needs one new source and a passed trust test before `auto`.
        p["auto_hold"] = sum(s.get("status") == ADMITTED for s in old.get("sources") or [])
    hold = p.get("auto_hold")
    if not kept and hold is None:
        p["auto"] = True
        return
    ok = th is not None and bool(p["vector"]) and p["trust"] == "trusted" and (hold is None or len(adm) > hold)
    if ok:
        for n in kept:
            c = memo.centroid(sig_of(n["audio"], n["diarization"]), n["label"])
            if c is not None and vec.cos(c, p["vector"]) >= th["suggest"]:
                ok = False
                break
    p["auto"] = ok


def _persist(store, model, stored, work, report):
    by_id = {p["id"]: p for p in stored}
    for pid, p in work.items():
        old = by_id.get(pid)
        if not p["sources"]:
            if old is not None:
                try:
                    os.remove(store.print_path(model.id, pid))
                except FileNotFoundError:
                    pass
                report["removed"].append(pid)
                report["changed"].append(pid)
            continue
        if old is None or _essence(old) != _essence(p):
            p["updated"] = _today()
            store.write_print(model.id, p)
            report["changed"].append(pid)


def _stored_prints(store, model):
    return store.prints(model.id, model=model)


def replay(store, model, thresholds, order=None):
    """Rebuild every print of `model` from its sources, from nothing: one pass over all of them in the
    total order (`order=None`) or by `order(source)` with the total order breaking ties (ruling D6: the
    calibration passes recording date then label). Computed statuses are judged again; `reseeded` and
    `corrected` are kept as the person left them. Skips the sources of a person in never.json and every
    confirmation before a matching forgotten.json entry's `at`; drops a source whose diarisation file or
    label windows are gone; removes a print left with no source. Holds `store.lock(model.id)`.

    Returns `{prints: {pid: {trust, auto, admitted, held, sources}}, changed, removed, dropped, skipped,
    notices, stuck}`. A print of another model raises `store.ModelMismatch`."""
    with store.lock(model.id):
        stored = _stored_prints(store, model)
        work, report = _run(store, model, thresholds, stored, (), order)
        _persist(store, model, stored, work, report)
    report["stuck"] = sorted(pid for pid, p in work.items() if _stuck(p))
    return report


def confirm(store, model, thresholds, confirmations):
    """Apply a person's confirmations (`{audio, diarization, label, workspace, person, name, confirmed,
    condition?, different?}`; `confirmed` an instant, `now()` when absent) in the same pass and order as
    `replay`, so the result is what a rebuild from nothing gives. A confirmation failing a check other
    than 2 or 7 is not stored (`kept_out`, with every failing check); check 2 alone stores it
    `uncalibrated`; check 7 stores it `held`. Confirming a label already a source of that person adds
    nothing.

    Returns `replay`'s report plus `stored` (each confirmation stored, with its print, status and reason)
    and `kept_out`; `notices` carries the reseed notice once, when a print first has one admitted and two
    held sources, in the confirming workspace's name for the person."""
    stamp = now()
    new = []
    for c in confirmations or []:
        c = dict(c)
        for k in ("audio", "diarization", "label", "workspace", "person"):
            if not c.get(k):
                raise ValueError(f"a confirmation needs {k}: {c!r}")
        c["confirmed"] = c.get("confirmed") or stamp
        parse_instant(c["confirmed"])
        c.setdefault("condition", None)
        new.append(c)
    with store.lock(model.id):
        stored = _stored_prints(store, model)
        before = {p["id"] for p in stored if _stuck(p)}
        work, report = _run(store, model, thresholds, stored, new)
        _persist(store, model, stored, work, report)
    touched = {}
    for s in report["stored"]:
        touched.setdefault(s["print"], s["workspace"])
    for pid, ws in touched.items():
        p = work.get(pid)
        if p is not None and _stuck(p) and pid not in before:
            k = _known(p, ws) or (p.get("known_as") or [{}])[0]
            report["notices"].append({"kind": "reseed", "print": pid, "workspace": ws, "person": k.get("person"),
                                      "text": reseed_notice(k.get("name"), k.get("person"))})
    report["stuck"] = sorted(pid for pid, p in work.items() if _stuck(p))
    return report


def _read_print(store, model, pid):
    p = store.read_json(store.print_path(model.id, pid))
    if p is None:
        raise KeyError(f"no voice print {pid} for {model.id}")
    check_model(p, model)
    return p


def reseed(store, model, thresholds, pid, at):
    """`prints reseed`: mark the print's first admitted source (in the total order) `reseeded` with the
    instant `at`, a stored exclusion every later replay reads, and replay. The print then starts again
    from the next confirmed recording. A print with no admitted source raises ValueError."""
    parse_instant(at)
    with store.lock(model.id):
        p = _read_print(store, model, pid)
        adm = sorted((s for s in p.get("sources") or [] if s.get("status") == ADMITTED), key=total_order)
        if not adm:
            raise ValueError(f"voice print {pid} has no admitted source to start again without")
        first = adm[0]
        first["status"], first["at"] = RESEEDED, at
        first["reason"] = "prints reseed: the voice print starts again from the next confirmed recording"
        store.write_print(model.id, p)
        report = replay(store, model, thresholds)
    report["reseeded"] = dict(_ref(first), print=pid)
    return report


def correct_confirmed(store, model, thresholds, source_ref, from_pid, to_person, at=None):
    """A confirmed name corrected to another person (design review round 5): the source is marked
    `corrected` in the wrong print — a person's act, so 'never unseated by learning' still holds — and the
    label is confirmed for `to_person` (`{workspace, person, name}`) at `at`, through the checks, in one
    replay. Returns `confirm`'s report plus `corrected: {print, audio, diarization, label}`."""
    at = at or now()
    parse_instant(at)
    want = _ref_key(source_ref)
    with store.lock(model.id):
        p = _read_print(store, model, from_pid)
        hit = [s for s in p.get("sources") or [] if _ref_key(s) == want and s.get("status") not in EXCLUSIONS]
        if not hit:
            raise KeyError(f"voice print {from_pid} has no source {want}")
        for s in hit:
            s["status"], s["at"] = CORRECTED, at
            s["reason"] = "corrected: the person said this voice is someone else"
        store.write_print(model.id, p)
        c = dict(_ref(source_ref), workspace=to_person["workspace"], person=to_person["person"],
                 name=to_person.get("name"), confirmed=at, condition=hit[0].get("condition"))
        report = confirm(store, model, thresholds, [c])
    report["corrected"] = dict(_ref(source_ref), print=from_pid)
    if from_pid not in report["changed"]:
        report["changed"].append(from_pid)
    return report


def correct_provisional(store, model, source_ref, pid):
    """A name a print WROTE corrected (design section 11): the label becomes a negative of that print and
    its `auto` turns false. A replay turns it back only when the print is trusted and scores below
    `suggest` against every negative."""
    neg = _ref(source_ref)
    with store.lock(model.id):
        p = _read_print(store, model, pid)
        negs = p.setdefault("negatives", [])
        if not any(_ref_key(n) == _ref_key(neg) for n in negs):
            negs.append(neg)
        p["auto"] = False
        p["updated"] = _today()
        store.write_print(model.id, p)
    return {"print": pid, "negative": neg, "auto": False}


def carry(store, from_model_id, model):
    """Start `model`'s folder from the prints of another model folder: each print's identity, `known_as`,
    negatives and sources as inputs (computed statuses dropped, exclusions kept), with no vector. A print
    already in the target folder is left alone. `replay` then builds them; `prints rebuild` after a model
    change is this, then `replay`. Returns the ids carried."""
    carried = []
    with store.lock(model.id):
        have = {p["id"] for p in store.prints(model.id)}
        for p in store.prints(from_model_id):
            if p["id"] in have:
                continue
            q = _shell(p, model)
            q["auto"] = p.get("auto", True)
            for s in p.get("sources") or []:
                s = {k: s.get(k) for k in _SOURCE_KEYS + ("at",) if k in s}
                if s.get("status") not in EXCLUSIONS:
                    s.pop("status", None)
                    s.pop("reason", None)
                    s.pop("at", None)
                q["sources"].append(s)
            store.write_print(model.id, q)
            carried.append(p["id"])
    return carried
