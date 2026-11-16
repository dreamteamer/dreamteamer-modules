"""`evaluate-speakers` — the developer's evaluation (design section 13), over every diarised recording of
the workspace the node entry hands in (`{records: [...]}`, plan Revisions entry 2).

    evaluate-speakers plan [--room <record>]… [--pilot <record>] [--me <person>]
        lists the 14 recordings to label — the developer in all of them, at least three other people each
        in at least two (three or more preferred), eight 1:1 calls, four with three or more speakers, two
        recorded in a room (a meeting `location` that is not a URL, or `--room`) — and, apart, the solo
        memo and the pilot. Writes nothing.
    evaluate-speakers [--only <model id>] [--pilot <record>]
        per speaker model (every registered one; `--only` one): purity per label, check 4's hits and
        misses, genuine and impostor scores closed and open, one fold per judged recording, the silver
        second look, then the verdict line with n, the bound 3/n, the fit counts and the held-out
        statement beside it.
    evaluate-speakers --write [--install-local] [--only …] [--pilot …]
        the same, then the calibration file (numbers and counts only) to
        `<store>/calibration-labels/calibration-<model id>.json` (ruling D10), its path printed; with
        `--install-local` also to `<store>/<model id>/calibration.json`, the local override.

What a label is: the developer's answers (`label`) make each heard label GOLD — its majority speaker, its
purity (the share of heard windows that speaker holds). A label heard as mixed (purity under 0.80), or
mostly `x`, is no trial. SILVER labels are unheard hand maps in `previous_speakers` that pass checks 4 and
5: printed apart, never counted.

The judged recordings (folds) are the labelled recordings of two or more labels, except `--pilot`; the
solo memo and the pilot still teach prints and give trials in every fold. For each fold R:

- every trial is scored against a print rebuilt WITHOUT R and without the trial's own recording: the
  normalised mean of the speaker's heard-pure label centroids elsewhere (each source weighing the same, as
  a print's vector does); a trial whose print thereby loses its only source is dropped;
- the thresholds are fitted (rule 2) on those trials and on the label pairs and mixed sets of the other
  recordings;
- the prints are rebuilt without R by `enrol.replay` with every heard label (pure or mixed) of the other
  recordings confirmed as its majority speaker, in the order recording date then label (ruling D6), at
  the fold's thresholds — in a TEMPORARY store: nothing of a fold reaches the user's store;
- `naming.decide` runs on R with that fold's prints and thresholds, closed set (R's attendees) and open
  set (no meeting), and its names are checked against what was heard.

The only writes to the user's store are a missing signature file of a model (computed from the audio as
`run` computes one, `store.write_signature`) and, with `--write`, the calibration file.

Standard library only (the `engines.py` rule): decoding and embedding are handed in by the entry.
"""
from __future__ import annotations

import contextlib
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
from array import array
from datetime import date as _date

from voiceprints import calibration, enrol, models, naming, vec
from voiceprints import label as vp_label
from voiceprints import signatures as vp_signatures
from voiceprints import store as vp_store

PURE = 0.80              # a heard label whose majority speaker holds less than this share is mixed
MIXED_SHARE = 0.30       # the second voice's share in a deliberately mixed set
SMALL_GROUP = naming.SMALL_GROUP
TARGETS = (("room", 2), ("three or more", 4), ("1:1", 8))
PLAN_SIZE = sum(n for _, n in TARGETS)

USAGE = ("evaluate-speakers [plan] [--write [--install-local]] [--only <model id>] [--room <record>]… "
         "[--pilot <record>] [--me <person>] --context <file.json>")


class SignatureUnavailable(Exception):
    """A recording's signature cannot be computed for a model (no matching ASR cache, no audio)."""


class Usage(Exception):
    pass


# -- gold -----------------------------------------------------------------------------------------------
def gold(answers):
    """`{label: {speaker, purity, heard, unsure, kind}}` from a labels file. `kind` is `pure` (the
    majority speaker holds at least PURE of the heard windows), `mixed`, or `unheard` (mostly `x`, or
    nothing heard): only `pure` is a trial."""
    out = {}
    for lab, entry in sorted(((answers or {}).get("labels") or {}).items()):
        said = [w.get("answer") for w in (entry or {}).get("windows") or [] if w.get("answer")]
        heard = [a for a in said if a != "x"]
        counts = {}
        for a in heard:
            counts[a] = counts.get(a, 0) + 1
        top = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
        g = {"speaker": top[0][0] if top else None, "heard": len(heard), "unsure": len(said) - len(heard),
             "purity": (top[0][1] / len(heard)) if heard else 0.0}
        if not heard or len(heard) * 2 < len(said):
            g["kind"] = "unheard"
        else:
            g["kind"] = "pure" if g["purity"] >= PURE - 1e-9 else "mixed"
        out[lab] = g
    return out


def _label_key(label):
    m = re.fullmatch(r"(.*?)(\d+)", label or "")
    return (m.group(1), int(m.group(2)), label) if m else (label or "", -1, label or "")


def _ref_matches(given, ref):
    if not given or not ref:
        return False
    g = given.strip()
    return g == ref or ref.endswith("/" + g) or ref == "meeting-recordings/" + g


