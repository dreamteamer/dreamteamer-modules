"""`identify`: names, proposals, the end-of-run question and a person's answer (design sections 6, 10, 11).

The record side of naming. `naming.decide` computes; this module reads the record and its context, loads (or
computes) the diarisation's signature, writes once, and applies a person's reply through `enrol` — it never
re-implements a check or the enrolment:

    run(fm, body, ctx, store, active)        names (provisional, from a print), proposals, questions,
                                             `identification` and `speaker_naming` (section 11's table)
    question([(fm, ctx, body), ...])         ONE message for all given records, or None when nothing is offered
    shown(fm, now)                           stamps `speaker_questions.<label>.shown`
    answer(fm, ctx, store, active, pairs)    a person's reply: names confirmed, `enrol.confirm`, the reply
    confirm_names / correct / revert         `--confirm`, `--correct`, `--revert` (and `--revert --person`)
    main(args, ...)                          the verb `transcribe_meeting.py identify`

Review round 1 of task 9: a label a person closed (`nobody`, `different`) gets no machine name, proposal or
question again until `run` replaces the block; a provisional or unverified name is confirmed (`--confirm`,
`<label>=correct`) only once its two quotes were shown (the `shown` stamp), and `--question` offers unverified
names with their quotes; `--question`, `--shown` and `--revert` work from the records when the store is
refused or the calibration ambiguous — only naming and enrolment stop.

`active` is `{model, pin, calib, source}`: the active speaker model (`models.active_model`, through
`calibration.active`), its pin (`store.Model`), and the calibration naming runs with (None: nothing is
written as a name, design section 10 step 0).

A name is **unverified** when it has no `speaker_sources` entry or its string differs from the entry's
`name`; an unverified, provisional or carried name never enrols — only `--answer` and `--confirm` call
`enrol.confirm`. Questions and their flags are `decide`'s `flags`, never its `reports` (ruling D18).
Every carried name of `previous_speakers` is read by value (ruling D20) and checked again against
forgotten.json here, whatever `run` could or could not check (finding `forgotten-unchecked-without-store`).
Nothing written to a record is a vector or a numeric array; a score is a number on its own.

Standard library only (the `engines.py` rule).
"""
from __future__ import annotations

import copy
import json
import os
import re

from voiceprints import calibration, carry, enrol, models, naming, quotes
from voiceprints import segments as vp_segments
from voiceprints import store as vp_store

PRE_FEATURE = "transcribed before voice prints; transcribe it again to name or confirm its voices"
STORE_LINE = "Naming a voice stores a voice print of that person on this computer, so they are recognised next time."
UNCONFIRMED_HEAD = "Named from voice prints, unconfirmed:"
CARRIED_WHY = "carried from the earlier transcript"
NO_SIGNATURE = "no voice signature of this diarisation on this machine"
TAIL = (("someone", "someone else"), ("different", "these two quotes are different people"),
        ("nobody", "nobody I can name"), ("skip", "skip"))
CLOSED_STATES = ("collapsed", "needs-retranscription")

USAGE = ("identify <record>… | identify --question <record>… | identify --shown <record>… | "
         "identify --answer <record> <label>=<person|someone:<name>|different|different:<person>|nobody|skip|correct>… | "
         "identify --confirm <record> [label…] | identify --correct <record> <label> <person> | "
         "identify --revert <record> | identify --revert --person <ref>   (each with --context <file.json>)")


class Usage(Exception):
    """Arguments the verb cannot act on; nothing was written."""


# -- reading the record -------------------------------------------------------------------------------------
def _map(v):
    return v if isinstance(v, dict) else {}


def _t(fm):
    t = (fm or {}).get("transcription") if isinstance(fm, dict) else None
    return t if isinstance(t, dict) else None


def _order(label):
    m = re.fullmatch(r"(.*?)(\d+)", str(label))
    return (m.group(1), int(m.group(2)), str(label)) if m else (str(label), -1, str(label))


def _named(v):
    return isinstance(v, str) and v.strip() != ""


def status_of(t, label):
    """`confirmed` | `provisional` | `unverified` for a label with a name, None for one without. A name with
    no `speaker_sources` entry, or whose string differs from the entry's `name`, is unverified."""
    name = _map((t or {}).get("speakers")).get(label)
    if not _named(name):
        return None
    src = _map((t or {}).get("speaker_sources")).get(label)
    if not isinstance(src, dict) or src.get("name") != name:
        return "unverified"
    return src.get("status") if src.get("status") in ("confirmed", "provisional") else "unverified"


def existing(t):
    """`{label: {name, person, status}}` of the names on the record, for `naming.decide` (an unverified name
    carries no person: decide matches it by its string)."""
    out = {}
    for label, name in _map((t or {}).get("speakers")).items():
        st = status_of(t, label)
        if st is None:
            continue
        e = {"name": name.strip(), "status": st}
        if st != "unverified":
            person = _map(_map(t.get("speaker_sources")).get(label)).get("person")
            if person:
                e["person"] = person
        out[label] = e
    return out


def open_questions(fm):
    """`{label: "ask" | "unconfirmed"}`: every unnamed label with a question a person has not closed, and every
    provisional name not yet shown to a person."""
    t = _t(fm) or {}
    out = {}
    for label, q in _map(t.get("speaker_questions")).items():
        if not isinstance(q, dict) or q.get("closed"):
            continue
        st = status_of(t, label)
        if st is None:
            out[label] = "ask"
        elif st == "provisional" and not q.get("shown"):
            out[label] = "unconfirmed"
    return out


def is_shown(t, label):
    """True when `speaker_questions.<label>.shown` is stamped: the label's two quotes were put to a person."""
    q = _map((t or {}).get("speaker_questions")).get(label)
    return isinstance(q, dict) and bool(q.get("shown"))


def offers(fm):
    """What the end-of-run question puts to a person: `open_questions`, plus every unverified name not yet shown
    and not closed (`"unverified"`: design section 6's offer, once). Unverified names never make a record
    `waiting`; they are only offered."""
    t = _t(fm) or {}
    out = open_questions(fm)
    qs = _map(t.get("speaker_questions"))
    for label in _map(t.get("speakers")):
        if label in out or status_of(t, label) != "unverified":
            continue
        q = qs.get(label)
        if isinstance(q, dict) and (q.get("closed") or q.get("shown")):
            continue
        out[label] = "unverified"
    return out


