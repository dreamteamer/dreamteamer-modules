"""`prints`: the voice-print store, seen and changed from one workspace (design sections 8 and 9).

    list                      this workspace's people (a `known_as` entry for it): trust, recordings, seconds;
                              everyone else counted, never named; never a vector
    forget <person>           section 8 steps 1 to 6: the print in every model folder; the windows of every label
                              that fed it and of every label this workspace's records attribute to the person (a
                              name of any status, an earlier name, an open proposal), in every model folder; the
                              proposals removed from the records; one forgotten.json entry per print with every
                              `known_as` entry; the offer of `identify --revert --person`; a count of the other
                              workspaces that know them
    never <person>            forget, plus a never.json entry (matched by workspace and reference, and by name
                              in other workspaces)
    forget-recording <record> every diarisation file of that audio in every model folder, then the prints that
                              used it rebuilt
    link <person>             joins this workspace's print of the person with the one print from another
                              workspace it resembles; names nothing from there (the entry has no `since`, D21)
    rebuild                   the active model's prints from their sources: carried from every other model folder,
                              missing signatures computed from the records the context hands, the rest `waiting`
    reseed <person>           `enrol.reseed`: the first admitted source kept aside, the print starts again

Every message names only people this workspace knows (section 8, "What one workspace may see of another"). Every
verb prints one JSON object; nothing printed is a vector or a numeric array.

After a forget or a forget-recording every model folder that holds prints is replayed with its own calibration
(the active one's, else a local `calibration.json` there, else none — a folder that is not active then keeps its
sources and no vector until it is active and rebuilt), so no print anywhere still averages a voice that was
removed. A folder whose files were made with another file of the same model id is set aside by `rebuild` under
`<model id>@<sha256 prefix>`, read like any other model folder (its `removed` is honoured, its sources wait).

Standard library only (the `engines.py` rule).
"""
from __future__ import annotations

import copy
import json
import os
import shutil

from voiceprints import calibration, enrol, identify, models, vec
from voiceprints import store as vp_store

SUBS = ("list", "rebuild", "forget", "never", "forget-recording", "link", "reseed")
ONE_ARG = {"forget": "<person>", "never": "<person>", "link": "<person>", "reseed": "<person>",
           "forget-recording": "<record>"}
USAGE = ("prints list | prints rebuild | prints forget <person> | prints never <person> | "
         "prints forget-recording <record> | prints link <person> | prints reseed <person>   "
         "(each with --context <file.json>)")


class Usage(Exception):
    """Arguments the verb cannot act on; nothing was written."""


class Refused(Exception):
    """The verb cannot do what was asked (no print here, nothing resembles it); nothing was written."""


def _map(v):
    return v if isinstance(v, dict) else {}


def _norm(s):
    return " ".join(str(s or "").split()).casefold()


def _s(n, one="", many="s"):
    return one if n == 1 else many


def _known(p, ws, person=None):
    return enrol._known(p, ws, person)


def folders(store):
    return enrol._model_folders(store)


def _same_pin(obj, pin):
    m = _map((obj or {}).get("model"))
    return m.get("id") == pin.id and m.get("sha256") == pin.sha256 and m.get("dim") == pin.dim


def folder_pin(store, mid, active):
    """The pin a model folder's prints were made with: the active one's, the registry's, else the folder's own
    prints say it (a folder set aside, or a test model)."""
    if mid == active["model"]:
        return active["pin"]
    if mid in models.MODELS:
        e = models.entry(mid)
        return vp_store.Model(e["id"], e["sha256"], e["dim"])
    for p in store.prints(mid):
        m = _map(p.get("model"))
        if m.get("id"):
            return vp_store.Model(m.get("id"), m.get("sha256"), m.get("dim"))
    return None


def folder_thresholds(store, mid, active):
    if mid == active["model"]:
        return identify._thresholds(active)
    local = store.read_json(os.path.join(store.model_dir(mid), calibration.LOCAL_FILE))
    if local is None:
        return None
    try:
        return calibration.to_calib(calibration.validate(local), "local")["thresholds"]
    except calibration.CalibrationInvalid:
        return None