# -- loading ---------------------------------------------------------------------------------------------
def _date_of(fm, rctx):
    d = (fm or {}).get("date") or ((rctx.get("meeting") or {}).get("date")) or ""
    return str(d)[:10]


def load(ctx_all, store, *, read, audio_key, out=lambda s: None):
    """The diarised recordings of the context with their record frontmatter and the developer's answers:
    `[{ctx, ref, audio, diar, date, t, answers, gold}]`."""
    recs = []
    for rctx in ctx_all.get("records") or []:
        diar = rctx.get("diarization_id")
        if not diar:
            continue
        try:
            audio = audio_key(rctx, rctx.get("audio"))
        except (OSError, TypeError, ValueError) as e:
            out(f"  {rctx.get('record')}: left out — its audio key cannot be read ({e})")
            continue
        try:
            fm, _ = read(rctx["record_path"]) if read else ({}, "")
        except (OSError, ValueError) as e:
            out(f"  {rctx.get('record')}: left out — the record cannot be read ({e})")
            continue
        answers = store.read_json(vp_label.labels_path(store, audio, diar))
        recs.append({"ctx": rctx, "ref": rctx.get("record"), "audio": audio, "diar": diar,
                     "date": _date_of(fm, rctx), "t": (fm or {}).get("transcription") or {},
                     "answers": answers, "gold": gold(answers) if answers else {}})
    return recs


# -- plan ------------------------------------------------------------------------------------------------
_URL = re.compile(r"^\s*(?:[a-z][a-z0-9+.-]*://|www\.)", re.I)


def _in_a_room(rctx, rooms):
    if any(_ref_matches(r, rctx.get("record")) for r in rooms or ()):
        return True
    loc = ((rctx.get("meeting") or {}).get("location") or "")
    return bool(str(loc).strip()) and not _URL.match(str(loc))


def guess_me(ctx_all):
    """The developer: the person most often marked `you` on a recording's candidates, else the person on
    the most recordings."""
    you, seen = {}, {}
    for r in ctx_all.get("records") or []:
        for c in r.get("candidates") or []:
            p = c.get("person")
            if not p:
                continue
            seen[p] = seen.get(p, 0) + 1
            if c.get("you"):
                you[p] = you.get(p, 0) + 1
    pool = you or seen
    return sorted(pool.items(), key=lambda kv: (-kv[1], kv[0]))[0][0] if pool else None


def plan(ctx_all, me=None, rooms=(), pilot=None, read=None):
    """The recordings to label, as rows `{record, date, role, kind, people}`: 14 `fold` rows (two in a
    room, four with three or more speakers, eight 1:1 calls, the developer in all of them, chosen so the
    other people recur — each pick favours the people seen fewer than three times so far), then the
    `memo` (the newest recording transcribed with `--speakers 1`) and the `pilot` (`--pilot`), apart."""
    me = me or guess_me(ctx_all)
    rows, memo, pilot_row = [], None, None
    for rctx in ctx_all.get("records") or []:
        if not rctx.get("diarization_id"):
            continue
        fm = {}
        if read is not None:
            try:
                fm = read(rctx["record_path"])[0] or {}
            except (OSError, ValueError):
                fm = {}
        t = fm.get("transcription") or {}
        ref = rctx.get("record")
        date = _date_of(fm, rctx)
        people = [c["person"] for c in rctx.get("candidates") or [] if c.get("person")]
        base = {"record": ref, "date": date, "people": [p for p in people if p != me]}
        if pilot and _ref_matches(pilot, ref):
            pilot_row = dict(base, role="pilot", kind="pilot")
            continue
        if t.get("speakers_hint") == 1 or str(t.get("diarization") or "").startswith("skipped"):
            if memo is None or date > memo["date"]:
                memo = dict(base, role="memo", kind="solo memo")
            continue
        if rctx.get("meeting") is None or me not in people:
            continue
        n = rctx.get("attendee_count") or len(people)
        if _in_a_room(rctx, rooms):
            kind = "room"
        elif n == 2:
            kind = "1:1"
        elif n >= 3:
            kind = "three or more"
        else:
            continue
        rows.append(dict(base, kind=kind))
    freq = {}
    for r in rows:
        for p in r["people"]:
            freq[p] = freq.get(p, 0) + 1
    chosen, count = [], {}
    for kind, want in TARGETS:
        pool = [r for r in rows if r["kind"] == kind]
        for _ in range(want):
            if not pool:
                break

            def need(r):
                return (sum(max(0, 3 - count.get(p, 0)) for p in r["people"] if freq.get(p, 0) >= 2),
                        sum(min(freq.get(p, 0), 3) for p in r["people"]))
            # the most needed first; among equals the newest, then by reference (stable sorts)
            ranked = sorted(sorted(pool, key=lambda r: r["record"]), key=lambda r: r["date"], reverse=True)
            best = sorted(ranked, key=need, reverse=True)[0]
            pool.remove(best)
            chosen.append(dict(best, role="fold"))
            for p in best["people"]:
                count[p] = count.get(p, 0) + 1
    return chosen + ([memo] if memo else []) + ([pilot_row] if pilot_row else [])