def naming_state(fm):
    """Design section 11's table, from the record alone: `closed` (collapsed, transcribed before this feature,
    no diarised label at all), `waiting` (an open question), else `named`."""
    t = _t(fm)
    if t is None:
        return None
    if not t.get("diarization_id") or _map(t.get("identification")).get("outcome") in CLOSED_STATES:
        return "closed"
    if open_questions(fm):
        return "waiting"
    if not _map(t.get("speaker_questions")) and not any(_named(v) for v in _map(t.get("speakers")).values()):
        return "closed"
    return "named"


def _set_state(fm):
    st = naming_state(fm)
    if st:
        fm["speaker_naming"] = st
    return st


# -- the context ----------------------------------------------------------------------------------------------
def _norm(s):
    return " ".join(str(s or "").split()).casefold()


def person_name(ctx, ref):
    """This workspace's name for a person reference (the context's `known`, then its candidates), or None."""
    if not ref:
        return None
    n = _map((ctx or {}).get("known")).get(ref)
    if n:
        return n
    for c in (ctx or {}).get("candidates") or []:
        if c.get("person") == ref and c.get("name"):
            return c["name"]
    return None


def resolve_name(ctx, name):
    """The one person reference this workspace knows by `name` (the candidates first, then `known`), or None
    when none or several do."""
    k = _norm(name)
    if not k:
        return None
    for pool in ([(c.get("person"), c.get("name")) for c in (ctx or {}).get("candidates") or []],
                 list(_map((ctx or {}).get("known")).items())):
        hits = sorted({ref for ref, n in pool if ref and _norm(n) == k})
        if len(hits) == 1:
            return hits[0]
        if len(hits) > 1:
            return None
    return None


def audio_of(ctx, fm, audio_key=None):
    """The store's key for the recording: `audio_key(ctx, audio)` when given (the transcriber's), else the
    context's or the record's `fingerprint`, else the sha256 of the audio file; None when none is known."""
    if audio_key is not None:
        try:
            return audio_key(ctx, (ctx or {}).get("audio"))
        except (OSError, TypeError, ValueError):
            pass
    for fp in ((ctx or {}).get("fingerprint"), (fm or {}).get("fingerprint")):
        if isinstance(fp, str):
            h = fp.strip().lower()
            h = h[len("sha256:"):] if h.startswith("sha256:") else h
            if len(h) == 64 and all(c in "0123456789abcdef" for c in h):
                return h
    a = (ctx or {}).get("audio")
    if a and os.path.isfile(a):
        return models.file_sha256(a)
    return None


def workspace_prints(store, active, workspace):
    """`{person: print}` for the people this workspace knows (a `known_as` entry for it). A print known only in
    other workspaces is left out: its person reference means nothing here."""
    out = {}
    for p in store.prints(active["model"], model=active["pin"]):
        for k in p.get("known_as") or []:
            if k.get("workspace") == workspace and k.get("person"):
                out.setdefault(k["person"], p)
    return out


def other_model_people(store, model_id, workspace, have=()):
    """The people this workspace knows (a `known_as` entry for it) whose voice print exists only in OTHER model
    folders — made with another speaker model, so not used with `model_id` until `prints rebuild` makes it again
    (acceptance line 11). References only, never read from elsewhere."""
    out = set()
    for mid in enrol._model_folders(store, but=model_id):
        for p in store.prints(mid):
            for k in p.get("known_as") or []:
                if k.get("workspace") == workspace and k.get("person") and k["person"] not in have:
                    out.add(k["person"])
    return sorted(out)


def rebuild_line(n, model_id):
    many = n != 1
    return (f"{n} voice print{'s' if many else ''} of people this workspace knows {'were' if many else 'was'} made "
            f"with another speaker model and {'are' if many else 'is'} not used with the active model {model_id}; "
            f"run `prints rebuild` to make {'them' if many else 'it'} again")


def _pid_of(store, active, workspace, person):
    p = workspace_prints(store, active, workspace).get(person)
    return p["id"] if p else None


def _sibling_removed(store, model_id, audio, diar):
    """The `removed` of every signature file of the same audio and diarisation id in OTHER model folders
    (Revisions entry 1): a label `forget` deleted under one model is never computed under another."""
    out = set()
    try:
        names = sorted(os.listdir(store.home))
    except OSError:
        return out
    for n in names:
        if n == model_id or n.startswith(".") or not os.path.isdir(os.path.join(store.home, n, "signatures")):
            continue
        try:
            sig = store.read_json(store.signature_path(n, audio, diar))
        except (ValueError, OSError):
            continue
        out |= set((sig or {}).get("removed") or [])
    return out


def _recheck_forgotten(t, forgotten, workspace):
    """Every carried entry of `previous_speakers.labels`, by value, checked against forgotten.json (by its
    source's person, else its name) or already marked: marked `offered: false, forgotten: true` in place.
    Returns `(new labels they were mapped to, whether one could not be placed)`."""
    prev = _map(t.get("previous_speakers"))
    entries = {k: e for k, e in _map(prev.get("labels")).items() if isinstance(e, dict)}
    gone = carry.forgotten_new_labels({"labels": entries}, forgotten, workspace) if workspace else set()
    if not workspace:
        for e in entries.values():
            if e.get("forgotten") is True:
                e["offered"] = False
                if e.get("new_label"):
                    gone.add(e["new_label"])
    return gone, carry.forgotten_unplaced({"labels": entries})


def _windows(sig, label):
    return [w for w in (_map(_map(sig.get("labels")).get(label)).get("windows") or []) if w.get("vector")]


def _calibration_label(active):
    return active.get("source") or ("none" if not active.get("calib") else "shipped")