def replay_all(store, active):
    """Every model folder that holds prints, replayed with its own thresholds. `{model id: report}`."""
    out = {}
    for mid in folders(store):
        if not store.prints(mid):
            continue
        pin = folder_pin(store, mid, active)
        if pin is None:
            continue
        try:
            out[mid] = enrol.replay(store, pin, folder_thresholds(store, mid, active))
        except vp_store.ModelMismatch as e:
            out[mid] = {"error": str(e)}
    return out


def name_here(ctx, ref, prints=()):
    """This workspace's name for `ref`: the context's, else the name its `known_as` entry carries."""
    n = identify.person_name(ctx, ref)
    if n:
        return n
    if _map(ctx.get("person")).get("ref") == ref and _map(ctx.get("person")).get("name"):
        return ctx["person"]["name"]
    for p in prints:
        k = _known(p, ctx.get("workspace"), ref)
        if k and k.get("name"):
            return k["name"]
    return None


def _notices(reports, ctx):
    """The replays' notices a person in this workspace may read, once each: the namesake notice names nobody;
    a reseed notice only in this workspace's name."""
    out = []
    for rep in reports:
        for n in (rep or {}).get("notices") or []:
            if n.get("kind") == "reseed" and n.get("workspace") != ctx.get("workspace"):
                continue
            if n.get("text") and n["text"] not in out:
                out.append(n["text"])
    return out


def _stuck_lines(store, pin, ctx, rep):
    out = []
    ws = ctx.get("workspace")
    for pid in (rep or {}).get("stuck") or []:
        p = store.read_json(store.print_path(pin.id, pid)) or {}
        k = _known(p, ws)
        if k:
            out.append(enrol.reseed_notice(name_here(ctx, k.get("person"), [p]) or k.get("name"), k.get("person")))
    return out


# -- list ------------------------------------------------------------------------------------------------------
def _row(p, ctx, ref, pin):
    ss = p.get("sources") or []
    row = {"person": ref, "name": name_here(ctx, ref, [p]), "trust": p.get("trust"), "auto": bool(p.get("auto")),
           "sources": len(ss),
           "admitted": sum(s.get("status") == enrol.ADMITTED for s in ss),
           "held": sum(s.get("status") == enrol.HELD for s in ss),
           "waiting": sum(s.get("status") == enrol.WAITING for s in ss),
           "seconds": round(float(p.get("seconds") or 0.0), 1)}
    if not _same_pin(p, pin):
        row["trust"] = "another model file"
    return row


def do_list(store, active, ctx):
    ws, pin = ctx.get("workspace"), active["pin"]
    here = store.prints(pin.id)
    rows = []
    for p in here:
        for k in p.get("known_as") or []:
            if k.get("workspace") == ws and k.get("person"):
                rows.append(_row(p, ctx, k["person"], pin))
    rows.sort(key=lambda r: (_norm(r["name"]), r["person"]))
    elsewhere = set()
    for mid in folders(store):
        for p in store.prints(mid):
            if not _known(p, ws):
                elsewhere.add(p.get("id"))
    stale = identify.other_model_people(store, pin.id, ws, {r["person"] for r in rows})
    lines = [f"Voice prints of people this workspace knows (speaker model {pin.id}):" if rows
             else f"No voice print of anyone this workspace knows (speaker model {pin.id})."]
    for r in rows:
        bits = [r["trust"], f"{r['admitted']} of {r['sources']} recording{_s(r['sources'])} teaching it",
                f"{r['seconds']:.0f} s of speech"]
        if r["held"]:
            bits.append(f"{r['held']} kept aside")
        if r["waiting"]:
            bits.append(f"{r['waiting']} waiting for `prints rebuild`")
        if not r["auto"]:
            bits.append("proposes only")
        lines.append(f"- {r['name']} — " + ", ".join(bits))
    if elsewhere:
        n = len(elsewhere)
        lines.append(f"and {n} {'person' if n == 1 else 'people'} known only in other workspaces")
    if any(r["trust"] == "another model file" for r in rows):
        lines.append("Some of these were made with another file of this speaker model; run `prints rebuild`.")
    if stale:
        lines.append(identify.rebuild_line(len(stale), pin.id))
    return {"workspace": ws, "model": pin.id, "people": rows, "elsewhere": len(elsewhere),
            "other_models": len(stale), "reply": "\n".join(lines)}