def plan_lines(rows, me=None):
    """What `plan` prints: the rows, what falls short of the session's mix, and the label commands."""
    folds = [r for r in rows if r["role"] == "fold"]
    lines = [f"plan — {len(folds)} recordings to judge" + (f" (the developer: {me})" if me else "")]
    for r in folds:
        lines.append(f"  {r['kind']:<14} {r['date'] or '?':<10}  {r['record']}  with {', '.join(r['people']) or 'nobody else'}")
    count = {}
    for r in folds:
        for p in r["people"]:
            count[p] = count.get(p, 0) + 1
    recurring = sorted(p for p, n in count.items() if n >= 2)
    short = [f"{kind}: {sum(1 for r in folds if r['kind'] == kind)} of {want}" for kind, want in TARGETS
             if sum(1 for r in folds if r["kind"] == kind) < want]
    if len(recurring) < 3:
        short.append(f"other people in two or more: {len(recurring)} of 3")
    lines.append("  other people in two or more: " + (", ".join(f"{p} ({count[p]})" for p in recurring) or "none"))
    if short:
        lines.append("  short of the session's mix — " + "; ".join(short))
    lines.append("apart from the 14:")
    for role, what in (("memo", "the solo memo (transcribed with --speakers 1)"), ("pilot", "the pilot (the known mixed case)")):
        hit = [r for r in rows if r["role"] == role]
        lines.append(f"  {what}: {hit[0]['record'] if hit else 'not found — ' + ('transcribe it with --speakers 1' if role == 'memo' else 'name it with --pilot <record>')}")
    lines.append("label each of these (about 15 windows a recording):")
    for r in rows:
        lines.append(f"  label {r['record']}")
    return lines


# -- the shared vector work -------------------------------------------------------------------------------
@contextlib.contextmanager
def _memo_vectors():
    """Within the evaluation, `vec.robust_centroid` and `vec.two_means` are computed once per distinct
    set of windows: the folds replay the same labels again and again. Both are pure functions of their
    input, keyed here by a digest of the floats, so every result is the one the function gives."""
    rc, tm = vec.robust_centroid, vec.two_means
    cache = {}

    def key(tag, vs, extra):
        flat = array("d")
        for v in vs:
            flat.extend(float(x) for x in v)
        return (tag, len(vs), extra, hashlib.sha256(flat.tobytes()).digest())

    def robust_centroid(vs, drop=0.30, rounds=2):
        vs = list(vs)
        k = key("c", vs, (drop, rounds))
        if k not in cache:
            cache[k] = rc(vs, drop=drop, rounds=rounds)
        return list(cache[k])

    def two_means(vs, iters=25):
        vs = list(vs)
        k = key("2", vs, iters)
        if k not in cache:
            cache[k] = tm(vs, iters=iters)
        big, small, share, groups = cache[k]
        return list(big), list(small), share, list(groups)

    vec.robust_centroid, vec.two_means = robust_centroid, two_means
    try:
        yield
    finally:
        vec.robust_centroid, vec.two_means = rc, tm


# -- signatures -------------------------------------------------------------------------------------------
def signature_maker(*, decode_audio, load_embedder, read_samples, read_meeting, read_asr_cache,
                    asr_cache_path_for, asr_cache_matches):
    """`compute(model_id, rctx, audio, removed)` for a recording with no signature file for a model: the
    record's ASR cache (this record's, this audio's, this diarisation's) gives the segments and words, the
    audio is decoded into a temp folder removed after, and the windows are embedded with that model —
    `run`'s computation, `signatures.compute`."""
    def compute(model_id, rctx, audio, removed=()):
        fm, _ = read_meeting(rctx["record_path"])
        t = (fm or {}).get("transcription") or {}
        cache = read_asr_cache(asr_cache_path_for(rctx["record_path"]))
        if not asr_cache_matches(cache, rctx.get("record"), audio, t.get("diarization_id")):
            raise SignatureUnavailable("no ASR cache of this transcript on this machine — transcribe it again (step 0)")
        src = rctx.get("audio")
        if not src or not os.path.isfile(src):
            raise SignatureUnavailable("its audio is not on this machine")
        tmp = tempfile.mkdtemp(prefix="dt-evaluate-")
        try:
            wav = os.path.join(tmp, "audio.wav")
            decode_audio(src, wav)
            samples, sr = read_samples(wav)
            return vp_signatures.compute(
                load_embedder(model_id), samples, sr, cache.get("segments") or [],
                (cache.get("asr") or {}).get("words") or [], audio_sha256=audio, diarization_id=t["diarization_id"],
                speakers_hint=t.get("speakers_hint"), fallback=t.get("diarization_fallback"), removed=removed)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    return compute


def _signatures(pin, recs, store, compute, out):
    sigs, computed = {}, 0
    for r in recs:
        try:
            sig = store.read_signature(pin.id, r["audio"], r["diar"], model=pin)
        except vp_store.ModelMismatch as e:
            out(f"  {r['ref']}: left out for {pin.id} — {e}")
            continue
        if sig is None and compute is not None:
            removed = set()
            for other in models.MODELS:
                if other != pin.id:
                    s = store.read_signature(other, r["audio"], r["diar"])
                    removed.update((s or {}).get("removed") or [])
            try:
                sig = compute(pin.id, r["ctx"], r["audio"], sorted(removed))
            except (SignatureUnavailable, models.ModelRefused, OSError, ValueError) as e:
                out(f"  {r['ref']}: no {pin.id} signature — {e}")
                continue
            sig = store.write_signature(pin.id, sig, record={"workspace": r["ctx"].get("workspace"),
                                                             "record": r["ref"]})
            computed += 1
        if sig is None:
            out(f"  {r['ref']}: no {pin.id} signature")
            continue
        sigs[r["audio"]] = sig
    return sigs, computed