# -- identify -------------------------------------------------------------------------------------------------
def run(fm, body, ctx, store, active, *, compute=None, audio_key=None, now=None):
    """Name what may be named on one record (design section 10), then write once (section 11). Returns
    `(fm, report)`; `report` is `{record, outcome, speaker_naming, labels: {label: line}, lines}`, or carries
    `error` with `fm` unchanged when no signature can be had."""
    fm = copy.deepcopy(fm)
    ctx = ctx or {}
    stamp = (now or vp_store.now)()
    record = ctx.get("record")
    report = {"record": record, "labels": {}, "lines": []}
    t = _t(fm)
    if t is None:
        return fm, dict(report, error="the record has no transcription; transcribe it first")
    if not t.get("diarization_id"):
        t["identification"] = {"generated": stamp[:10], "outcome": "needs-retranscription", "reports": [PRE_FEATURE]}
        _set_state(fm)
        report.update(outcome="needs-retranscription", speaker_naming=fm["speaker_naming"], lines=[PRE_FEATURE])
        return fm, report

    model_id, pin, calib = active["model"], active["pin"], active.get("calib")
    workspace = ctx.get("workspace")
    diar = t["diarization_id"]
    audio = audio_of(ctx, fm, audio_key)
    gone, unplaced = _recheck_forgotten(t, store.forgotten(), workspace)
    extra = []

    sig = store.read_signature(model_id, audio, diar, model=pin) if audio else None
    if sig is None and unplaced:
        # a forgotten earlier speaker who cannot be placed: no label's voice is computed (ruling D20)
        sig = {"labels": {}, "removed": [], "diarization": {"id": diar}}
        extra.append(f"{carry.FORGOTTEN_UNPLACED}: no voice signature is computed and nothing is named")
    elif sig is None:
        if audio is None:
            return fm, dict(report, error=f"{NO_SIGNATURE}: the recording's audio is not known here")
        if compute is None:
            return fm, dict(report, error=f"{NO_SIGNATURE}; transcribe it again on this machine")
        removed = _sibling_removed(store, model_id, audio, diar) | set(gone)
        try:
            sig = compute(model_id, ctx, audio, sorted(removed))
        except Exception as e:  # the record stays as it was
            return fm, dict(report, error=f"{NO_SIGNATURE}: {e}")
        rec = {"workspace": workspace, "record": record} if workspace and record else None
        sig = store.write_signature(model_id, sig, record=rec)
    else:
        for label in sorted(gone):
            if _windows(sig, label) or label not in (sig.get("removed") or []):
                if label in _map(sig.get("labels")):
                    store.remove_windows(model_id, audio, diar, label)
        if gone:
            sig = store.read_signature(model_id, audio, diar, model=pin) or sig

    sig = copy.deepcopy(sig)
    sig["removed"] = sorted(set(sig.get("removed") or []) | (set(gone) & set(_map(sig.get("labels")))))
    removed = set(sig["removed"])
    labels = sorted(_map(sig.get("labels")), key=_order)
    ex = existing(t)
    prints = workspace_prints(store, active, workspace)
    stale = other_model_people(store, model_id, workspace, set(prints))
    if stale:
        extra.append(rebuild_line(len(stale), model_id))
    d = naming.decide(sig, ctx, prints, ex, calib)
    # a label a person closed ("nobody", "different people") is honoured until `run` replaces the block: no
    # machine name, no proposal, no question (review round 1, `closed-label-named-again-on-rerun`)
    old_q = _map(t.get("speaker_questions"))
    closed = {l for l, q in old_q.items() if isinstance(q, dict) and q.get("closed") and l not in ex}
    names = {l: n for l, n in d["names"].items() if l not in closed}
    flags = d["flags"]
    proposals = {}
    for label, p in d["proposals"].items():
        if label in closed:
            continue
        proposals[label] = dict(p, name=person_name(ctx, p["person"]) or p["person"])
        proposals[label] = {k: proposals[label][k] for k in ("person", "name", "origin", "why")}

    # carried names (design section 7, seam 5): offered ones, re-checked above, become proposals
    if d["outcome"] != "collapsed":
        taken = {e.get("person") for e in ex.values() if e.get("person")} | {n["person"] for n in names.values()}
        for e in _map(_map(t.get("previous_speakers")).get("labels")).values():
            if not isinstance(e, dict) or e.get("offered") is not True or e.get("forgotten") is True:
                continue
            nl, name = e.get("new_label"), e.get("name")
            if not nl or nl not in labels or nl in removed or nl in ex or nl in closed or not _named(name):
                continue
            src = _map(e.get("source"))
            person = src.get("person") or resolve_name(ctx, name)
            if nl in names:
                if person != names[nl]["person"]:
                    extra.append(f"{naming.display(nl)}: the earlier transcript named it {name.strip()}; its voice "
                                 f"matches {person_name(ctx, names[nl]['person'])}, which is written")
                continue
            if person and person in taken:
                continue
            proposals[nl] = {"person": person, "name": person_name(ctx, person) or name.strip(), "origin": "carried",
                             "why": CARRIED_WHY}
            for other, p in list(proposals.items()):
                if other != nl and p.get("origin") == "attendees" and person and p.get("person") == person:
                    del proposals[other]

    # the questions: decide's flags (D18), two quotes for every label shown
    qs = {}
    if d["outcome"] != "collapsed":
        turns = vp_segments.parse_body_turns(body or "")
        for label in labels:
            if label in removed:
                continue
            st = status_of(t, label)
            old = old_q.get(label) if isinstance(old_q.get(label), dict) else None
            if st is not None:
                # a provisional name's question, and an unverified name's offer once shown or closed, are kept
                if st in ("provisional", "unverified") and old is not None:
                    qs[label] = old
                continue
            if label in closed:
                qs[label] = old
                continue
            q = {"quotes": quotes.pick(_windows(sig, label), turns, label)}
            if label not in names:
                if label in proposals:
                    q["proposed"] = proposals[label]
                q["flags"] = list(flags.get(label, []))
            qs[label] = q

    # write once
    speakers = dict(_map(t.get("speakers")))
    sources = dict(_map(t.get("speaker_sources")))
    for label, n in names.items():
        nm = person_name(ctx, n["person"]) or n["person"]
        speakers[label] = nm
        sources[label] = {"name": nm, "person": n["person"], "origin": "print", "status": "provisional",
                          "score": round(float(n["score"]), 4), "margin": round(float(n["margin"]), 4),
                          "seconds": round(float(_map(sig["labels"][label]).get("seconds") or 0.0), 1),
                          "model": model_id, "named": stamp}
    t["speakers"] = speakers
    if sources:
        t["speaker_sources"] = sources
    if qs:
        t["speaker_questions"] = qs
    else:
        t.pop("speaker_questions", None)

    outcome = d["outcome"]
    if outcome not in ("collapsed", naming.MIXED):
        unnamed = [l for l in labels if l not in removed and l not in ex and l not in names and l not in closed]
        if not unnamed:
            outcome = "named"
        elif proposals or names or any(flags.get(l) for l in unnamed):
            outcome = "waiting"
        else:
            outcome = "none"
    unverified = [l for l, e in ex.items() if e["status"] == "unverified"]
    if unverified:
        many = len(unverified) != 1
        extra.append(f"{len(unverified)} name{'s' if many else ''} here {'were' if many else 'was'} not confirmed by "
                     f"you; {'they are' if many else 'it is'} offered with two quotes in the end-of-run question, "
                     "and confirmed once a person has heard them")
    reports = list(d["reports"]) + extra
    t["identification"] = {"generated": stamp[:10], "model": model_id, "calibration": _calibration_label(active),
                           "attendees": ctx.get("attendee_count") if ctx.get("meeting") is not None else None,
                           "outcome": outcome, "reports": reports}
    _set_state(fm)

    for label in labels:
        disp = naming.display(label)
        if label in removed:
            line = f"{disp}: its voice windows were removed (a forgotten person); not named and not asked"
        elif label in ex:
            line = f"{disp}: {ex[label]['name']} ({ex[label]['status']}), kept"
        elif label in closed:
            why = "different people" if old_q[label].get("closed") == "different" else "nobody you can name"
            line = f"{disp}: closed by you ({why}); not named and not asked again until it is transcribed again"
        elif label in names:
            line = f"{disp} → {speakers[label]} (score {names[label]['score']:.2f}), from a voice print, unconfirmed"
        elif label in proposals:
            line = f"{disp}: proposed {proposals[label]['name']} — {proposals[label]['why']}"
        elif flags.get(label):
            line = f"{disp}: asked — " + "; ".join(flag_text(f) for f in flags[label])
        else:
            line = naming.no_match_line(label)
        report["labels"][label] = line
    report.update(outcome=outcome, speaker_naming=fm["speaker_naming"], lines=reports)
    return fm, report


