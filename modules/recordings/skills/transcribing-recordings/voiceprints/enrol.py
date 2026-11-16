"""Enrolment (design section 9): the checks a confirmed label passes before it teaches a voice print,
admission against the print as it stood, trust, the reseed notice, corrections (section 11), and ONE
replay that every rebuild and every live confirmation share.

A print's `sources` are the confirmation log. Each source is

    {audio, diarization, label, workspace, person, condition, seconds, confirmed, status, reason}

`status` is either COMPUTED by the replay — `admitted`, `held`, `uncalibrated` (ruling D4: the
confirmation failed only check 2) — and judged again from the start by every replay, or a person's
EXCLUSION stored as an input to every replay — `reseeded` (`prints reseed`) and `corrected` (a confirmed
name corrected to another person); an exclusion also carries `at`. A source the user said holds
different people also carries `different: true`, so every replay keeps check 10. A source holds a
person's reference, never their name: the only name in a print is in `known_as`.

Every confirmation is a source (review round 1), except one of a person in never.json (check 1: nothing
of them is stored), one made before a matching forgotten.json entry, and one whose label has no voice
windows (a replay drops it). A confirmation failing any other check is `held` with its checks and
reasons, out of the vector, and every replay judges it again, so a correction, a forget or a calibration
elsewhere can later let it teach. A recording (its audio key) teaches a print once: a second source of
the same audio — another diarisation, or the same label confirmed from a second workspace of the print —
is `held` ("the same recording already teaches this voice print").

One person in two workspaces (design section 8): a confirmation in workspace B of a person B has no
print for, whose label passes the label checks and reaches `accept` against a print B does not know, joins
that print when B's name equals that print's name elsewhere — B's `known_as` entry is added with `since`
(the joining confirmation's instant; the entry counts from that confirmation on, in every replay) and the
report says `recognised from your other workspace` — and otherwise starts B's own print and reports only
that the voice resembles a print from another workspace. No report names anything from elsewhere.

The replay (`replay`, ruling D6) is one pass over every source of every print of a model, in the total
order `(confirmed, workspace, audio, diarization, label)` (person last, as a tie that should never
arise); checks 7 and 8 and admission bullet 4 read the other prints as they stand at that point of the
pass. `confirm` runs the same pass with the new confirmations in it, so a live answer and a rebuild from
nothing give the same prints and statuses. When every new confirmation sorts after every stored source
and the store is as the last pass left it (`<model>/enrolment.json` holds a digest of the thresholds,
never.json, forgotten.json and the prints that pass wrote), `confirm` judges only the new confirmations
against the prints as they stand: a computed status depends only on what precedes it, so this is the
full pass's result without re-judging every source. Anything else — an earlier instant, a print written
outside a pass (a correction, a reseed, `carry`), other thresholds, a never or forget entry — replays
everything. Both hold `Store.lock(model id)` (ruling D3).

Checks 4 and 5, the label centroid and step 3 are `naming`'s (ruling D15): imported, never re-implemented.

Standard library only (the `engines.py` rule).
"""
from __future__ import annotations

import copy
import hashlib
import json
import os
import re
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

# Checks whose failure alone leaves a source that may still be admitted later in the pass's terms: 2 (no
# calibration: `uncalibrated`) and 7 as amended in design review round 5 (below `accept` against the
# person's print so far: `held`, counted by the reseed notice). Any other failing check also stores the
# confirmation `held` (review round 1), with every failing check in its reason and in `kept_out`.
_KEEPS_A_SOURCE = (2, 7)

_SOURCE_KEYS = ("audio", "diarization", "label", "workspace", "person", "condition", "seconds", "confirmed",
                "status", "reason")

SAME_RECORDING = "admission: the same recording already teaches this voice print; kept aside"
RECOGNISED = "recognised from your other workspace"
_CHECKS_IN = re.compile(r"(?:^|; )check (\d+):")


def _resembles_notice(person):
    return (f"this voice resembles a voice print from another workspace; if they are one person, "
            f"`prints link {person}` joins them")


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
    if item.get("different"):
        s["different"] = True
    return s


def _essence(p):
    return {k: v for k, v in p.items() if k not in ("created", "updated")}


def _speaks_to_the_seed(s):
    """A held source that scored poorly against the print: check 7 alone, or admission. A hold from a
    check on the label itself, or from a recording the print already learns from, says nothing about the
    first source and is not counted by the reseed notice."""
    if s.get("status") != HELD:
        return False
    reason = s.get("reason") or ""
    if reason == SAME_RECORDING:
        return False
    found = set(_CHECKS_IN.findall(reason))
    return not found or found == {"7"}