# -- one model --------------------------------------------------------------------------------------------
def _windows(sig, lab):
    return [w["vector"] for w in ((sig.get("labels") or {}).get(lab) or {}).get("windows") or [] if w.get("vector")]


def _spread_take(vs, k):
    if k <= 0:
        return []
    if k >= len(vs):
        return list(vs)
    if k == 1:
        return [vs[0]]
    return [vs[int(round(i * (len(vs) - 1) / (k - 1)))] for i in range(k)]


class _Model:
    """Everything one speaker model's evaluation computes once: centroids, the pure labels by person, and
    per recording the label pairs, the pure labels' two-group cosines and the mixed sets."""

    def __init__(self, pin, recs, sigs):
        self.pin = pin
        self.recs = [r for r in recs if r["audio"] in sigs and r["answers"]]
        self.sigs = sigs
        self.cent, self.pure, self.by_person = {}, [], {}
        self.cross, self.split, self.mixed = {}, {}, {}
        for r in self.recs:
            sig = sigs[r["audio"]]
            removed = set(sig.get("removed") or [])
            labs = []
            for lab, g in r["gold"].items():
                if lab in removed or lab not in (sig.get("labels") or {}):
                    continue
                c = naming.label_centroid(sig, lab)
                if c is None:
                    continue
                self.cent[(r["audio"], lab)] = c
                if g["kind"] == "pure":
                    labs.append(lab)
                    self.pure.append((r, lab, g["speaker"]))
                    self.by_person.setdefault(g["speaker"], []).append((r["audio"], c))
            self.split[r["audio"]] = []
            for lab in labs:
                vs = _windows(sig, lab)
                if len(vs) >= 2:
                    big, small, _, _ = vec.two_means(vs)
                    self.split[r["audio"]].append(vec.cos(big, small))
            self.cross[r["audio"]], self.mixed[r["audio"]] = [], []
            for i in range(len(labs)):
                for j in range(i + 1, len(labs)):
                    a, b = labs[i], labs[j]
                    if r["gold"][a]["speaker"] == r["gold"][b]["speaker"]:
                        continue
                    self.cross[r["audio"]].append(vec.cos(self.cent[(r["audio"], a)], self.cent[(r["audio"], b)]))
                    wa, wb = _windows(sig, a), _windows(sig, b)
                    if len(wa) < 2 or not wb:
                        continue
                    nb = max(1, int(round(len(wa) * MIXED_SHARE / (1.0 - MIXED_SHARE))))
                    big, small, share, _ = vec.two_means(wa + _spread_take(wb, nb))
                    self.mixed[r["audio"]].append(vec.cos(big, small) if share >= SMALL_GROUP else 1.0)

    def trials(self, exclude):
        """The gold trials over the recordings not in `exclude`, each scored against the speaker's (or the
        impostor's) print rebuilt without `exclude` and without the trial's own recording."""
        G, C, O, behind, used = [], [], [], set(), set()
        people = sorted(self.by_person)
        for r, lab, spk in self.pure:
            if r["audio"] in exclude:
                continue
            c = self.cent[(r["audio"], lab)]
            attendees = {x.get("person") for x in r["ctx"].get("candidates") or []}
            for p in people:
                src = [(a, v) for a, v in self.by_person[p] if a not in exclude and a != r["audio"]]
                if not src:
                    continue                       # the print lost its only source: no trial
                s = vec.cos(c, vec.mean_unit([v for _, v in src]))
                behind.update(a for a, _ in src)
                used.add(r["audio"])
                if p == spk:
                    G.append(s)
                else:
                    O.append(s)
                    if p in attendees:
                        C.append(s)
        pick = lambda d: [x for a, xs in d.items() if a not in exclude for x in xs]
        return {"genuine": G, "closed": C, "open": O, "behind": behind, "recordings": len(used),
                "cross": pick(self.cross), "split": pick(self.split), "mixed": pick(self.mixed)}

    def fit(self, exclude):
        t = self.trials(exclude)
        return t, calibration.fit(t["genuine"], t["closed"], t["open"], t["cross"], t["split"], t["mixed"])


def _confirmations(m, exclude):
    """Every heard label (pure or mixed) of every recording not in `exclude`, confirmed as its majority
    speaker on the recording's date."""
    out = []
    for r in m.recs:
        if r["audio"] in exclude:
            continue
        sig = m.sigs[r["audio"]]
        for lab, g in sorted(r["gold"].items(), key=lambda kv: _label_key(kv[0])):
            if g["kind"] not in ("pure", "mixed") or lab not in (sig.get("labels") or {}):
                continue
            out.append({"audio": r["audio"], "diarization": r["diar"], "label": lab,
                        "workspace": r["ctx"].get("workspace"), "person": g["speaker"], "condition": None,
                        "seconds": float(((sig.get("labels") or {}).get(lab) or {}).get("seconds") or 0.0),
                        "confirmed": f"{r['date'] or '1970-01-01'}T12:00:00+00:00", "status": None, "reason": None})
    return out