def flag_text(flag):
    if flag == naming.VOICES:
        return "may hold more than one voice"
    if flag == naming.MIXED:
        return "a mixed diarisation is suspected"
    if flag == naming.COLLAPSED:
        return "the diarisation collapsed to one label"
    if str(flag).startswith(naming.CONFLICT):
        return f"conflicts with {naming.display(str(flag)[len(naming.CONFLICT):])}"
    return str(flag)


# -- the question ---------------------------------------------------------------------------------------------
_CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳"


def _n(i):
    return _CIRCLED[i - 1] if 1 <= i <= len(_CIRCLED) else f"({i})"


def _quote_line(qs):
    return " · ".join(f'[{x["at"]}] "{x["text"]}"' for x in qs or [])


def _choices(ctx, label, proposed):
    """The proposal first, then the meeting's attendees (with no meeting, the workspace's users), then
    someone else, different people, nobody, skip."""
    out, seen = [], set()
    if proposed:
        ref = proposed.get("person")
        value = ref or f"someone:{proposed.get('name')}"
        out.append({"answer": f"{label}={value}", "text": f"{proposed.get('name')} ({proposed.get('why')})"})
        seen.add(ref)
    if ctx.get("meeting") is not None:
        people = [(c.get("person"), c.get("name"), c.get("you")) for c in ctx.get("candidates") or []]
    else:
        people = [(u.get("person"), u.get("name"), None) for u in ctx.get("workspace_users") or []]
    for ref, name, you in people:
        if not ref or ref in seen:
            continue
        seen.add(ref)
        out.append({"answer": f"{label}={ref}", "text": f"{name}{' (you)' if you else ''}"})
    for value, text in TAIL:
        out.append({"answer": f"{label}={value}" if value != "someone" else f"{label}=someone:<name>", "text": text})
    return out


def unverified_head(n):
    many = n != 1
    return (f"{n} name{'s' if many else ''} here {'were' if many else 'was'} not confirmed by you; confirm "
            f"{'them' if many else 'it'} to teach the voice{'s' if many else ''}?")


def _confirm_choices(label):
    return [{"answer": f"{label}=correct", "text": "correct"},
            {"answer": f"{label}=someone:<name>", "text": "someone else"},
            {"answer": f"{label}=different", "text": "different people"}]


def question(items, quotes_of=None):
    """ONE message for every given `(fm, ctx)` or `(fm, ctx, body)`: per record, each open label with its two
    quotes, its flags and the choices, then the machine-written names not yet shown under `Named from voice
    prints, unconfirmed:`, then the unverified names not yet shown (design section 6's offer) with the same
    two quotes each, and the storage line once at the end. None when nothing is offered. An unverified name's
    quotes come from `quotes_of(fm, body, ctx, label)` when it has no question entry yet."""
    blocks, data = [], []
    for item in items:
        fm, ctx = item[0], item[1] or {}
        body = item[2] if len(item) > 2 else ""
        if naming_state(fm) == "closed":
            continue
        oq = offers(fm)
        if not oq:
            continue
        t = _t(fm)
        qs = _map(t.get("speaker_questions"))
        ask = sorted((l for l, k in oq.items() if k == "ask"), key=_order)
        unconfirmed = sorted((l for l, k in oq.items() if k == "unconfirmed"), key=_order)
        unverified = sorted((l for l, k in oq.items() if k == "unverified"), key=_order)
        title = _map(ctx.get("meeting")).get("name") or fm.get("name") or ctx.get("record")
        date = str(_map(ctx.get("meeting")).get("date") or fm.get("date") or "")[:10]
        lines, labels = [], []
        if ask:
            n = len(ask)
            word = {1: "One voice", 2: "Two voices", 3: "Three voices", 4: "Four voices"}.get(n, f"{n} voices")
            lines.append(f"{word} in **{title}** ({date}) {'is' if n == 1 else 'are'} not named yet.")
        else:
            lines.append(f"**{title}** ({date})")
        for label in ask:
            q = qs[label]
            disp = naming.display(label)
            lines.append("")
            lines.append(f"**{disp}** — {_quote_line(q.get('quotes'))}")
            fl = [flag_text(f) for f in q.get("flags") or []]
            if fl:
                lines.append(f"This label {'; '.join(fl)}.")
            ch = _choices(ctx, label, q.get("proposed"))
            lines.append("Who is this? " + " ".join(f"{_n(i)} {c['text']}" for i, c in enumerate(ch, 1)))
            labels.append({"label": label, "kind": "ask", "quotes": q.get("quotes") or [], "flags": q.get("flags") or [],
                           "proposed": q.get("proposed"), "choices": ch})
        if unconfirmed:
            lines.append("")
            lines.append(UNCONFIRMED_HEAD)
            src = _map(t.get("speaker_sources"))
            for label in unconfirmed:
                q, s = qs[label], src[label]
                disp = naming.display(label)
                ch = _confirm_choices(label)
                lines.append(f"**{disp} → {s['name']}** ({float(s.get('score') or 0):.2f}) — {_quote_line(q.get('quotes'))}  "
                             + " ".join(f"{_n(i)} {c['text']}" for i, c in enumerate(ch, 1)))
                labels.append({"label": label, "kind": "unconfirmed", "name": s["name"], "person": s.get("person"),
                               "score": s.get("score"), "quotes": q.get("quotes") or [], "choices": ch})
        if unverified:
            lines.append("")
            lines.append(unverified_head(len(unverified)))
            for label in unverified:
                q = _map(qs.get(label))
                qq = q.get("quotes") or (quotes_of(fm, body, ctx, label) if quotes_of else []) or []
                name = _map(t.get("speakers"))[label].strip()
                disp = naming.display(label)
                ch = _confirm_choices(label)
                lines.append(f"**{disp} → {name}** — {_quote_line(qq)}  "
                             + " ".join(f"{_n(i)} {c['text']}" for i, c in enumerate(ch, 1)))
                labels.append({"label": label, "kind": "unverified", "name": name, "quotes": qq, "choices": ch})
        blocks.append("\n".join(lines))
        data.append({"record": ctx.get("record"), "record_path": ctx.get("record_path"), "labels": labels})
    if not blocks:
        return None
    return {"message": "\n\n".join(blocks + [STORE_LINE]), "records": data}