# -- forget and never ------------------------------------------------------------------------------------------
def _theirs(ref, name):
    def hit(nm, person):
        if person:
            return person == ref
        return bool(name) and _norm(nm) == _norm(name)
    return hit


def attributed(fm, ref, name):
    """`(diarisation id, earlier diarisation id, labels of the one, labels of the other)` a record attributes to
    the person: a name of any status, an open proposal, an earlier name (on the earlier diarisation's label it
    sat on, and on the label of this one its time went to)."""
    hit = _theirs(ref, name)
    t = _map(fm.get("transcription"))
    did = t.get("diarization_id")
    prev = _map(t.get("previous_speakers"))
    srcs = _map(t.get("speaker_sources"))
    cur, old = set(), set()
    for label, n in _map(t.get("speakers")).items():
        if hit(n, _map(srcs.get(label)).get("person")):
            cur.add(label)
    for label, src in srcs.items():
        if _map(src).get("person") == ref:
            cur.add(label)
    for label, q in _map(t.get("speaker_questions")).items():
        p = _map(_map(q).get("proposed"))
        if p and hit(p.get("name"), p.get("person")):
            cur.add(label)
    for key, e in _map(prev.get("labels")).items():
        if not isinstance(e, dict) or not hit(e.get("name"), _map(e.get("source")).get("person")):
            continue
        lab = e.get("label") if isinstance(e.get("label"), str) and e.get("label") else \
            (None if str(key).startswith("earlier:") else str(key).split("#")[0])
        if lab:
            old.add(lab)
        if e.get("new_label"):
            cur.add(e["new_label"])
    return did, prev.get("diarization_id"), cur, old


def scrub(fm, ref, name, stamp):
    """The record after a forget: proposals of the person removed from its questions (section 8 step 3), its
    earlier names of them marked forgotten (at the forget's instant), so nothing carried proposes them. Returns
    `(fm, proposals removed, earlier names marked, provisional names left)`."""
    fm = copy.deepcopy(fm)
    hit = _theirs(ref, name)
    t = _map(fm.get("transcription"))
    removed = marked = 0
    for label, q in _map(t.get("speaker_questions")).items():
        if isinstance(q, dict) and hit(_map(q.get("proposed")).get("name"), _map(q.get("proposed")).get("person")) \
                and q.get("proposed"):
            del q["proposed"]
            removed += 1
    for key, e in _map(_map(t.get("previous_speakers")).get("labels")).items():
        if isinstance(e, dict) and hit(e.get("name"), _map(e.get("source")).get("person")) and e.get("forgotten") is not True:
            e["forgotten"], e["forgotten_at"], e["offered"] = True, stamp, False
            marked += 1
    provisional = sum(1 for label in _map(t.get("speakers"))
                      if identify.status_of(t, label) == "provisional"
                      and _map(_map(t.get("speaker_sources")).get(label)).get("person") == ref)
    if (removed or marked) and t.get("diarization_id"):
        identify._set_state(fm)
    return fm, removed, marked, provisional


def _union_known(entries, more):
    for k in more or []:
        if not any(e.get("workspace") == k.get("workspace") and e.get("person") == k.get("person") for e in entries):
            entries.append(copy.deepcopy(k))
    return entries