def _pid(ws, person):
    return "p-" + hashlib.sha256(f"{ws}\0{person}".encode("utf-8")).hexdigest()[:10]


def _replay(tmp, m, exclude, th, known):
    """The prints rebuilt without `exclude` in the temporary store, by `enrol.replay` in the order
    recording date then label (ruling D6). Returns `({person: print}, sources' audio keys)`."""
    mdir = tmp.model_dir(m.pin.id)
    shutil.rmtree(os.path.join(mdir, "prints"), ignore_errors=True)
    try:
        os.remove(os.path.join(mdir, "enrolment.json"))
    except FileNotFoundError:
        pass
    by = {}
    for s in _confirmations(m, exclude):
        by.setdefault((s["workspace"], s["person"]), []).append(s)
    model = {"id": m.pin.id, "sha256": m.pin.sha256, "dim": m.pin.dim}
    for (ws, person), srcs in sorted(by.items()):
        tmp.write_print(m.pin.id, {"version": 1, "id": _pid(ws, person),
                                   "known_as": [{"workspace": ws, "person": person, "name": known.get(person) or person}],
                                   "model": model, "vector": None, "seconds": 0.0, "trust": "proposing", "auto": True,
                                   "sources": srcs, "negatives": [], "created": "1970-01-01", "updated": "1970-01-01"})
    date_of = {r["audio"]: r["date"] for r in m.recs}
    enrol.replay(tmp, m.pin, th, order=lambda s: (date_of.get(s.get("audio"), ""), _label_key(s.get("label"))[:2]))
    prints, audios = {}, set()
    for p in tmp.prints(m.pin.id, model=m.pin):
        for k in p.get("known_as") or []:
            prints[k["person"]] = p
        audios.update(s.get("audio") for s in p.get("sources") or [])
    return prints, audios


def _tally(names, g):
    written = wrong = unchecked = 0
    wrongs = []
    for lab, n in sorted(names.items()):
        h = g.get(lab)
        if h is None or h["kind"] == "unheard":
            unchecked += 1
            continue
        written += 1
        if h["kind"] == "mixed" or n["person"] != h["speaker"]:
            wrong += 1
            wrongs.append((lab, n["person"], h["speaker"], h["kind"]))
    return written, wrong, unchecked, wrongs