def shown(fm, stamp, quotes_of=None):
    """`--shown`: everything `--question` offered has been put to a person — every open question, and every
    unverified name, whose entry is made with the quotes shown (`quotes_of(label)`) when it has none."""
    fm = copy.deepcopy(fm)
    t = _t(fm)
    if t is None:
        return fm
    offered = offers(fm)
    if offered and not isinstance(t.get("speaker_questions"), dict):
        t["speaker_questions"] = {}
    qs = _map(t.get("speaker_questions"))
    for label, kind in offered.items():
        if kind == "unverified":
            q = qs.get(label) if isinstance(qs.get(label), dict) else {}
            if not q.get("quotes"):
                q["quotes"] = (quotes_of(label) if quotes_of else []) or []
            qs[label] = q
        qs[label]["shown"] = stamp
    if t.get("diarization_id"):
        _set_state(fm)
    return fm


# -- a person's reply ------------------------------------------------------------------------------------------
_WHY = {1: "their voice is never kept", 3: "under 20 seconds of speech",
        4: "a turn over five minutes or most of the speech", 5: "a second voice holds part of it",
        6: "it sounds like another speaker of this recording", 8: "it matches another person's voice print",
        9: "it was corrected as not this person", 10: "you said it holds different people"}


def _checks_in(reason):
    return [int(n) for n in re.findall(r"(?:^|; )check (\d+):", reason or "")]


def enrol_lines(rep, confs, before):
    """The reply's account of `enrol.confirm`'s report: whose voice print was stored or changed, and each label
    kept out of a print and why — never-kept, a second voice, a long turn, kept aside."""
    out = []
    stored = {(s["label"], s["person"]): s for s in rep.get("stored") or []}
    kept = {(k["label"], k["person"]): k for k in rep.get("kept_out") or []}
    told = False
    for c in confs:
        name, disp = c["name"], naming.display(c["label"])
        s, k = stored.get((c["label"], c["person"])), kept.get((c["label"], c["person"]))
        if s is None:
            checks = [x.get("check") for x in (k or {}).get("checks") or []]
            if 1 in checks:
                out.append(f"{name}'s voice is not kept (`prints never`): no voice print was stored from {disp}.")
            else:
                why = "; ".join(x.get("reason") or "" for x in (k or {}).get("checks") or []) or "nothing to learn from"
                out.append(f"No voice print was stored from {disp} for {name}: {why}.")
        elif s["status"] == enrol.ADMITTED:
            out.append(f"Stored a voice print for {name}." if s["print"] not in before else f"Improved {name}'s voice print.")
            told = True
        elif s["status"] == enrol.UNCALIBRATED:
            out.append(f"{disp} is kept for {name}'s voice print, but there is no calibration yet: no voice print is made "
                       "until one exists (`prints rebuild` then uses it).")
        else:
            checks = set(_checks_in(s.get("reason")))
            if not checks or checks == {7}:
                out.append(f"Named. This recording did not match {name}'s voice print well enough to teach it, "
                           "and was kept aside.")
            else:
                whys = [_WHY[n] for n in sorted(checks) if n in _WHY]
                out.append(f"Named. {disp} was kept out of {name}'s voice print: " + "; ".join(whys) + ".")
    for n in rep.get("notices") or []:
        out.append(n.get("text"))
    if told:
        out.append("To delete one: `prints forget <person>`.")
    return out


def _thresholds(active):
    return (active.get("calib") or {}).get("thresholds")


def _parse_pairs(pairs):
    out = []
    for p in pairs:
        if "=" not in p:
            raise Usage(f"an answer is <label>=<answer>, got {p!r}")
        label, value = p.split("=", 1)
        label, value = label.strip(), value.strip()
        if not label or not value:
            raise Usage(f"an answer is <label>=<answer>, got {p!r}")
        out.append((label, value))
    return out


def _advice(ctx, t):
    labels = int(t.get("speaker_count") or 0) or len(_map(t.get("speakers"))) or 1
    n = ctx.get("attendee_count") if ctx.get("attendee_count") and ctx["attendee_count"] > labels else labels + 1
    return f"transcribe it again with the right speaker count (`--speakers {n}`)"


def not_shown_line(disp, name):
    return (f"{disp} → {name}: not confirmed — its two quotes were not shown to a person yet. Show them "
            "(`identify --question <record>`), stamp them (`identify --shown <record>`), and confirm after the "
            "person has heard them.")