def forget(store, active, ctx, ref, stamp, *, read, write, never=False, audio_key=None):
    ws = ctx.get("workspace")
    hits = []                                   # (model id, print)
    for mid in folders(store):
        for p in store.prints(mid):
            if _known(p, ws, ref):
                hits.append((mid, p))
    name = name_here(ctx, ref, [p for _, p in hits])
    rows = [r for r in ctx.get("person_records") or [] if isinstance(r, dict) and r.get("record_path")]
    if not name and not hits and not rows:
        raise Usage(f"{ref} is not a person this workspace knows")
    name = name or ref

    # step 4 first, so a confirmation racing this forget is already before `at`
    by_pid = {}
    for _, p in hits:
        _union_known(by_pid.setdefault(p["id"], []), p.get("known_as"))
    if never:
        store.add_never({"workspace": ws, "person": ref, "name": name, "at": stamp})
    entries = [{"print": pid, "known_as": ka, "at": stamp} for pid, ka in sorted(by_pid.items())] or \
        [{"print": None, "known_as": [{"workspace": ws, "person": ref, "name": name}], "at": stamp}]
    for e in entries:
        store.add_forgotten(e)

    # what to remove: the labels that fed the print (step 2), the labels the records attribute (step 3)
    targets = {}
    for _, p in hits:
        for s in p.get("sources") or []:
            if s.get("audio") and s.get("diarization") and s.get("label"):
                targets.setdefault(s["audio"], {}).setdefault(s["diarization"], set()).add(s["label"])
    records, mine, proposals, provisional, prov_records = [], {}, 0, 0, 0
    for row in rows:
        path = row["record_path"]
        fm, body = read(path)
        audio = identify.audio_of(row, fm, audio_key)
        did, pid, cur, old = attributed(fm, ref, name)
        for m in row.get("matches") or []:
            if m.get("where") == "previous_speakers":
                if m.get("label") and not str(m["label"]).startswith("earlier:") and m.get("diarization_id"):
                    old.add(m["label"])
                if m.get("new_label"):
                    cur.add(m["new_label"])
            elif m.get("label"):
                cur.add(m["label"])
        if audio:
            if did and cur:
                targets.setdefault(audio, {}).setdefault(did, set()).update(cur)
            if pid and old:
                targets.setdefault(audio, {}).setdefault(pid, set()).update(old)
            mine.setdefault(audio, {"keep": set(), "records": set()})
            mine[audio]["keep"] |= {x for x in (did, pid) if x}
            mine[audio]["records"].add((ws, row.get("record")))
        fm2, n_prop, n_marked, n_prov = scrub(fm, ref, name, stamp)
        proposals += n_prop
        provisional += n_prov
        prov_records += 1 if n_prov else 0
        if n_prop or n_marked:
            write(path, fm2, body)
            records.append(row.get("record"))

    # steps 1 to 3 in every model folder
    deleted, windows = 0, set()
    gone_ids = {p["id"] for _, p in hits}
    for mid in folders(store):
        with store.lock(mid):
            for pid in sorted(gone_ids):
                try:
                    os.remove(store.print_path(mid, pid))
                    deleted += 1
                except FileNotFoundError:
                    pass
            for audio, by in sorted(targets.items()):
                for diar, labels in sorted(by.items()):
                    sig = store.read_json(store.signature_path(mid, audio, diar))
                    if sig is None:
                        continue
                    for label in sorted(labels):
                        if any(w.get("vector") for w in _map(_map(sig.get("labels")).get(label)).get("windows") or []):
                            windows.add((audio, diar, label))
                        store.remove_windows(mid, audio, diar, label)
    superseded = _superseded(store, mine)
    reps = replay_all(store, active)

    others = sorted({k.get("workspace") for ka in by_pid.values() for k in ka if k.get("workspace") != ws})
    lines = []
    if hits:
        lines.append(f"Forgot {name}: their voice print is deleted from this computer "
                     f"({len({m for m, _ in hits})} speaker model{_s(len({m for m, _ in hits}))}).")
    else:
        lines.append(f"{name} had no voice print on this computer; their voice is removed from this workspace's "
                     "recordings.")
    lines.append(f"Removed the voice windows of {len(windows)} speaker label{_s(len(windows))} that taught their voice "
                 "print or that this workspace's records attribute to them.")
    if proposals:
        lines.append(f"Removed {proposals} proposal{_s(proposals)} of {name} from the records.")
    if superseded:
        lines.append(f"Deleted {superseded} earlier diarisation{_s(superseded)} of their recordings that nothing uses.")
    if never:
        lines.append(f"{name}'s voice is not kept from now on: confirming their name writes the name and stores no "
                     "voice print.")
    else:
        lines.append(f"Confirmations of {name} made before now never teach a voice print again, in any workspace; "
                     "naming them from now on does.")
    if provisional:
        lines.append(f"{provisional} provisional name{_s(provisional)} written from their voice print remain on "
                     f"{prov_records} record{_s(prov_records)}; `identify --revert --person {ref}` removes them.")
    if others:
        lines.append(f"This person is also known in {len(others)} other workspace{_s(len(others))}; run `prints forget` "
                     "there to remove their voice from its recordings.")
    lines += _notices(reps.values(), ctx)
    return {"person": ref, "never": bool(never), "prints_deleted": deleted, "windows_removed": len(windows),
            "proposals_removed": proposals, "records_changed": records, "other_workspaces": len(others),
            "reply": "\n".join(lines)}