def _stuck(p):
    ss = p.get("sources") or []
    adm = {s.get("audio") for s in ss if s.get("status") == ADMITTED}
    held = {s.get("audio") for s in ss if _speaks_to_the_seed(s) and s.get("audio") not in adm}
    return len(adm) == 1 and len(held) >= 2


class _Stale(Exception):
    """The store is not as the last pass left it; the caller replays everything."""


def _run(store, model, th, stored, new=(), order=None, fast=False):
    """The one pass. `stored` are the prints as read, `new` confirmations not yet stored. Full (`fast`
    False): every stored print is reduced to its inputs and every source judged again in order. Fast: the
    stored prints are taken as they stand (the last pass's output) and only `new` is judged — the caller
    has checked that every new confirmation sorts after every stored source. Returns `(work, report)`,
    `work` the prints by id as they should now be stored. A fast pass that meets a source whose voice
    windows are gone raises `_Stale`."""
    never, forgotten = store.never(), store.forgotten()
    key = _key_fn(order)
    work, cents, adm, since = {}, {}, {}, {}
    for p in stored:
        pid = p["id"]
        if fast:
            work[pid] = copy.deepcopy(p)
            cents[pid] = None            # computed when the print learns a new source
            adm[pid] = [_ref_key(s) for s in p.get("sources") or [] if s.get("status") == ADMITTED]
        else:
            work[pid] = _shell(p, model)
            cents[pid], adm[pid] = [], []
        for e in p.get("known_as") or []:
            if e.get("since"):
                ks = [key(s) for s in p.get("sources") or []
                      if s.get("workspace") == e.get("workspace") and s.get("person") == e.get("person")]
                since[(pid, e.get("workspace"), e.get("person"))] = \
                    min(ks) if ks else (None if order is not None else (_instant(e["since"]),))
    report = {"stored": [], "kept_out": [], "dropped": [], "skipped": [], "notices": [], "changed": [],
              "removed": [], "prints": {}}

    def active(q, ws, person, k):
        """q's `known_as` entry for ws (and person) that counts at the pass's point k: an entry added by a
        join counts from its joining confirmation on."""
        for e in q.get("known_as") or []:
            if e.get("workspace") != ws or (person is not None and e.get("person") != person):
                continue
            sk = since.get((q["id"], ws, e.get("person"))) if e.get("since") else None
            if sk is None or k >= sk:
                return e
        return None

    items = []
    if not fast:
        for p in stored:
            for s in p.get("sources") or []:
                items.append(("stored", p["id"], dict(s)))
    for c in new:
        items.append(("new", None, dict(c)))
    items.sort(key=lambda it: (key(it[2]), 0 if it[0] == "stored" else 1))

    sigs = {}

    def sig_of(audio, diar):
        k = (audio, diar)
        if k not in sigs:
            sigs[k] = store.read_signature(model.id, audio, diar, model=model)
        return sigs[k]

    seen = set()
    if fast:
        for p in stored:
            for s in p.get("sources") or []:
                seen.add((_ref_key(s), s.get("workspace"), s.get("person")))
    namesakes = set()
    memo = _Memo()

    def join(s, sig, who, k):
        """Design section 8: the print from another workspace this label reaches `accept` against, joined
        when the names are equal. Returns `(print or None, notice or None)`."""
        if _judge(s["label"], sig, who, None, [], never, th, s.get("different"), memo):
            return None, None            # a label that cannot teach decides nothing
        ws, person = s.get("workspace"), s.get("person")
        cent = memo.centroid(sig, s["label"])
        best = None
        for q in sorted(work.values(), key=lambda q: q["id"]):
            if not q.get("vector") or active(q, ws, None, k):
                continue
            sc = vec.cos(cent, q["vector"])
            if sc >= th["accept"] and (best is None or sc > best[0]):
                best = (sc, q)
        if best is None:
            return None, None
        q = best[1]
        mine = _norm(s.get("name"))
        theirs = {_norm(e.get("name")) for e in q.get("known_as") or [] if e.get("workspace") != ws}
        if not mine or mine not in theirs:
            return None, {"kind": "resembles", "workspace": ws, "person": person,
                          "text": _resembles_notice(person)}
        e = _known(q, ws, person)
        if e is None:
            e = {"workspace": ws, "person": person, "name": s.get("name") or "", "since": s.get("confirmed")}
            q["known_as"].append(e)
        elif _instant(s.get("confirmed")) < _instant(e.get("since")):
            e["since"] = s.get("confirmed")
        sk = since.get((q["id"], ws, person))
        since[(q["id"], ws, person)] = k if sk is None or k < sk else sk
        return q, {"kind": "recognised", "workspace": ws, "person": person, "text": RECOGNISED}

    for kind, pid, s in items:
        k = key(s)
        ws, person = s.get("workspace"), s.get("person")
        if kind == "stored":
            target = work.get(pid)
        else:
            target = next((q for q in work.values() if active(q, ws, person, k)), None)
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
                report["kept_out"].append(dict(where, print=None, checks=[
                    {"check": 1, "reason": "check 1: this person's voice must not be stored"}]))
            continue
        f = _forgotten_entry(who, s.get("confirmed"), forgotten)
        if f:
            if kind == "stored":
                report["skipped"].append(dict(where, print=pid, why="forgotten"))
            else:
                report["kept_out"].append(dict(where, print=None, checks=[
                    {"check": None, "reason": "this person was forgotten after this confirmation"}]))
            continue
        if _namesake(who, forgotten) and (pid or person, ws) not in namesakes:
            namesakes.add((pid or person, ws))
            report["notices"].append({"kind": "namesake", "print": pid, "workspace": ws, "person": person,
                                      "text": _namesake_notice()})

        sig = sig_of(s["audio"], s["diarization"])
        if sig is None or not _has_windows(sig, s["label"]):
            if kind == "stored":
                why = "its diarisation file is gone" if sig is None else "its voice windows are gone"
                report["dropped"].append(dict(where, print=pid, why=why))
            else:                        # nothing to judge, now or in any replay: not stored
                why = ("no voice signature is kept for this diarisation" if sig is None
                       else "no voice windows are kept for this speaker label")
                report["kept_out"].append(dict(where, print=None, checks=[{"check": 3, "reason": f"check 3: {why}"}]))
            continue
        seen.add(dup)

        if kind == "stored" and s.get("status") in EXCLUSIONS:
            kept = {k2: s.get(k2) for k2 in _SOURCE_KEYS}
            kept["at"] = s.get("at")
            if s.get("different"):
                kept["different"] = True
            target["sources"].append(kept)
            continue

        notice = None
        if kind == "new" and target is None and th is not None:
            target, notice = join(s, sig, who, k)

        others = [q for q in work.values() if q is not target and active(q, ws, None, k)]
        fails = _judge(s["label"], sig, who, target, others, never, th, s.get("different"), memo)
        out = [x for x in fails if x["check"] not in _KEEPS_A_SOURCE]
        cent = None
        if out:
            status, reason = HELD, "; ".join(x["reason"] for x in fails)
        elif any(x["check"] == 2 for x in fails):
            status, reason = UNCALIBRATED, "; ".join(x["reason"] for x in fails)
        elif fails:
            status, reason = HELD, "; ".join(x["reason"] for x in fails)
        else:
            cent = memo.centroid(sig, s["label"])
            status, reason = _admit(s, sig, cent, target, adm, work, th, memo)

        if target is None:
            pid = _new_pid(ws, person, set(work))
            target = work[pid] = {"version": 1, "id": pid,
                                  "known_as": [{"workspace": ws, "person": person, "name": s.get("name") or ""}],
                                  "model": _model_dict(model), "vector": None, "seconds": 0.0, "trust": "proposing",
                                  "auto": True, "sources": [], "negatives": [], "created": _today(),
                                  "updated": _today()}
            cents[pid], adm[pid] = [], []
        pid = target["id"]
        target["sources"].append(_source(s, sig, status, reason))
        if status == ADMITTED:
            if cents[pid] is None:
                cents[pid] = []
                for a, d, lab in adm[pid]:
                    c = memo.centroid(sig_of(a, d), lab) if sig_of(a, d) is not None else None
                    if c is None:
                        raise _Stale(f"voice print {pid}: the windows of an admitted source are gone")
                    cents[pid].append(c)
            cents[pid].append(cent)
            adm[pid].append(_ref_key(s))
            target["vector"] = vec.mean_unit(cents[pid])
        if kind == "new":
            report["stored"].append(dict(where, print=pid, status=status, reason=reason))
            if out:
                report["kept_out"].append(dict(where, print=pid, checks=fails))
            if notice is not None:
                report["notices"].append(dict(notice, print=pid))

    by_id = {p["id"]: p for p in stored}
    for pid, p in work.items():
        _finish(p, by_id.get(pid), th, sig_of, memo)
        report["prints"][pid] = {"trust": p["trust"], "auto": p["auto"],
                                 "admitted": sum(s["status"] == ADMITTED for s in p["sources"]),
                                 "held": sum(s["status"] == HELD for s in p["sources"]),
                                 "sources": len(p["sources"])}
    return work, report