def evaluate_model(pin, recs, sigs, *, pilot=None, known=None, out=lambda s: None):
    """One speaker model's evaluation (see the module's docstring). Returns the dict `calibration`'s rules
    read, plus what `render` prints."""
    known = known or {}
    m = _Model(pin, recs, sigs)
    t_all, fit_all = m.fit(set())
    folds_of = [r for r in m.recs if len((m.sigs[r["audio"]].get("labels") or {})) >= 2
                and not (pilot and _ref_matches(pilot, r["ref"]))]
    res = {"model": {"id": pin.id, "sha256": pin.sha256, "dim": pin.dim},
           "evidence": {"genuine": len(t_all["genuine"]), "impostor": len(t_all["open"]),
                        "closed": len(t_all["closed"]), "recordings": t_all["recordings"], "people": len(m.by_person)},
           "scores": {"genuine": t_all["genuine"], "closed": t_all["closed"], "open": t_all["open"]},
           "fit": fit_all, "folds": [], "written": 0, "wrong": 0, "unchecked": 0, "judged": 0, "eligible": 0,
           "named_eligible": 0, "open_written": 0, "open_wrong": 0, "enrolled_mixed": 0, "thin": 0,
           "wrongs": [], "silver": [], "purity": [], "check4": {}, "extras": [r["ref"] for r in m.recs if r not in folds_of],
           "gold_labels": [(r["ref"], lab, g["kind"]) for r in m.recs for lab, g in r["gold"].items()]}
    # purity per label, and check 4 against what was heard
    hits = false_alarms = misses = mixed_heard = 0
    for r in m.recs:
        sig = m.sigs[r["audio"]]
        for lab, g in sorted(r["gold"].items(), key=lambda kv: _label_key(kv[0])):
            flagged = lab in (sig.get("labels") or {}) and naming.long_turn(lab, sig)
            res["purity"].append({"record": r["ref"], "label": lab, "purity": g["purity"], "heard": g["heard"],
                                  "kind": g["kind"], "speaker": g["speaker"], "check4": flagged})
            if g["kind"] == "mixed":
                mixed_heard += 1
                hits += flagged
                misses += not flagged
            elif g["kind"] == "pure":
                false_alarms += flagged
    res["check4"] = {"flagged": hits + false_alarms, "mixed": hits, "pure": false_alarms, "missed": misses,
                     "mixed_heard": mixed_heard}
    mixed_refs = {(r["audio"], r["diar"], lab) for r in m.recs for lab, g in r["gold"].items() if g["kind"] == "mixed"}

    tmp_home = tempfile.mkdtemp(prefix="dt-evaluate-store-")
    try:
        tmp = vp_store.Store(os.path.join(tmp_home, "store"), exclude_backup=lambda h: None)
        for r in m.recs:     # the signatures the replays read, copied once; the user's store is only read
            tmp.write_json(tmp.signature_path(pin.id, r["audio"], r["diar"]), m.sigs[r["audio"]])
        for i, R in enumerate(folds_of, 1):
            excl = {R["audio"]}
            t, f = m.fit(excl)
            fold = {"n": i, "record": R["ref"], "recordings": t["recordings"], "genuine": len(t["genuine"]),
                    "impostor": len(t["open"]), "closed": len(t["closed"]), "thin": len(t["genuine"]) < calibration.THIN_BELOW,
                    "trial_audios": set(t["behind"]), "naming_audios": set(), "fit_fails": f.get("fails"),
                    "written": 0, "wrong": 0, "judged": 0, "eligible": 0, "named_eligible": 0,
                    "open_written": 0, "open_wrong": 0, "enrolled_mixed": 0}
            res["thin"] += fold["thin"]
            pure_here = [lab for lab, g in R["gold"].items() if g["kind"] == "pure"]
            fold["judged"] = len(pure_here)
            if "fails" not in f:
                th = calibration.thresholds(f)
                prints, audios = _replay(tmp, m, excl, th, known)
                fold["naming_audios"] = audios
                for p in prints.values():
                    for s in p.get("sources") or []:
                        if s.get("status") == enrol.ADMITTED and (s["audio"], s["diarization"], s["label"]) in mixed_refs:
                            fold["enrolled_mixed"] += 1
                calib = {"model": pin.id, "thresholds": th, "print_closed": "auto", "print_open": "auto", "source": "fold"}
                sig = m.sigs[R["audio"]]
                d = naming.decide(sig, R["ctx"], prints, {}, calib)
                w, wr, un, wrongs = _tally(d["names"], R["gold"])
                fold.update(written=w, wrong=wr)
                res["unchecked"] += un
                res["wrongs"].extend((R["ref"],) + x for x in wrongs)
                trusted = [lab for lab in pure_here if (prints.get(R["gold"][lab]["speaker"]) or {}).get("trust") == "trusted"]
                fold["eligible"] = len(trusted)
                fold["named_eligible"] = sum(1 for lab in trusted
                                             if (d["names"].get(lab) or {}).get("person") == R["gold"][lab]["speaker"])
                open_ctx = dict(R["ctx"], meeting=None, attendee_count=None, attendee_count_certain=False,
                                candidates=[{"person": p, "name": known.get(p) or p,
                                             "kind": "user" if p.startswith("users/") else "contact"} for p in sorted(prints)])
                do = naming.decide(sig, open_ctx, prints, {}, calib)
                ow, owr, _, _ = _tally(do["names"], R["gold"])
                fold.update(open_written=ow, open_wrong=owr)
            for k in ("written", "wrong", "judged", "eligible", "named_eligible", "open_written", "open_wrong",
                      "enrolled_mixed"):
                res[k] += fold[k]
            res["folds"].append(fold)
            out(f"  {pin.id}: fold {i} of {len(folds_of)} judged")
        # silver: unheard hand maps, against the prints of the whole labelled set
        th_all = calibration.thresholds(fit_all) if "fails" not in fit_all else dict(naming.UNCALIBRATED)
        prints, _ = _replay(tmp, m, set(), th_all, known)
        res["silver"] = _silver(m, prints, th_all, known)
    finally:
        shutil.rmtree(tmp_home, ignore_errors=True)
    return res


def _silver(m, prints, th, known):
    by_name = {}
    for p, n in (known or {}).items():
        by_name.setdefault(" ".join(str(n).split()).casefold(), set()).add(p)
    out = []
    for r in m.recs:
        sig = m.sigs[r["audio"]]
        prev = (r["t"].get("previous_speakers") or {}).get("labels") or {}
        for entry in prev.values():
            if not isinstance(entry, dict):
                continue
            lab = entry.get("new_label")
            if not lab or lab not in (sig.get("labels") or {}) or lab in set(sig.get("removed") or []):
                continue
            if (r["gold"].get(lab) or {}).get("kind") in ("pure", "mixed"):
                continue                                   # heard: gold supersedes the hand map
            person = (entry.get("source") or {}).get("person")
            if not person:
                key = " ".join(str(entry.get("name") or "").split()).casefold()
                cands = {c["person"] for c in r["ctx"].get("candidates") or []
                         if " ".join(str(c.get("name") or "").split()).casefold() == key}
                hit = cands or by_name.get(key) or set()
                person = sorted(hit)[0] if len(hit) == 1 else None
            if not person or naming.long_turn(lab, sig) or naming.two_voices(lab, sig, th["split"]):
                continue
            c = naming.label_centroid(sig, lab)
            if c is None:
                continue
            own = vec.cos(c, prints[person]["vector"]) if (prints.get(person) or {}).get("vector") else None
            rivals = sorted(((vec.cos(c, p["vector"]), q) for q, p in prints.items() if q != person and p.get("vector")),
                            key=lambda t: (-t[0], t[1]))
            best = rivals[0] if rivals else None
            disagrees = own is None or own < th["accept"] or (best is not None and best[0] >= own)
            out.append({"record": r["ref"], "label": lab, "person": person, "own": own,
                        "best": best[0] if best else None, "best_person": best[1] if best else None,
                        "disagrees": disagrees})
    return out