def _superseded(store, mine):
    """Design section 8, "A recording": a diarisation file of one of these recordings that no record of this
    workspace points at any more, that no other record is listed on, and that no print source or negative
    uses, is removed."""
    used = set()
    for mid in folders(store):
        for p in store.prints(mid):
            for s in list(p.get("sources") or []) + list(p.get("negatives") or []):
                used.add((s.get("audio"), s.get("diarization")))
    n = 0
    for audio, info in sorted(mine.items()):
        for mid in folders(store):
            with store.lock(mid):
                for sig in store.signatures_for_audio(mid, audio):
                    diar = _map(sig.get("diarization")).get("id")
                    if not diar or diar in info["keep"] or (audio, diar) in used:
                        continue
                    recs = {(r.get("workspace"), r.get("record")) for r in sig.get("records") or [] if isinstance(r, dict)}
                    if recs and recs <= info["records"]:
                        try:
                            os.remove(store.signature_path(mid, audio, diar))
                            n += 1
                        except FileNotFoundError:
                            pass
    return n


# -- forget-recording ------------------------------------------------------------------------------------------
def forget_recording(store, active, ctx, path, *, read, audio_key=None):
    fm, _ = read(path)
    audio = identify.audio_of(ctx, fm, audio_key)
    if not audio:
        raise Refused("the recording's audio is not known here (no fingerprint, no audio file)")
    ws = ctx.get("workspace")
    users = {}
    for mid in folders(store):
        for p in store.prints(mid):
            if any(s.get("audio") == audio for s in list(p.get("sources") or []) + list(p.get("negatives") or [])):
                users[p["id"]] = p
    files, where = 0, 0
    for mid in folders(store):
        folder = store.signature_dir(mid, audio)
        if not os.path.isdir(folder):
            continue
        with store.lock(mid):
            files += len([n for n in os.listdir(folder) if n.endswith(".json")])
            shutil.rmtree(folder, ignore_errors=True)
            try:
                os.rmdir(os.path.dirname(folder))
            except OSError:
                pass
            where += 1
    reps = replay_all(store, active)
    named, elsewhere = [], 0
    for pid, p in sorted(users.items()):
        k = _known(p, ws)
        if k:
            named.append(name_here(ctx, k.get("person"), [p]) or k.get("name"))
        else:
            elsewhere += 1
    lines = [f"Deleted the voice signatures of {ctx.get('record') or 'this recording'}: {files} diarisation "
             f"file{_s(files)} in {where} speaker model folder{_s(where)}, for every workspace that holds this "
             "recording."]
    if named or elsewhere:
        parts = sorted(set(named))
        if elsewhere:
            parts.append(f"{elsewhere} voice print{_s(elsewhere)} of people known only in other workspaces")
        lines.append("Rebuilt the voice prints that used it: " + ", ".join(parts) + ".")
    lines += _notices(reps.values(), ctx)
    return {"record": ctx.get("record"), "files_deleted": files, "prints_rebuilt": len(users), "reply": "\n".join(lines)}


# -- rebuild ---------------------------------------------------------------------------------------------------
def _aside_id(pin, m):
    sha = str(m.get("sha256") or "unknown")[:8]
    return f"{pin.id}@{sha}" if m.get("sha256") != pin.sha256 else f"{pin.id}@{sha}-d{m.get('dim')}"