def _admit(s, sig, cent, target, adm, work, th, memo):
    """Admission (design section 9) of a source that passed checks 1 to 10: a recording already teaching
    the print is held; the first source is admitted; a later one is judged once against the print as it
    stands before it."""
    if target is None:
        return ADMITTED, None
    mine = adm.get(target["id"]) or []
    if any(r[0] == s["audio"] for r in mine):
        return HELD, SAME_RECORDING
    if not mine:
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
    me = _ref_key(s)
    for q in work.values():
        if q is target or not q.get("vector"):
            continue
        here = [r for r in adm.get(q["id"]) or [] if r[0] == s["audio"]]
        if not here or all(r == me for r in here):
            continue                  # a print taught by this very label is not another voice in it
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
    if hold is not None and th is not None and p["trust"] == "trusted" and len(adm) > hold:
        del p["auto_hold"]            # met once: a later forget-recording cannot bring it back
        hold = None
    if not kept and hold is None:
        p["auto"] = True
        return
    ok = th is not None and bool(p["vector"]) and p["trust"] == "trusted" and hold is None
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


# -- what the last pass left (so a live answer judges only what is new) ---------------------------------------
def _state_path(store, model):
    return os.path.join(store.model_dir(model.id), "enrolment.json")


def _digest(th, never, forgotten, prints):
    body = {"thresholds": th, "never": never, "forgotten": forgotten,
            "prints": sorted((_essence(p) for p in prints if p.get("sources")), key=lambda p: p["id"])}
    return hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def _save_state(store, model, th, work, order=None):
    """Written by every pass: what it read and the prints it left. A custom-order pass leaves no state a
    live answer can build on."""
    d = None if order is not None else _digest(th, store.never(), store.forgotten(), list(work.values()))
    store.write_json(_state_path(store, model), {"version": 1, "digest": d})