def answer(fm, ctx, store, active, pairs, stamp, *, audio_key=None):
    """Apply a person's reply (`[(label, value)]`): `<person>` or `someone:<name>` names the label as confirmed
    (`origin: hand`, `proposed_by` when it answered a proposal; on a provisional name another person is a
    correction); `correct` confirms the name already there, only once its two quotes were shown (`--shown`),
    else it confirms nothing and says so; `different` names nothing, closes the label as
    mixed with the advice to transcribe again; `different:<person>` names it and keeps it out of the print;
    `nobody` closes it; `skip` leaves it open. Confirmations go through `enrol.confirm`. Returns `(fm, lines)`.
    Raises Usage for a label or person this record or workspace does not have, before anything is written."""
    fm = copy.deepcopy(fm)
    ctx = ctx or {}
    t = _t(fm)
    if t is None or not t.get("diarization_id"):
        raise Usage(f"{ctx.get('record') or 'this record'} has no voice-print naming: {PRE_FEATURE}")
    speakers, sources = dict(_map(t.get("speakers"))), dict(_map(t.get("speaker_sources")))
    qs = dict(_map(t.get("speaker_questions")))
    known_labels = set(speakers) | set(qs)
    workspace = ctx.get("workspace")
    audio = audio_of(ctx, fm, audio_key)
    plan = []
    for label, value in pairs:
        if label not in known_labels:
            raise Usage(f"{label} is not a speaker label of {ctx.get('record') or 'this record'}")
        diff = value.startswith("different:")
        v = value[len("different:"):].strip() if diff else value
        if v in ("skip", "nobody", "different") and not diff:
            plan.append((label, v, None, None, False))
            continue
        st = status_of(t, label)
        if v == "correct":
            if st not in ("provisional", "unverified"):
                raise Usage(f"{label} has no unconfirmed name to confirm")
            name = speakers[label].strip()
            if not is_shown(t, label):
                # confirmed only once its two quotes were shown (decision ...-task-9-confirm-only-what-was-shown)
                plan.append((label, "unshown", None, name, False))
                continue
            person = _map(sources.get(label)).get("person") if st == "provisional" else resolve_name(ctx, name)
        elif v.startswith("someone:"):
            name = v[len("someone:"):].strip()
            if not name:
                raise Usage(f"someone:<name> needs a name ({label})")
            person = resolve_name(ctx, name)
            name = person_name(ctx, person) or name
        else:
            person, name = v, person_name(ctx, v)
            if not name:
                raise Usage(f"{v} is not a person this workspace knows")
        if st == "confirmed" and _map(sources.get(label)).get("person") != person:
            raise Usage(f"{label} is already confirmed as {speakers[label]}; use --correct")
        plan.append((label, "name", person, name, diff))

    lines, confs, corrections, named_any = [], [], [], False
    for label, kind, person, name, diff in plan:
        disp = naming.display(label)
        q = qs.get(label) if isinstance(qs.get(label), dict) else {}
        st = status_of(t, label)
        if kind == "skip":
            lines.append(f"{disp}: skipped — the question stays on the record.")
            continue
        if kind == "unshown":
            ql = _quote_line(q.get("quotes"))
            lines.append(not_shown_line(disp, name) + (f" Its quotes: {ql}" if ql else ""))
            continue
        if kind in ("nobody", "different"):
            if st == "provisional":
                speakers.pop(label, None)
                sources.pop(label, None)
            if kind == "nobody":
                qs[label] = {"quotes": q.get("quotes") or [], "closed": "nobody"}
                lines.append(f"{disp}: closed — it stays {disp} and is not asked about again.")
            else:
                adv = _advice(ctx, t)
                qs[label] = {"quotes": q.get("quotes") or [], "closed": "different", "flags": [naming.MIXED], "advice": adv}
                lines.append(f"{disp}: not named — you said it holds different people; a mixed diarisation is "
                             f"suspected: {adv}.")
            continue
        old = _map(sources.get(label))
        if st == "provisional" and old.get("person") and old.get("person") != person:
            corrections.append((label, old["person"]))
        src = {"name": name, "person": person, "origin": "hand", "status": "confirmed", "named": stamp}
        prop = _map(q.get("proposed"))
        if prop and ((person and prop.get("person") == person) or (not person and _norm(prop.get("name")) == _norm(name))):
            src["proposed_by"] = prop.get("origin")
        elif st == "provisional" and old.get("person") == person:
            src["proposed_by"] = "print"
        speakers[label], sources[label] = name, src
        qs.pop(label, None)
        named_any = True
        if diff:
            lines.append(f"{disp} → {name}, confirmed; you said it holds different people.")
        else:
            lines.append(f"{disp} → {name}, confirmed.")
        if person and audio and workspace:
            c = {"audio": audio, "diarization": t["diarization_id"], "label": label, "workspace": workspace,
                 "person": person, "name": name, "confirmed": stamp}
            if diff:
                c["different"] = True
            confs.append(c)
        elif not person:
            lines.append(f"No voice print for {name}: they are not a person record of this workspace — add them "
                         "and confirm again to teach their voice.")
        else:
            lines.append(f"No voice print for {name}: this recording's voice signature cannot be found from here "
                         "(no audio key or no workspace in the voice context).")

    for label, wrong in corrections:
        pid = _pid_of(store, active, workspace, wrong)
        if pid and audio:
            enrol.correct_provisional(store, active["pin"], {"audio": audio, "diarization": t["diarization_id"],
                                                              "label": label}, pid)
            lines.append(f"{person_name(ctx, wrong) or wrong}'s voice print wrote {naming.display(label)} wrongly: it only "
                         "proposes until it no longer sounds like this voice.")
    if confs:
        before = {p["id"] for p in store.prints(active["model"], model=active["pin"])}
        rep = enrol.confirm(store, active["pin"], _thresholds(active), confs)
        lines.extend(enrol_lines(rep, confs, before))
    if named_any:
        docs = [d for d in ctx.get("documents") or [] if d.get("ref")]
        if docs:
            lines.append("Written from this transcript before these names: "
                         + ", ".join(f"{d['ref']} ({d.get('kind')})" for d in docs)
                         + " — write them again with the names, or say they were written before them.")

    t["speakers"] = speakers
    if sources:
        t["speaker_sources"] = sources
    else:
        t.pop("speaker_sources", None)
    if qs:
        t["speaker_questions"] = qs
    else:
        t.pop("speaker_questions", None)
    _set_state(fm)
    return fm, lines