def set_aside(store, pin):
    """The active folder's prints and signatures made with another file of the same model id, moved to
    `<id>@<sha256 prefix>` at the same paths. Returns how many files moved."""
    folder = store.model_dir(pin.id)
    if not os.path.isdir(folder):
        return 0
    moved = 0
    with store.lock(pin.id):
        for sub in ("prints", "signatures"):
            for dirpath, _, files in os.walk(os.path.join(folder, sub)):
                for f in sorted(files):
                    if not f.endswith(".json") or f.startswith("."):
                        continue
                    path = os.path.join(dirpath, f)
                    obj = store.read_json(path)
                    m = _map((obj or {}).get("model"))
                    if not m or _same_pin(obj, pin):
                        continue
                    dest = os.path.join(store.model_dir(_aside_id(pin, m)), os.path.relpath(path, folder))
                    store.write_json(dest, obj)
                    os.remove(path)
                    moved += 1
    return moved


def compute_missing(store, pin, ctx, compute, audio_key=None):
    """Every signature a source or a negative of the active folder's prints needs and the folder lacks,
    computed from the records the context hands (`records`) through the signature maker identify and
    evaluate-speakers use, `removed` copied from every sibling file. Returns `(computed, failed, missing)`."""
    missing = set()
    for p in store.prints(pin.id):
        for s in list(p.get("sources") or []) + list(p.get("negatives") or []):
            a, d = s.get("audio"), s.get("diarization")
            if a and d and not os.path.exists(store.signature_path(pin.id, a, d)):
                missing.add((a, d))
    computed, failed = 0, []
    recs = [c for c in ctx.get("records") or [] if isinstance(c, dict)]
    for a, d in sorted(missing):
        if compute is None:
            continue
        rc = next((c for c in recs if c.get("diarization_id") == d and identify.audio_of(c, None, audio_key) == a), None)
        if rc is None:
            continue
        try:
            sig = compute(pin.id, rc, a, sorted(identify._sibling_removed(store, pin.id, a, d)))
            store.write_signature(pin.id, sig, record={"workspace": rc.get("workspace") or ctx.get("workspace"),
                                                       "record": rc.get("record")})
            computed += 1
        except Exception as e:  # the source waits; the reply says why
            failed.append(f"{rc.get('record')}: {e}")
    return computed, failed, len(missing)


def rebuild(store, active, ctx, *, compute=None, audio_key=None):
    ws, pin, th = ctx.get("workspace"), active["pin"], identify._thresholds(active)
    moved = set_aside(store, pin)
    carried = set()
    for mid in folders(store):
        if mid != pin.id and store.prints(mid):
            carried.update(enrol.carry(store, mid, pin))
    computed, failed, missing = compute_missing(store, pin, ctx, compute, audio_key)
    rep = enrol.replay(store, pin, th)
    here = store.prints(pin.id, model=pin)
    people = []
    for p in here:
        for k in p.get("known_as") or []:
            if k.get("workspace") == ws and k.get("person"):
                people.append(_row(p, ctx, k["person"], pin))
    people.sort(key=lambda r: (_norm(r["name"]), r["person"]))
    lines = [f"Rebuilt the voice prints of speaker model {pin.id} from their confirmed recordings."]
    if th is None:
        lines.append("There is no calibration for this model yet: the prints keep their recordings and name nobody "
                     "until one exists.")
    if moved:
        lines.append(f"{moved} file{_s(moved)} made with another file of this model {'were' if moved != 1 else 'was'} "
                     "set aside.")
    if carried:
        lines.append(f"Carried {len(carried)} voice print{_s(len(carried))} from another speaker model.")
    if computed:
        lines.append(f"Computed {computed} voice signature{_s(computed)} for this model from the recordings.")
    for r in people:
        bits = [r["trust"], f"{r['admitted']} of {r['sources']} recording{_s(r['sources'])} teaching it"]
        if r["waiting"]:
            bits.append(f"{r['waiting']} waiting")
        lines.append(f"- {r['name']} — " + ", ".join(bits))
    waiting = len((rep or {}).get("waiting") or [])
    if waiting:
        lines.append(f"{waiting} confirmed recording{_s(waiting)} wait for their voice signature under this model; they "
                     "are kept and judged once it is computed (`prints rebuild` in the workspace that holds them, or "
                     "`identify` on them).")
    if failed:
        lines.append(f"{len(failed)} signature{_s(len(failed))} could not be computed: " + "; ".join(failed[:5]))
    dropped_here = [d for d in rep.get("dropped") or [] if d.get("workspace") == ws]
    dropped_else = len(rep.get("dropped") or []) - len(dropped_here)
    for d in dropped_here:
        lines.append(f"Dropped a recording of {identify.person_name(ctx, d.get('person')) or d.get('person')}: {d.get('why')}.")
    if dropped_else:
        lines.append(f"Dropped {dropped_else} recording{_s(dropped_else)} of people known only in other workspaces.")
    lines += _notices([rep], ctx)
    lines += [x for x in _stuck_lines(store, pin, ctx, rep) if x not in lines]
    return {"model": pin.id, "people": people, "carried": len(carried), "computed": computed, "missing": missing,
            "waiting": waiting, "reply": "\n".join(lines)}