# -- the run ----------------------------------------------------------------------------------------------
def run(ctx_all, store, pins, *, read, audio_key, compute=None, only=None, pilot=None, out=print):
    """Evaluate every model of `pins` (`{model id: store.Model}`; `only` one of them) over the labelled
    recordings of `ctx_all`. Returns `{recordings, labelled, per_model: {model id: result}, computed}`."""
    recs = load(ctx_all, store, read=read, audio_key=audio_key, out=out)
    labelled = [r for r in recs if r["answers"]]
    known = dict(ctx_all.get("known") or {})
    for r in recs:
        known.update(r["ctx"].get("known") or {})
    ids = [mid for mid in pins if only is None or mid == only]
    if only is not None and not ids:
        raise Usage(f"--only {only}: not a model this evaluation has")
    per_model, computed = {}, {}
    with _memo_vectors():
        for mid in ids:
            sigs, computed[mid] = _signatures(pins[mid], labelled, store, compute, out)
            per_model[mid] = evaluate_model(pins[mid], labelled, sigs, pilot=pilot, known=known, out=lambda s: None)
    return {"recordings": len(recs), "labelled": len(labelled), "per_model": per_model, "computed": computed,
            "pilot": pilot}


def _dist(name, xs):
    if not xs:
        return f"{name}: 0 trials"
    p = calibration.percentile
    return (f"{name}: {len(xs)} trials · min {min(xs):.3f} · p10 {p(xs, 10):.3f} · median {p(xs, 50):.3f} · "
            f"p95 {p(xs, 95):.3f} · max {max(xs):.3f}")


def _display(lab):
    return naming.display(lab)


def render(result):
    """The printed evaluation: per model, purity per label, check 4, the score distributions, the fit on
    all recordings, one line per fold, the replay's totals and the silver second look; then the verdict."""
    lines = [f"evaluate-speakers — {result['labelled']} labelled of {result['recordings']} diarised recordings"]
    for mid, r in result["per_model"].items():
        lines.append(f"model {mid}")
        lines.append(f"  signatures: {result['computed'].get(mid, 0)} computed now; judged {len(r['folds'])} recordings, "
                     f"{len(r['extras'])} apart ({', '.join(r['extras']) or 'none'})")
        lines.append("  purity per label (the share of heard windows its majority speaker holds):")
        for p in r["purity"]:
            what = {"pure": "pure", "mixed": "heard as mixed — no trial", "unheard": "mostly unsure — no trial"}[p["kind"]]
            lines.append(f"    {p['record']} {_display(p['label'])}: purity {p['purity']:.2f} of {p['heard']} heard windows "
                         f"— {what}" + (f", {p['speaker']}" if p["speaker"] and p["kind"] != "unheard" else "")
                         + ("; check 4 flags it" if p["check4"] else ""))
        c4 = r["check4"]
        lines.append(f"  check 4 (a turn over five minutes or over 90% of the speech): flagged {c4['flagged']} — "
                     f"{c4['mixed']} heard as mixed, {c4['pure']} heard as pure; missed {c4['missed']} of "
                     f"{c4['mixed_heard']} labels heard as mixed")
        sc = r["scores"]
        lines.append("  " + _dist("genuine (true match) scores", sc["genuine"]))
        lines.append("  " + _dist("impostor (false match) scores, closed set", sc["closed"]))
        lines.append("  " + _dist("impostor (false match) scores, open set", sc["open"]))
        e = r["evidence"]
        lines.append(f"  gold evidence: {e['genuine']} genuine and {e['impostor']} impostor trials "
                     f"({e['closed']} closed-set) from {e['recordings']} recordings and {e['people']} people with prints")
        f = r["fit"]
        if "fails" in f:
            lines.append(f"  thresholds on all labelled recordings: the model fails — {f['fails']}")
        else:
            lines.append("  thresholds on all labelled recordings (the ones that ship): "
                         + " · ".join(f"{k} {f[k]:.4f}" for k in calibration.THRESHOLDS)
                         + f"; mixed sets passing split: {f['mixed']['pass']} of {f['mixed']['sets']}"
                         + (" — the embedding check is WEAK for this model" if f["split_weak"] else ""))
        lines.append("  folds — each recording judged by prints and thresholds that never saw it:")
        for fo in r["folds"]:
            head = (f"    fold {fo['n']} · {fo['record']}: fitted on {fo['recordings']} labelled recordings, "
                    f"{fo['genuine']} genuine and {fo['impostor']} impostor trials ({fo['closed']} closed-set) — "
                    f"the judged recording was in none of them")
            if fo["thin"]:
                head += "; THIN"
            if fo["fit_fails"]:
                head += f"; no thresholds: {fo['fit_fails']}"
            else:
                head += (f"; wrote {fo['written']} names ({fo['wrong']} wrong), named {fo['named_eligible']} of "
                         f"{fo['eligible']} labels whose speaker has a trusted print; open set {fo['open_written']} "
                         f"({fo['open_wrong']} wrong)")
            lines.append(head)
        lines.append(f"  replay: {r['written']} names written, {r['wrong']} wrong, over {len(r['folds'])} folds; named "
                     f"{r['named_eligible']} of {r['eligible']} labels whose speaker had a trusted print; enrolled from "
                     f"{r['enrolled_mixed']} labels heard as mixed; open set {r['open_written']} names, {r['open_wrong']} "
                     f"wrong; thin folds {r['thin']}"
                     + (f"; {r['unchecked']} names on labels nobody heard (not counted)" if r["unchecked"] else ""))
        for rec, lab, said, heard, kind in r["wrongs"]:
            lines.append(f"    wrong: {rec} {_display(lab)} named {said}, heard {heard}" + (" (heard as mixed)" if kind == "mixed" else ""))
        lines.append(f"  silver (unheard hand maps passing checks 4 and 5 — a second look, never counted): {len(r['silver'])}")
        for s in r["silver"]:
            own = "no print" if s["own"] is None else f"{s['own']:.3f}"
            best = "" if s["best"] is None else f"; best other print {s['best']:.3f} ({s['best_person']})"
            tail = (f" — disagrees: listen with `label {s['record']} --only {s['label']}`, then run this again"
                    if s["disagrees"] else " — agrees")
            lines.append(f"    {s['record']} {_display(s['label'])}: hand map {s['person']} scores {own}{best}{tail}")
    lines.extend(calibration.verdict(result["per_model"]).split("\n") if result["per_model"] else
                 ["verdict: insufficient, label more — no model was evaluated; nothing is written"])
    return lines