def label_quotes(fm, body, ctx, store, active, label, audio_key=None):
    """A label's two quotes: its question's, else picked again from the signature and the transcript — from the
    transcript alone when there is no store or no active model (refused or ambiguous: the record verbs still
    work) or the signature cannot be read."""
    t = _t(fm) or {}
    q = _map(_map(t.get("speaker_questions")).get(label))
    if q.get("quotes"):
        return q["quotes"]
    sig = None
    if store is not None and active and t.get("diarization_id"):
        try:
            audio = audio_of(ctx, fm, audio_key)
            if audio:
                sig = store.read_signature(active["model"], audio, t["diarization_id"], model=active["pin"])
        except (vp_store.StoreRefused, vp_store.ModelMismatch, OSError, ValueError, KeyError):
            sig = None
    return quotes.pick(_windows(sig or {}, label), vp_segments.parse_body_turns(body or ""), label)


def confirm_names(fm, body, ctx, store, active, labels, stamp, *, audio_key=None):
    """`--confirm`: provisional or unverified names confirmed on a person's word — each label's two quotes are
    printed first, then the confirmation and its enrolment. A label whose quotes were never shown to a person
    (no `speaker_questions.<label>.shown`) is not confirmed: its quotes are printed and the reply says to
    confirm after the person has heard them; `--confirm` never stamps `shown` itself."""
    t = _t(fm) or {}
    if not labels:
        labels = sorted((l for l in _map(t.get("speakers")) if status_of(t, l) in ("provisional", "unverified")), key=_order)
    head, pairs, unshown = [], [], []
    for label in labels:
        st = status_of(t, label)
        if st is None:
            raise Usage(f"{label} has no name to confirm")
        name = _map(t.get("speakers"))[label]
        disp = naming.display(label)
        head.append(f"**{disp} → {name}** — "
                    f"{_quote_line(label_quotes(fm, body, ctx, store, active, label, audio_key))}")
        if st == "confirmed":
            head.append(f"{disp}: already confirmed.")
            continue
        if not is_shown(t, label):
            unshown.append(not_shown_line(disp, name.strip()))
            continue
        pairs.append((label, "correct"))
    fm, lines = answer(fm, ctx, store, active, pairs, stamp, audio_key=audio_key) if pairs else (fm, [])
    return fm, head + lines + unshown


def correct(fm, ctx, store, active, label, person, stamp, *, audio_key=None):
    """`--correct <label> <person>`: a provisional name → `enrol.correct_provisional` (through `answer`); a
    confirmed one → `enrol.correct_confirmed`; an unverified or missing one is simply named."""
    t = _t(fm) or {}
    name = person_name(ctx, person)
    if not name:
        raise Usage(f"{person} is not a person this workspace knows")
    if status_of(t, label) != "confirmed":
        return answer(fm, ctx, store, active, [(label, person)], stamp, audio_key=audio_key)
    fm = copy.deepcopy(fm)
    t = _t(fm)
    workspace = ctx.get("workspace")
    old = _map(_map(t.get("speaker_sources")).get(label))
    if old.get("person") == person:
        return fm, [f"{naming.display(label)} is already confirmed as {name}."]
    audio = audio_of(ctx, fm, audio_key)
    ref = {"audio": audio, "diarization": t["diarization_id"], "label": label}
    to = {"workspace": workspace, "person": person, "name": name}
    before = {p["id"] for p in store.prints(active["model"], model=active["pin"])}
    pid = _pid_of(store, active, workspace, old.get("person")) if old.get("person") else None
    conf = dict(ref, workspace=workspace, person=person, name=name, confirmed=stamp)
    rep = None
    if pid and audio:
        try:
            rep = enrol.correct_confirmed(store, active["pin"], _thresholds(active), ref, pid, to, at=stamp)
        except KeyError:
            rep = None
    if rep is None and audio and workspace:
        rep = enrol.confirm(store, active["pin"], _thresholds(active), [conf])
    t["speakers"][label] = name
    t.setdefault("speaker_sources", {})[label] = {"name": name, "person": person, "origin": "hand",
                                                  "status": "confirmed", "named": stamp}
    lines = [f"{naming.display(label)}: corrected from {old.get('name') or 'its earlier name'} to {name}."]
    if rep is not None:
        lines.extend(enrol_lines(rep, [conf], before))
    _set_state(fm)
    return fm, lines


def revert(fm, person=None):
    """`--revert`: every provisional name and its source entry removed, the questions and `identification`
    removed, `speaker_naming` emptied; confirmed and unverified names stay. With `person`, only the provisional
    names of that person's print (`--revert --person`), and the record is offered for naming again. Returns
    `(fm, labels removed)`."""
    fm = copy.deepcopy(fm)
    t = _t(fm)
    if t is None:
        return fm, []
    speakers, sources = _map(t.get("speakers")), _map(t.get("speaker_sources"))
    gone = []
    for label in sorted(list(speakers), key=_order):
        if status_of(t, label) != "provisional":
            continue
        if person is not None and _map(sources.get(label)).get("person") != person:
            continue
        speakers.pop(label, None)
        sources.pop(label, None)
        gone.append(label)
    if not sources:
        t.pop("speaker_sources", None)
    if person is None:
        t.pop("speaker_questions", None)
        t.pop("identification", None)
        fm.pop("speaker_naming", None)
    elif gone:
        qs = _map(t.get("speaker_questions"))
        for label in gone:
            qs.pop(label, None)
        if not qs:
            t.pop("speaker_questions", None)
        fm.pop("speaker_naming", None)
    return fm, gone


# -- the verb ------------------------------------------------------------------------------------------------
def resolve_active(skill_dir, store):
    """The active model, its pin (the registry's sha256 and dimension: the file `setup` fetched is refused
    unless it has them), and the calibration — the store's local override, else the shipped file, else None."""
    a = calibration.active(skill_dir, store)
    e = models.entry(a["model"])
    return dict(a, pin=vp_store.Model(e["id"], e["sha256"], e["dim"]))