# -- link and reseed -------------------------------------------------------------------------------------------
def _merge_into(target, mine):
    """`mine`'s people, sources and negatives added to `target`. A joining `known_as` entry carries no `since`
    (ruling D21): the user said they are one person, so its recordings count from the start."""
    for k in mine.get("known_as") or []:
        if not _known(target, k.get("workspace"), k.get("person")):
            target.setdefault("known_as", []).append(
                {"workspace": k.get("workspace"), "person": k.get("person"), "name": k.get("name") or ""})
    have = {(enrol._ref_key(s), s.get("workspace"), s.get("person")) for s in target.get("sources") or []}
    for s in mine.get("sources") or []:
        if (enrol._ref_key(s), s.get("workspace"), s.get("person")) not in have:
            target.setdefault("sources", []).append(copy.deepcopy(s))
    for n in mine.get("negatives") or []:
        if not any(enrol._ref_key(m) == enrol._ref_key(n) for m in target.get("negatives") or []):
            target.setdefault("negatives", []).append(enrol._ref(n))
    return target


def _mine(store, pin, ws, ref, model=None):
    for p in store.prints(pin.id, model=model):
        if _known(p, ws, ref):
            return p
    return None


def link(store, active, ctx, ref):
    ws, pin, th = ctx.get("workspace"), active["pin"], identify._thresholds(active)
    name = name_here(ctx, ref) or ref
    if th is None:
        raise Refused("there is no calibration for the active speaker model: nothing can be judged alike; nothing joined")
    prints = store.prints(pin.id, model=pin)
    mine = next((p for p in prints if _known(p, ws, ref)), None)
    if mine is None:
        raise Refused(f"{name} has no voice print here; nothing joined")
    if not mine.get("vector"):
        raise Refused(f"{name}'s voice print has no recording teaching it yet; nothing joined")
    cands = sorted(((vec.cos(mine["vector"], q["vector"]), q["id"], q) for q in prints
                    if q is not mine and q.get("vector") and not _known(q, ws)), key=lambda c: (-c[0], c[1]))
    if not cands or cands[0][0] < th["suggest"]:
        raise Refused(f"no voice print from another workspace resembles {name}'s; nothing joined")
    if len(cands) > 1 and cands[1][0] >= th["suggest"] and cands[0][0] - cands[1][0] < th["margin"]:
        raise Refused(f"more than one voice print from other workspaces resembles {name}'s; nothing joined")
    score, tid = cands[0][0], cands[0][1]
    for mid in folders(store):
        with store.lock(mid):
            m = store.read_json(store.print_path(mid, mine["id"]))
            if m is None:
                continue
            t = store.read_json(store.print_path(mid, tid))
            if t is None:      # another model folder holds only this workspace's copy: it takes the joined id
                t = dict(copy.deepcopy(m), id=tid, known_as=copy.deepcopy(cands[0][2].get("known_as") or []),
                         sources=[], negatives=[], vector=None)
            store.write_print(mid, _merge_into(t, m))
            os.remove(store.print_path(mid, mine["id"]))
    rep = enrol.replay(store, pin, th)
    joined = store.read_json(store.print_path(pin.id, tid)) or {}
    lines = [f"Joined {name}'s voice print with the voice print from another workspace it resembles (score "
             f"{score:.2f}): one person from now on, {joined.get('trust', 'proposing')}. Nothing from the other "
             "workspace is named here."]
    lines += _notices([rep], ctx)
    return {"person": ref, "joined": True, "trust": joined.get("trust"), "reply": "\n".join(lines)}