# -- the verb ---------------------------------------------------------------------------------------------
def _parse(args):
    opts = {"plan": False, "write": False, "install_local": False, "only": None, "rooms": [], "pilot": None,
            "me": None, "context": None}
    i = 0
    while i < len(args):
        a = args[i]
        if a in ("--only", "--room", "--pilot", "--me", "--context"):
            if i + 1 >= len(args):
                raise Usage(f"{a} needs a value")
            v = args[i + 1]
            if a == "--room":
                opts["rooms"].append(v)
            else:
                opts[a[2:]] = v
            i += 2
            continue
        if a == "--write":
            opts["write"] = True
        elif a == "--install-local":
            opts["install_local"] = True
        elif a == "plan":
            opts["plan"] = True
        else:
            raise Usage(f"evaluate-speakers does not know {a!r}")
        i += 1
    if opts["install_local"] and not opts["write"]:
        raise Usage("--install-local goes with --write")
    if opts["plan"] and opts["write"]:
        raise Usage("plan writes nothing; run --write without plan")
    return opts


def main(args, *, skill_dir=None, models_dir=None, read=None, audio_key=None, compute=None, ctx=None, store=None,
         pins=None, out=print, today=None):
    """`evaluate-speakers …` (args[0] is the verb). Returns the exit code."""
    try:
        opts = _parse(list(args[1:]))
        if ctx is None:
            if not opts["context"]:
                raise Usage("no --context: run it through the module's entry (`transcribe.mjs evaluate-speakers`)")
            with open(opts["context"], encoding="utf-8") as f:
                ctx = json.load(f)
        if not isinstance(ctx, dict) or not isinstance(ctx.get("records"), list):
            raise Usage("the context holds no recordings")
        if store is None:
            store = vp_store.Store(vp_store.default_home(), guard=ctx.get("guard") or {})
        if opts["plan"]:
            me = opts["me"] or guess_me(ctx)
            for line in plan_lines(plan(ctx, me, rooms=opts["rooms"], pilot=opts["pilot"], read=read), me):
                out(line)
            return 0
        if pins is None:
            pins, missing = {}, []
            for mid in models.MODELS:
                if opts["only"] and mid != opts["only"]:
                    continue
                try:
                    pins[mid] = models.pin(mid, models_dir)
                except models.ModelRefused as e:
                    missing.append(str(e))
            if missing:
                for line in missing:
                    out(f"✖ {line}")
                out("  every model is evaluated: `setup --speaker-models all` (or `--only <model id>`)")
                return 1
        result = run(ctx, store, pins, read=read, audio_key=audio_key, compute=compute, only=opts["only"],
                     pilot=opts["pilot"], out=out)
        for line in render(result):
            out(line)
        if not opts["write"]:
            return 0
        return _write(result, store, opts["install_local"], today or _date.today().isoformat(), out)
    except Usage as e:
        out(f"✖ {e}\n  usage: {USAGE}")
        return 2
    except (vp_store.StoreRefused, vp_store.ModelMismatch, models.CalibrationAmbiguous, OSError, ValueError) as e:
        out(f"✖ {e}")
        return 1


def _write(result, store, install_local, today, out):
    per = result["per_model"]
    c = calibration.choose(per) if per else {"kind": "insufficient"}
    if c["kind"] == "insufficient":
        out("nothing written: the evidence is insufficient — label more")
        return 1
    if c["kind"] == "chosen":
        mid, chosen = c["model"], True
    else:
        fitted = [m for m in per if "fails" not in per[m]["fit"]]
        if not fitted:
            out("nothing written: no model's thresholds could be fitted")
            return 1
        mid = models.DEFAULT_MODEL if models.DEFAULT_MODEL in fitted else fitted[0]
        chosen = False
    body = calibration.build_file(per[mid], chosen=chosen, generated=today)
    path = os.path.join(store.calibration_labels_dir(), f"calibration-{mid}.json")
    store.write_json(path, body)
    out(f"written: {path}")
    if not chosen:
        out("  no model qualified: print_closed and print_open are propose")
    if install_local:
        local = os.path.join(store.model_dir(mid), calibration.LOCAL_FILE)
        store.write_json(local, body)
        out(f"installed as this machine's local calibration: {local}")
    return 0