def _contexts(ctx):
    if isinstance(ctx.get("records"), list):
        return [c for c in ctx["records"] if isinstance(c, dict)]
    return [ctx] if ctx.get("record_path") or ctx.get("record") else []


def _ctx_for(ctx, path):
    want = os.path.abspath(path)
    cs = _contexts(ctx)
    for c in cs:
        if c.get("record_path") and os.path.abspath(c["record_path"]) == want:
            return c
    if len(cs) == 1 and not isinstance(ctx.get("records"), list):
        return cs[0]
    raise Usage(f"the voice context has no entry for {path}")


_REFUSALS = (vp_store.StoreRefused, vp_store.ModelMismatch, models.CalibrationAmbiguous, models.ModelRefused,
             calibration.CalibrationInvalid, OSError, ValueError, KeyError)


def main(args, *, skill_dir=None, read=None, write=None, store=None, active=None, compute=None, audio_key=None,
         out=print, now=None):
    """`identify …` (args[0] is the verb). Prints one JSON object (none for `--question` with nothing open).
    Returns the exit code: 0, 1 (a record could not be named, or the store or model refused), 2 (usage)."""
    clock = now or vp_store.now
    try:
        a = list(args[1:])
        ctx_path = None
        if "--context" in a:
            i = a.index("--context")
            if i + 1 >= len(a):
                raise Usage("--context needs a file")
            ctx_path = a[i + 1]
            del a[i:i + 2]
        person = None
        if "--person" in a:
            i = a.index("--person")
            if i + 1 >= len(a):
                raise Usage("--person needs a reference")
            person = a[i + 1]
            del a[i:i + 2]
        verbs = [f for f in ("--question", "--shown", "--answer", "--confirm", "--correct", "--revert") if f in a]
        if len(verbs) > 1:
            raise Usage(f"one of {', '.join(verbs)}, not both")
        unknown = [x for x in a if x.startswith("--") and x not in verbs]
        if unknown:
            raise Usage(f"identify does not know {unknown[0]}")
        verb = verbs[0] if verbs else None
        pos = [x for x in a if not x.startswith("--")]
        if ctx_path is None:
            raise Usage("no --context: run it through the module's entry (`transcribe.mjs identify <record>`)")
        with open(ctx_path, encoding="utf-8") as f:
            ctx = json.load(f)
        if not isinstance(ctx, dict):
            raise Usage("the voice context is not an object")
        if verb in (None, "--answer", "--confirm", "--correct"):
            # naming and enrolment need the store and the calibration: a refusal stops them and says why
            if store is None:
                store = vp_store.Store(vp_store.default_home(), guard=ctx.get("guard") or {})
            store.ensure()
            if active is None:
                active = resolve_active(skill_dir, store)
        else:
            # --question, --shown and --revert work from what the records hold (review round 1,
            # `refused-store-blocks-question-and-revert`); the store, when it answers, only supplies an
            # unverified name's quotes from its signature
            try:
                if store is None:
                    store = vp_store.Store(vp_store.default_home(), guard=ctx.get("guard") or {})
                store.ensure()
            except _REFUSALS:
                store = None
            if active is None and store is not None:
                try:
                    active = resolve_active(skill_dir, store)
                except _REFUSALS:
                    active = None

        def quotes_of(fm, body, c, label):
            return label_quotes(fm, body, c, store, active, label, audio_key)

        if verb == "--revert" and person is not None:
            done = []
            for row in ctx.get("person_records") or []:
                path = row.get("record_path")
                if not path:
                    continue
                fm, body = read(path)
                fm2, gone = revert(fm, person=person)
                if gone:
                    write(path, fm2, body)
                done.append({"record": row.get("record"), "removed": gone, "speaker_naming": fm2.get("speaker_naming")})
            out(json.dumps({"person": person, "records": done}, ensure_ascii=False))
            return 0
        if not pos:
            raise Usage("no record named")

        if verb is None:
            reports, code = [], 0
            for path in pos:
                c = _ctx_for(ctx, path)
                fm, body = read(path)
                fm2, rep = run(fm, body, c, store, active, compute=compute, audio_key=audio_key, now=clock)
                if rep.get("error"):
                    code = 1
                else:
                    write(path, fm2, body)
                reports.append(rep)
            out(json.dumps({"records": reports}, ensure_ascii=False))
            return code
        if verb == "--question":
            items = []
            for p in pos:
                fm, body = read(p)
                items.append((fm, _ctx_for(ctx, p), body))
            msg = question(items, quotes_of=quotes_of)
            if msg is not None:
                out(json.dumps(msg, ensure_ascii=False))
            return 0
        if verb == "--shown":
            stamp, done = clock(), []
            for path in pos:
                c = _ctx_for(ctx, path)
                fm, body = read(path)
                fm2 = shown(fm, stamp, quotes_of=lambda label, fm=fm, body=body, c=c: quotes_of(fm, body, c, label))
                write(path, fm2, body)
                done.append({"record": c.get("record"), "speaker_naming": fm2.get("speaker_naming")})
            out(json.dumps({"records": done}, ensure_ascii=False))
            return 0

        path, rest = pos[0], pos[1:]
        c = _ctx_for(ctx, path)
        fm, body = read(path)
        if verb == "--answer":
            fm2, lines = answer(fm, c, store, active, _parse_pairs(rest), clock(), audio_key=audio_key)
        elif verb == "--confirm":
            fm2, lines = confirm_names(fm, body, c, store, active, rest, clock(), audio_key=audio_key)
        elif verb == "--correct":
            if len(rest) != 2:
                raise Usage("--correct <record> <label> <person>")
            fm2, lines = correct(fm, c, store, active, rest[0], rest[1], clock(), audio_key=audio_key)
        else:   # --revert
            fm2, gone = revert(fm)
            lines = [f"Removed the provisional name{'s' if len(gone) != 1 else ''} of "
                     + ", ".join(naming.display(l) for l in gone) + "." if gone else "No provisional name to remove."]
        write(path, fm2, body)
        out(json.dumps({"record": c.get("record"), "speaker_naming": fm2.get("speaker_naming"),
                        "reply": "\n".join(x for x in lines if x)}, ensure_ascii=False))
        return 0
    except Usage as e:
        out(f"✖ {e}\n  usage: {USAGE}")
        return 2
    except _REFUSALS as e:
        out(f"✖ {e}")
        return 1