def reseed(store, active, ctx, ref, stamp):
    pin, th = active["pin"], identify._thresholds(active)
    p = _mine(store, pin, ctx.get("workspace"), ref, model=pin)
    name = name_here(ctx, ref, [p] if p else []) or ref
    if p is None:
        raise Refused(f"{name} has no voice print here; nothing to start again")
    try:
        enrol.reseed(store, pin, th, p["id"], stamp)
    except ValueError as e:
        raise Refused(str(e)) from None
    q = store.read_json(store.print_path(pin.id, p["id"])) or {}
    return {"person": ref, "trust": q.get("trust"),
            "reply": f"Started {name}'s voice print again: their first recording is kept aside and the print learns "
                     f"from the recordings confirmed after it ({q.get('trust', 'proposing')} now)."}


# -- the verb --------------------------------------------------------------------------------------------------
_REFUSALS = identify._REFUSALS


def main(args, *, skill_dir=None, read=None, write=None, store=None, active=None, compute=None, audio_key=None,
         out=print, now=None):
    """`prints …` (args[0] is the verb). Prints one JSON object. Returns 0, 1 (refused: no print here, nothing
    resembles, the store or model refused) or 2 (usage)."""
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
        unknown = [x for x in a if x.startswith("--")]
        if unknown:
            raise Usage(f"prints does not know {unknown[0]}")
        if not a or a[0] not in SUBS:
            raise Usage(f"prints needs one of {', '.join(SUBS)}")
        sub, rest = a[0], a[1:]
        if sub in ONE_ARG and len(rest) != 1:
            raise Usage(f"prints {sub} {ONE_ARG[sub]}")
        if sub not in ONE_ARG and rest:
            raise Usage(f"prints {sub} takes no argument")
        if ctx_path is None:
            raise Usage("no --context: run it through the module's entry (`transcribe.mjs prints …`)")
        with open(ctx_path, encoding="utf-8") as f:
            ctx = json.load(f)
        if not isinstance(ctx, dict):
            raise Usage("the voice context is not an object")
        if store is None:
            store = vp_store.Store(vp_store.default_home(), guard=ctx.get("guard") or {})
        store.ensure()
        if active is None:
            active = identify.resolve_active(skill_dir, store)
        stamp = clock()
        if sub == "list":
            result = do_list(store, active, ctx)
        elif sub == "rebuild":
            result = rebuild(store, active, ctx, compute=compute, audio_key=audio_key)
        elif sub in ("forget", "never"):
            result = forget(store, active, ctx, rest[0], stamp, read=read, write=write, never=(sub == "never"),
                            audio_key=audio_key)
        elif sub == "forget-recording":
            c = identify._ctx_for(ctx, rest[0]) if (ctx.get("record_path") or ctx.get("records")) else ctx
            result = forget_recording(store, active, c, rest[0], read=read, audio_key=audio_key)
        elif sub == "link":
            result = link(store, active, ctx, rest[0])
        else:
            result = reseed(store, active, ctx, rest[0], stamp)
        out(json.dumps(result, ensure_ascii=False))
        return 0
    except (Usage, identify.Usage) as e:
        out(f"✖ {e}\n  usage: {USAGE}")
        return 2
    except Refused as e:
        out(f"✖ {e}")
        return 1
    except _REFUSALS as e:
        out(f"✖ {e}")
        return 1