def _can_judge_only_new(store, model, th, stored, new):
    state = store.read_json(_state_path(store, model)) or {}
    if not state.get("digest") or state["digest"] != _digest(th, store.never(), store.forgotten(), stored):
        return False
    last = max((total_order(s) for p in stored for s in p.get("sources") or []), default=None)
    return last is None or all(total_order(c) >= last for c in new)


def replay(store, model, thresholds, order=None):
    """Rebuild every print of `model` from its sources, from nothing: one pass over all of them in the
    total order (`order=None`) or by `order(source)` with the total order breaking ties (ruling D6: the
    calibration passes recording date then label). Computed statuses are judged again; `reseeded` and
    `corrected` are kept as the person left them. Skips the sources of a person in never.json and every
    confirmation before a matching forgotten.json entry's `at`; drops a source whose diarisation file or
    label windows are gone; removes a print left with no source. Holds `store.lock(model.id)`.

    Returns `{prints: {pid: {trust, auto, admitted, held, sources}}, changed, removed, dropped, skipped,
    notices, stuck, pass: "full"}`. A print of another model raises `store.ModelMismatch`."""
    with store.lock(model.id):
        stored = _stored_prints(store, model)
        work, report = _run(store, model, thresholds, stored, (), order)
        _persist(store, model, stored, work, report)
        _save_state(store, model, thresholds, work, order)
    report["stuck"] = sorted(pid for pid, p in work.items() if _stuck(p))
    report["pass"] = "full"
    return report


def confirm(store, model, thresholds, confirmations):
    """Apply a person's confirmations (`{audio, diarization, label, workspace, person, name, confirmed,
    condition?, different?}`; `confirmed` an instant, `now()` when absent) in the same pass and order as
    `replay`, so the result is what a rebuild from nothing gives. Every confirmation is stored as a source
    except one of a person in never.json, one before a matching forget, and one whose label has no voice
    windows; a confirmation failing a check other than 2 or 7 is stored `held` and listed in `kept_out`
    with every failing check; check 2 alone stores it `uncalibrated`; check 7 `held`. Confirming a label
    already a source of that person adds nothing.

    Returns `replay`'s report plus `stored` (each confirmation stored, with its print, status and reason),
    `kept_out` (`{audio, diarization, label, workspace, person, print, checks}`, `print` None when nothing
    was stored) and `pass` (`fast` when only the new confirmations were judged, else `full`); `notices`
    carries the reseed notice once, when a print first has one admitted and two held sources that scored
    against it, in the confirming workspace's name for the person, and `recognised` / `resembles` for a
    voice known from another workspace (section 8), naming nothing from elsewhere."""
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
        fast = _can_judge_only_new(store, model, thresholds, stored, new)
        try:
            work, report = _run(store, model, thresholds, stored, new, fast=fast)
        except _Stale:
            fast = False
            work, report = _run(store, model, thresholds, stored, new)
        _persist(store, model, stored, work, report)
        _save_state(store, model, thresholds, work)
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
    report["pass"] = "fast" if fast else "full"
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
                s = {k: s.get(k) for k in _SOURCE_KEYS + ("at", "different") if k in s}
                if s.get("status") not in EXCLUSIONS:
                    s.pop("status", None)
                    s.pop("reason", None)
                    s.pop("at", None)
                q["sources"].append(s)
            store.write_print(model.id, q)
            carried.append(p["id"])
    return carried
