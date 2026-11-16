"""The `prints` verbs (cr-modules-019 task 10): list, forget, forget-recording, never, link, rebuild, reseed —
design sections 8 and 9, one class per acceptance line the task carries (each docstring quotes its line of
cr-modules-019), plus the five findings earlier reviews carried into this task:

- `sticky-forgotten-overrides-later-confirmation` (task 4, round 2): a confirmation made after the forget's
  `at` lifts the forgotten mark (design section 8 step 4: they enrol again);
- `earlier-key-drops-its-label` (task 4, round 2): an `earlier:<key>` entry keeps the label of the earlier
  diarisation it sat on, so forget reaches its windows;
- `rebuild-before-new-model-signatures-drops-sources` (task 5): a rebuild after a model change never drops a
  source whose signature the new model has not computed yet;
- `fast-path-blind-to-signature-files` and `digest-reads-never-and-forgotten-after-the-pass` (task 5, round
  2): a live answer judges only what is new only when the signature files and never/forgotten are as the
  last pass read them.

And the five findings of this task's review round 1: `forgotten-label-computed-again` (Line24: a signature
computed after the forget gives none of the person's labels windows), `confirm-racing-forget-keeps-its-windows`
(ForgetHoldsTheStore), `non-active-folder-loses-vectors-silently` (PrintsWaitingForRebuild),
`rebuild-line-lost-once-confirmed-under-new-model` (RebuildLineStays) and
`never-removes-namesake-print-elsewhere-silently` (Line25: never counts what it removed elsewhere).

Standard library only, so a bare python3 runs it (vp-prints.test.mjs). Every voice is synthetic and made at
run time by vp_synth.py, a distinct seed per voice and per source (ruling D13); every store is a temp folder
with a fake `exclude_backup` (ruling D14); records are written by vp_records (JSON frontmatter). The harness
is task 9's (`test_vp_identify.Harness`), imported, never edited.
"""
from __future__ import annotations

import contextlib
import copy
import io
import json
import os
import re
import subprocess
import sys
import threading
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
SKILL = HERE.parents[1] / "skills" / "transcribing-recordings"
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(SKILL))

import test_vp_identify as tvi  # noqa: E402
import vp_synth  # noqa: E402
from voiceprints import carry, enrol, identify, store  # noqa: E402

try:  # the module this task writes; a missing one fails each test below rather than the whole file
    from voiceprints import prints
except ImportError:  # pragma: no cover - red before the implementation
    prints = None

TH, MODEL, CALIB, ACTIVE, WS = tvi.TH, tvi.MODEL, tvi.CALIB, tvi.ACTIVE, tvi.WS
WS_B = "harbor-hq"
DANA_REF, SAM_REF, PRIYA_REF, TOM_REF = tvi.DANA_REF, tvi.SAM_REF, tvi.PRIYA_REF, tvi.TOM_REF
NAMES = tvi.NAMES
DANA, SAM, PRIYA, TOM, STRANGER = tvi.DANA, tvi.SAM, tvi.PRIYA, tvi.TOM, tvi.STRANGER
lab = tvi.lab

MODEL_B = store.Model("eres2netv2-test", "e" * 64, 64)
ACTIVE_B = {"model": MODEL_B.id, "pin": MODEL_B, "calib": dict(CALIB, model=MODEL_B.id), "source": "shipped"}
MODEL_D = store.Model(MODEL.id, "d" * 64, 64)          # the same id, another file
ACTIVE_D = {"model": MODEL_D.id, "pin": MODEL_D, "calib": CALIB, "source": "shipped"}
EARLY = "2026-11-20T08:00:00+02:00"                    # earlier the same day than any forget below

NUM = r"-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?"


def longest_number_array(text, diff=False):
    """The longest array of numbers in `text`: a JSON/flow list `[n, n, ...]` (also across lines) or a YAML
    block of `- n` lines. With `diff`, each line's diff marker is dropped first (`git log -p`)."""
    if diff:
        text = "\n".join(line[1:] if line[:1] in "+- " else line for line in text.splitlines())
    best = 0
    for m in re.finditer(r"\[([^\[\]]*)\]", text):
        parts = [p.strip() for p in m.group(1).split(",")]
        if parts and all(re.fullmatch(NUM, p) for p in parts):
            best = max(best, len(parts))
    run = 0
    for line in text.splitlines():
        if re.fullmatch(r"\s*-\s+" + NUM + r"\s*", line):
            run += 1
            best = max(best, run)
        else:
            run = 0
    return best


class Harness(tvi.Harness):
    """Task 9's harness plus the `prints` verb, a second workspace, and a stand-in for the signature maker
    that embeds a recording again for another model from the same synthetic voices."""

    def setUp(self):
        super().setUp()
        self.specs = {}
        self.train = []          # record contexts of the training recordings `teach` made

    # -- recordings (every signature remembered, so another model can "embed" it again) ------------------
    def signature(self, name, spec, hint=2, fallback=None, model=MODEL):
        sig = super().signature(name, spec, hint=hint, fallback=fallback, model=model)
        self.specs[sig["audio"]] = (name, copy.deepcopy(spec), hint, fallback)
        return sig

    def teach(self, ref, voice, times=2, seconds=120.0, model=MODEL, tag=""):
        super().teach(ref, voice, times=times, seconds=seconds, model=model, tag=tag)
        for i in range(times):
            nm = f"train-{ref}-{tag}{i}"
            self.train.append({"workspace": WS, "record": f"meeting-recordings/{nm}", "record_path": None,
                               "fingerprint": "sha256:" + tvi.audio_of(nm), "diarization_id": tvi.diar_of(nm)})

    def teach_in(self, ws, ref, name, voice, times=2, tag="b", model=MODEL, start=5):
        """Confirmed training recordings of `voice` in workspace `ws` as `ref` named `name`."""
        reps = []
        for i in range(times):
            nm = f"train-{ws}-{ref}-{tag}{i}"
            sig = self.signature(nm, {"speaker_0": lab(voice, f"{nm}:v"),
                                      "speaker_1": lab(vp_synth.voice(f"filler:{nm}", dim=len(voice)), f"{nm}:f")},
                                 model=model)
            self.store.write_signature(model.id, sig, record={"workspace": ws, "record": f"meeting-recordings/{nm}"})
            reps.append(enrol.confirm(self.store, model, TH, [{
                "audio": sig["audio"], "diarization": sig["diarization"]["id"], "label": "speaker_0",
                "workspace": ws, "person": ref, "name": name, "confirmed": f"2026-11-{start + i:02d}T09:00:00+02:00"}]))
        return reps

    def compute_for(self, pin):
        """The signature maker's stand-in: the same synthetic windows, pinned to `pin`, `removed` kept out."""
        calls = []

        def compute(model_id, rctx, audio, removed=()):
            calls.append((model_id, audio))
            name, spec, hint, fallback = self.specs[audio]
            sig = tvi.Harness.signature(self, name, spec, hint=hint, fallback=fallback, model=pin)
            sig["diarization"]["id"] = (rctx or {}).get("diarization_id") or sig["diarization"]["id"]
            for label in removed or ():
                if label in sig["labels"]:
                    sig["labels"][label]["windows"] = []
            sig["removed"] = sorted(set(removed or ()))
            return sig
        compute.calls = calls
        return compute

    def sig_at(self, audio, diar, spec, model=MODEL, records=()):
        """A signature file of `audio` under diarisation `diar` (another diarisation of a recording)."""
        sig = tvi.Harness.signature(self, f"other:{audio}:{diar}", spec, model=model)
        sig["audio"], sig["diarization"]["id"] = audio, diar
        for r in records:
            sig = self.store.write_signature(model.id, sig, record=r)
        return sig

    # -- the store, read back ---------------------------------------------------------------------------
    def sig(self, audio, diar, model=MODEL):
        return self.store.read_json(self.store.signature_path(model.id, audio, diar))

    def wins(self, audio, diar, label, model=MODEL):
        s = self.sig(audio, diar, model) or {}
        return len(((s.get("labels") or {}).get(label) or {}).get("windows") or [])

    def removed(self, audio, diar, model=MODEL):
        return sorted((self.sig(audio, diar, model) or {}).get("removed") or [])

    def prints_known(self, ws, ref, model=MODEL):
        return [p for p in self.store.prints(model.id)
                if any(k.get("workspace") == ws and k.get("person") == ref for k in p.get("known_as") or [])]

    def print_of(self, ref, model=MODEL, ws=WS):
        ps = self.prints_known(ws, ref, model)
        return ps[0] if ps else None

    def all_prints_of(self, ws, ref):
        out = []
        for d in sorted(os.listdir(self.store.home)):
            if os.path.isdir(os.path.join(self.store.home, d, "prints")):
                out += self.prints_known(ws, ref, store.Model(d, "", 0))
        return out

    # -- contexts -----------------------------------------------------------------------------------------
    def base(self, ws=WS, known=None):
        b = copy.deepcopy(tvi.BASE)
        b["workspace"] = ws
        if known is not None:
            b["known"] = dict(known)
            b["workspace_users"] = [{"person": r, "name": n} for r, n in known.items() if r.startswith("users/")]
        return b

    def rows(self, recs, ref, name):
        """`personRecords` (lib/voice-context.mjs), read the same way from the records."""
        out = []
        for r in recs:
            fm = self.records.fm(r.path)
            t = fm.get("transcription") or {}
            did = t.get("diarization_id")
            matches = []
            srcs = t.get("speaker_sources") or {}
            for label, n in (t.get("speakers") or {}).items():
                src = srcs.get(label)
                if src and src.get("person"):
                    if src["person"] == ref:
                        matches.append({"label": label, "where": "speaker_sources", "diarization_id": did})
                elif name and n == name:
                    matches.append({"label": label, "where": "speakers", "diarization_id": did})
            for label, src in srcs.items():
                if (src or {}).get("person") == ref and not any(m["label"] == label for m in matches):
                    matches.append({"label": label, "where": "speaker_sources", "diarization_id": did})
            prev = t.get("previous_speakers") or {}
            for key, e in (prev.get("labels") or {}).items():
                p = (e.get("source") or {}).get("person")
                if (p == ref) if p else (bool(name) and e.get("name") == name):
                    matches.append({"label": e.get("label") or key, "where": "previous_speakers",
                                    "diarization_id": prev.get("diarization_id"), "new_label": e.get("new_label")})
            for label, q in (t.get("speaker_questions") or {}).items():
                p = (q or {}).get("proposed")
                if p and ((p.get("person") == ref) if p.get("person") else (bool(name) and p.get("name") == name)):
                    matches.append({"label": label, "where": "speaker_questions", "diarization_id": did})
            if matches:
                out.append({"record": r.ref, "record_path": r.path, "audio": None, "fingerprint": fm.get("fingerprint"),
                            "diarization_id": did, "matches": matches})
        return out

    def person_ctx(self, ref, recs=(), ws=WS, known=None):
        b = self.base(ws, known)
        name = b["known"].get(ref)
        return dict(b, person={"ref": ref, "name": name}, person_records=self.rows(recs, ref, name))

    def records_ctx(self, ctxs, ws=WS):
        return dict(self.base(ws), records=[dict(c) for c in ctxs])

    # -- the verb -----------------------------------------------------------------------------------------
    def pcli(self, *args, ctx=None, active=ACTIVE, compute=None, store_=None):
        self.assertIsNotNone(prints, "voiceprints/prints.py does not exist yet")
        ctx = ctx if ctx is not None else self.base()
        cf = self.root / f"pctx-{self.tick}-{len(self.records.writes)}-{args[0] if args else 'x'}.json"
        cf.write_text(json.dumps(ctx), encoding="utf-8")
        outs = []
        code = prints.main(["prints", *args, "--context", str(cf)], skill_dir=None, read=self.records.read,
                           write=self.records.write, store=store_ if store_ is not None else self.store,
                           active=active, compute=compute, out=outs.append, now=self.now)
        parsed = []
        for o in outs:
            try:
                parsed.append(json.loads(o))
            except ValueError:
                parsed.append(o)
        self.pouts = parsed
        return code, parsed

    def p(self, *args, **kw):
        code, outs = self.pcli(*args, **kw)
        self.assertEqual(code, 0, outs)
        self.assertEqual(len(outs), 1, outs)
        return outs[0]

    def forget(self, ref, recs=(), ws=WS, verb="forget", known=None, **kw):
        return self.p(verb, ref, ctx=self.person_ctx(ref, recs, ws, known), **kw)

    def answered(self, rec, label, ref, active=ACTIVE):
        """A person names `label` as `ref` the way the end-of-run question takes it."""
        code, outs = self.cli("--answer", rec.path, f"{label}={ref}", recs=[rec], active=active)
        self.assertEqual(code, 0, outs)
        return outs[0]


# ======================================================================================================
# acceptance lines

class Line11(Harness):
    """A voice print made with one speaker model is refused when another model is active and the message names
    the command that rebuilds it"""

    def test_after_a_model_change_identify_does_not_use_the_old_print_and_names_prints_rebuild(self):
        self.teach(DANA_REF, DANA)
        rec = self.two("l11-new-model", model=MODEL_B)
        code, outs = self.cli(rec.path, recs=[rec], active=ACTIVE_B)
        self.assertEqual(code, 0, outs)
        r = outs[0]["records"][0]
        self.assertNotIn("speaker_0", self.t(rec)["speakers"])
        self.assertTrue(any("prints rebuild" in x and "another speaker model" in x for x in r["lines"]), r["lines"])

    def test_the_same_model_id_made_from_another_file_is_refused_naming_prints_rebuild(self):
        self.teach(DANA_REF, DANA)
        rec = self.two("l11-new-file")
        code, outs = self.cli(rec.path, recs=[rec], active=ACTIVE_D)
        self.assertEqual(code, 1, outs)
        self.assertIn("prints rebuild", outs[0])

    def test_prints_rebuild_then_makes_it(self):
        self.teach(DANA_REF, DANA)
        rec = self.two("l11-rebuilt", model=MODEL_B)
        out = self.p("rebuild", ctx=self.records_ctx(self.train), active=ACTIVE_B, compute=self.compute_for(MODEL_B))
        p = self.print_of(DANA_REF, model=MODEL_B)
        self.assertIsNotNone(p, out)
        self.assertEqual((p["trust"], p["model"]["id"]), ("trusted", MODEL_B.id))
        self.assertIn("Dana Oren", out["reply"])
        self.identify(rec, active=ACTIVE_B)
        self.assertEqual(self.t(rec)["speakers"].get("speaker_0"), "Dana Oren")

    def test_prints_rebuild_then_makes_it_for_the_same_model_id_from_another_file(self):
        self.teach(DANA_REF, DANA)
        rec = self.two("l11-refile")
        self.p("rebuild", ctx=self.records_ctx(self.train), active=ACTIVE_D, compute=self.compute_for(MODEL_D))
        p = self.print_of(DANA_REF, model=MODEL_D)
        self.assertEqual((p["trust"], p["model"]["sha256"]), ("trusted", MODEL_D.sha256))
        self.store.prints(MODEL_D.id, model=MODEL_D)      # nothing of the old file is left in the folder
        self.identify(rec, active=ACTIVE_D, compute=self.compute_for(MODEL_D))
        self.assertEqual(self.t(rec)["speakers"].get("speaker_0"), "Dana Oren")


class Line12(Harness):
    """After a person's voice print is forgotten the next run leaves that person unnamed and no file in any
    workspace or its git history holds a voice vector"""

    def test_after_forget_the_next_identify_leaves_the_person_unnamed_also_after_prints_rebuild(self):
        self.teach(DANA_REF, DANA)
        self.teach(SAM_REF, SAM)
        rec = self.two("l12-before")
        self.identify(rec)
        self.assertEqual(self.t(rec)["speakers"].get("speaker_0"), "Dana Oren")
        out = self.forget(DANA_REF, [rec])
        self.assertIn(f"identify --revert --person {DANA_REF}", out["reply"])
        nxt = self.two("l12-after")
        self.identify(nxt)
        self.assertNotIn("Dana Oren", self.t(nxt)["speakers"].values())
        self.assertEqual(self.t(nxt)["speakers"].get("speaker_1"), "Sam Diaz")
        self.p("rebuild", ctx=self.records_ctx(self.train))
        again = self.two("l12-after-rebuild")
        self.identify(again)
        self.assertNotIn("Dana Oren", self.t(again)["speakers"].values())
        code, _ = self.cli("--revert", "--person", DANA_REF, ctx=self.person_ctx(DANA_REF, [rec]))
        self.assertEqual(code, 0)
        self.identify(rec)
        self.assertNotIn("Dana Oren", self.t(rec)["speakers"].values())

    def test_the_detector_sees_a_vector(self):
        v = vp_synth.voice("l12-control", dim=128)
        self.assertEqual(longest_number_array(json.dumps({"vector": v}, separators=(",", ":"))), 128)
        pretty = "\n".join("+" + line for line in json.dumps({"vector": v}, indent=2).splitlines())
        self.assertEqual(longest_number_array(pretty, diff=True), 128)
        self.assertEqual(longest_number_array("vector:\n" + "\n".join(f"  - {x}" for x in v)), 128)
        self.assertEqual(longest_number_array('{"score": 0.91, "margin": 0.2, "at": "01:02"}'), 0)

    def git(self, *args):
        r = subprocess.run(["git", "-c", "user.name=Northwind Test", "-c", "user.email=test@northwind.example",
                            "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", *args],
                           cwd=str(self.ws), capture_output=True, text=True,
                           env=dict(os.environ, GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull))
        self.assertEqual(r.returncode, 0, r.stderr)
        return r.stdout

    def commit(self, msg):
        self.git("add", "-A")
        self.git("commit", "-q", "--allow-empty", "-m", msg)

    def test_no_file_or_git_history_of_the_workspace_holds_a_voice_vector(self):
        wide = store.Model("campp-wide-test", "a" * 64, 128)
        active = {"model": wide.id, "pin": wide, "calib": dict(CALIB, model=wide.id), "source": "shipped"}
        dana, sam = vp_synth.voice("l12-dana", dim=128), vp_synth.voice("l12-sam", dim=128)
        self.ws.mkdir(parents=True, exist_ok=True)
        self.git("init", "-q")
        self.teach_in(WS, DANA_REF, "Dana Oren", dana, tag="w", model=wide, start=1)
        self.teach_in(WS, SAM_REF, "Sam Diaz", sam, tag="w", model=wide, start=3)
        recs = [self.make(f"l12-git-{i}", {"speaker_0": lab(dana, f"l12g{i}:d"), "speaker_1": lab(sam, f"l12g{i}:s")},
                          model=wide) for i in range(2)]
        self.commit("transcribed")
        self.identify(recs[0], active=active)
        self.commit("identified")
        self.cli("--shown", recs[0].path, recs=[recs[0]], active=active)
        code, outs = self.cli("--answer", recs[0].path, "speaker_0=correct", "speaker_1=correct", recs=[recs[0]],
                              active=active)
        self.assertEqual(code, 0, outs)
        self.assertIn("confirmed", outs[0]["reply"])
        self.identify(recs[1], active=active)
        self.commit("confirmed")
        self.forget(DANA_REF, recs, active=active)
        self.commit("forgotten")
        nxt = self.make("l12-git-next", {"speaker_0": lab(dana, "l12gn:d"), "speaker_1": lab(sam, "l12gn:s")}, model=wide)
        self.identify(nxt, active=active)
        self.assertNotIn("Dana Oren", self.t(nxt)["speakers"].values())
        self.commit("next run")
        # the detector does see the vectors the store keeps (Sam's print is still there), so its silence counts
        kept = [p for p in Path(self.store.home).rglob("*.json") if "prints" in p.parts]
        self.assertTrue(kept and max(longest_number_array(p.read_text(encoding="utf-8")) for p in kept) > 64)
        for f in self.ws.rglob("*"):
            if f.is_file() and ".git" not in f.parts:
                self.assertLessEqual(longest_number_array(f.read_text(encoding="utf-8")), 64, f)
        history = self.git("log", "-p", "--all")
        self.assertIn("speaker_sources", history)                # the history is the records' own
        self.assertLessEqual(longest_number_array(history, diff=True), 64)


class Line14(Harness):
    """The same recording imported into two workspaces of one user is kept once in that user's store — one set
    of voice signatures per way it was diarised — and deleting that recording's signatures removes them for
    both"""

    def in_b(self, rec, diar=None):
        """The same audio as a record of workspace B (its own file), diarised `diar` (default: the same)."""
        fm, body = self.records.read(rec.path)
        if diar:
            fm["transcription"]["diarization_id"] = diar
        path = str(self.root / "ws-b" / "data" / "meeting-recordings" / Path(rec.path).name)
        self.records.write(path, fm, body)
        ctx = dict(copy.deepcopy(rec.ctx), workspace=WS_B, record_path=path, diarization_id=diar or rec.diar)
        return tvi.Rec(rec.name + "-b", path, rec.ref, ctx, rec.audio, diar or rec.diar, None)

    def test_one_audio_in_two_workspaces_is_one_file_listing_both_records(self):
        rec = self.two("l14-once")
        b = self.in_b(rec)
        self.store.write_signature(MODEL.id, rec.sig, record={"workspace": WS_B, "record": b.ref})
        files = list(Path(self.store.signature_dir(MODEL.id, rec.audio)).glob("*.json"))
        self.assertEqual(len(files), 1)
        self.assertEqual(sorted(r["workspace"] for r in self.sig(rec.audio, rec.diar)["records"]), sorted([WS, WS_B]))

    def test_forget_recording_removes_it_for_both_workspaces_and_every_model(self):
        self.teach(DANA_REF, DANA)
        rec = self.two("l14-forget")
        b = self.in_b(rec)
        self.store.write_signature(MODEL.id, rec.sig, record={"workspace": WS_B, "record": b.ref})
        self.store.write_signature(MODEL_B.id, self.compute_for(MODEL_B)(MODEL_B.id, rec.ctx, rec.audio),
                                   record={"workspace": WS, "record": rec.ref})
        self.identify(rec)
        self.cli("--shown", rec.path, recs=[rec])
        self.answered(rec, "speaker_0", "correct")
        self.assertEqual(len(self.print_of(DANA_REF)["sources"]), 3)
        out = self.p("forget-recording", rec.path, ctx=rec.ctx)
        for m in (MODEL, MODEL_B):
            self.assertFalse(os.path.exists(self.store.signature_dir(m.id, rec.audio)), m.id)
        self.assertEqual(len(self.print_of(DANA_REF)["sources"]), 2)     # the print that used it is rebuilt
        self.assertIn("Dana Oren", out["reply"])
        code, outs = self.cli(b.path, recs=[b])                          # workspace B's record: gone there too
        self.assertEqual(code, 1, outs)
        self.assertIn(identify.NO_SIGNATURE, outs[0]["records"][0]["error"])

    def test_diarised_differently_it_is_two_files_and_each_record_reads_its_own(self):
        self.teach(DANA_REF, DANA)
        rec = self.two("l14-two-ways")                                   # speaker_0 is Dana here
        other = "0d1ffe2e2e2e"
        self.sig_at(rec.audio, other, {"speaker_0": lab(SAM, "l14-other-s"), "speaker_1": lab(DANA, "l14-other-d")},
                    records=[{"workspace": WS_B, "record": rec.ref}])
        b = self.in_b(rec, diar=other)
        self.teach_in(WS_B, DANA_REF, "Dana Oren", DANA, tag="l14")     # B knows Dana (recognised)
        self.assertEqual(len(list(Path(self.store.signature_dir(MODEL.id, rec.audio)).glob("*.json"))), 2)
        self.identify(rec)
        self.identify(b)
        self.assertEqual(self.t(rec)["speakers"].get("speaker_0"), "Dana Oren")
        self.assertEqual(self.t(b)["speakers"].get("speaker_1"), "Dana Oren")
        self.assertNotIn("speaker_0", self.t(b)["speakers"])
        self.p("forget-recording", b.path, ctx=b.ctx)
        self.assertFalse(os.path.exists(self.store.signature_dir(MODEL.id, rec.audio)))


class Line24(Harness):
    """After `prints forget <person>` the user's store holds no voice print of that person and no voice windows
    for any speaker label that fed their print or that this workspace's records attribute to them — by a name,
    an earlier name or a proposal — and no later `prints rebuild`, in this or another of the user's workspaces,
    makes their voice print again from confirmations made before the forget"""

    def setUp(self):
        super().setUp()
        self.teach(DANA_REF, DANA)
        # the same print in a second model folder, built there the real way
        mk = self.compute_for(MODEL_B)
        for c in self.train:
            self.store.write_signature(MODEL_B.id, mk(MODEL_B.id, c, c["fingerprint"][7:]),
                                       record={"workspace": WS, "record": c["record"]})
        enrol.carry(self.store, MODEL.id, MODEL_B)
        enrol.replay(self.store, MODEL_B, TH)
        self.assertEqual(self.print_of(DANA_REF, model=MODEL_B)["trust"], "trusted")
        # a name: identify writes Dana on speaker_0
        self.named = self.two("l24-named", b=STRANGER)
        self.identify(self.named)
        # earlier names: on the earlier diarisation's speaker_1, and an `earlier:` entry that sat on its speaker_0
        self.prev = "d0e1a2b3c4d5"
        self.earlier = self.two("l24-earlier", a=PRIYA, b=DANA, prev={
            "diarization_id": self.prev, "labels": {
                "speaker_1": {"name": "Dana Oren", "source": {"name": "Dana Oren", "person": DANA_REF, "origin": "hand",
                                                              "status": "confirmed", "named": "2026-10-01T10:00:00+02:00"},
                              "new_label": "speaker_1", "share": 1.0, "offered": True},
                "earlier:speaker_3": {"name": "Dana Oren", "label": "speaker_0", "new_label": "speaker_1", "share": 0.4,
                                      "offered": False}}})
        self.sig_at(self.earlier.audio, self.prev, {"speaker_0": lab(DANA, "l24-p0"), "speaker_1": lab(DANA, "l24-p1"),
                                                    "speaker_2": lab(PRIYA, "l24-p2")},
                    records=[{"workspace": WS, "record": self.earlier.ref}])
        # an open proposal of Dana on speaker_0
        self.proposed = self.two("l24-proposed", a=TOM, b=SAM)
        fm, body = self.records.read(self.proposed.path)
        fm["transcription"]["speaker_questions"] = {"speaker_0": {"quotes": [], "flags": [], "proposed": {
            "person": DANA_REF, "name": "Dana Oren", "origin": "attendees", "why": "the only attendee left"}}}
        self.records.write(self.proposed.path, fm, body)
        self.recs = [self.named, self.earlier, self.proposed]

    def test_no_print_and_no_windows_for_any_label_that_fed_it_or_that_a_record_attributes_to_them(self):
        p = self.print_of(DANA_REF)
        sources = [(s["audio"], s["diarization"], s["label"]) for s in p["sources"]]
        out = self.forget(DANA_REF, self.recs)
        self.assertEqual(self.all_prints_of(WS, DANA_REF), [])
        for audio, diar, label in sources:                       # the labels that fed the print, every model
            for m in (MODEL, MODEL_B):
                self.assertEqual(self.wins(audio, diar, label, m), 0, (m.id, label))
                self.assertIn(label, self.removed(audio, diar, m))
                self.assertGreater(self.wins(audio, diar, "speaker_1", m), 0)     # the other speaker stays
        n, e, q = self.named, self.earlier, self.proposed
        self.assertEqual((self.wins(n.audio, n.diar, "speaker_0"), self.removed(n.audio, n.diar)), (0, ["speaker_0"]))
        self.assertGreater(self.wins(n.audio, n.diar, "speaker_1"), 0)
        self.assertEqual(self.removed(e.audio, self.prev), ["speaker_0", "speaker_1"])     # earlier names
        self.assertGreater(self.wins(e.audio, self.prev, "speaker_2"), 0)
        self.assertEqual(self.removed(e.audio, e.diar), ["speaker_1"])                       # the label they went to
        self.assertGreater(self.wins(e.audio, e.diar, "speaker_0"), 0)
        self.assertEqual(self.removed(q.audio, q.diar), ["speaker_0"])                       # a proposal
        self.assertNotIn("proposed", self.t(q)["speaker_questions"]["speaker_0"])
        entries = self.store.forgotten()
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["print"], p["id"])
        self.assertEqual(entries[0]["known_as"], p["known_as"])
        store.parse_instant(entries[0]["at"])
        self.assertIn("voice print", out["reply"])

    def test_an_unreferenced_superseded_diarisation_of_their_recording_goes_too(self):
        n = self.named
        old = "0a0b0c0d0e0f"
        self.sig_at(n.audio, old, {"speaker_0": lab(DANA, "l24-old-d"), "speaker_1": lab(STRANGER, "l24-old-s")},
                    records=[{"workspace": WS, "record": n.ref}])
        shared = "0f0e0d0c0b0a"     # one another workspace's record also points at: kept
        self.sig_at(n.audio, shared, {"speaker_0": lab(DANA, "l24-sh-d"), "speaker_1": lab(STRANGER, "l24-sh-s")},
                    records=[{"workspace": WS, "record": n.ref}, {"workspace": WS_B, "record": n.ref}])
        self.assertIsNotNone(self.sig(n.audio, old))
        self.forget(DANA_REF, self.recs)
        self.assertIsNone(self.sig(n.audio, old))
        self.assertIsNotNone(self.sig(n.audio, shared))
        self.assertIsNotNone(self.sig(n.audio, n.diar))

    def test_no_rebuild_here_or_in_another_workspace_and_no_earlier_same_day_confirmation_brings_it_back(self):
        reps = self.teach_in(WS_B, "contacts/dana-oren", "Dana Oren", DANA, tag="l24")
        self.assertIn(enrol.RECOGNISED, [n["text"] for r in reps for n in r["notices"]])
        self.forget(DANA_REF, self.recs)
        entry = self.store.forgotten()[0]
        self.assertIn({"workspace": WS_B, "person": "contacts/dana-oren"},
                      [{"workspace": k["workspace"], "person": k["person"]} for k in entry["known_as"]])
        self.p("rebuild", ctx=self.base(WS_B, known={"contacts/dana-oren": "Dana Oren"}))
        self.p("rebuild", ctx=self.records_ctx(self.train))
        self.assertEqual(self.all_prints_of(WS, DANA_REF), [])
        self.assertEqual(self.all_prints_of(WS_B, "contacts/dana-oren"), [])
        fresh = self.signature("l24-same-day", {"speaker_0": lab(DANA, "l24-sd-d"), "speaker_1": lab(SAM, "l24-sd-s")})
        self.store.write_signature(MODEL.id, fresh, record={"workspace": WS_B, "record": "meeting-recordings/l24-sd"})
        for ws, ref in ((WS_B, "contacts/dana-oren"), (WS, DANA_REF)):
            rep = enrol.confirm(self.store, MODEL, TH, [{"audio": fresh["audio"], "diarization": fresh["diarization"]["id"],
                                                         "label": "speaker_0", "workspace": ws, "person": ref,
                                                         "name": "Dana Oren", "confirmed": EARLY}])
            self.assertEqual(rep["stored"], [], ws)
        self.assertEqual(self.all_prints_of(WS_B, "contacts/dana-oren"), [])
        # a confirmation made after the forget enrols again (design section 8, step 4)
        rep = enrol.confirm(self.store, MODEL, TH, [{"audio": fresh["audio"], "diarization": fresh["diarization"]["id"],
                                                     "label": "speaker_0", "workspace": WS_B, "person": "contacts/dana-oren",
                                                     "name": "Dana Oren", "confirmed": "2026-11-21T09:00:00+02:00"}])
        self.assertEqual(len(rep["stored"]), 1)

    # review round 1, `forgotten-label-computed-again`: a signature computed after the forget (identify, or
    # `prints rebuild`) gives none of the forgotten person's labels windows
    SAM_BEFORE = {"name": "Sam Diaz", "person": SAM_REF, "origin": "hand", "status": "confirmed",
                  "named": "2026-11-02T10:00:00+02:00"}

    def test_after_forget_and_forget_recording_identify_computes_none_of_their_labels(self):
        self.teach(SAM_REF, SAM)
        rec = self.two("l24-again", a=DANA, b=SAM)
        self.identify(rec)
        self.cli("--shown", rec.path, recs=[rec])
        self.answered(rec, "speaker_1", "correct")
        self.forget(SAM_REF, [rec])
        self.p("forget-recording", rec.path, ctx=rec.ctx)
        self.assertIsNone(self.sig(rec.audio, rec.diar))
        self.identify(rec, compute=self.compute_for(MODEL))
        self.assertEqual(self.wins(rec.audio, rec.diar, "speaker_1"), 0)
        self.assertIn("speaker_1", self.removed(rec.audio, rec.diar))
        self.assertGreater(self.wins(rec.audio, rec.diar, "speaker_0"), 0)

    def test_a_hand_name_with_no_signature_is_not_computed_after_the_forget(self):
        rec = self.two("l24-hand", a=DANA, b=SAM, write_sig=False, speakers={"speaker_1": "Sam Diaz"})
        self.forget(SAM_REF, [rec])
        self.identify(rec, compute=self.compute_for(MODEL))
        self.assertEqual((self.wins(rec.audio, rec.diar, "speaker_1"), self.removed(rec.audio, rec.diar)),
                         (0, ["speaker_1"]))
        self.assertGreater(self.wins(rec.audio, rec.diar, "speaker_0"), 0)

    def test_a_name_forget_never_saw_is_not_computed_and_one_given_after_the_forget_is(self):
        old = self.two("l24-unseen", a=DANA, b=SAM, write_sig=False, speakers={"speaker_1": "Sam Diaz"},
                       sources={"speaker_1": dict(self.SAM_BEFORE)})
        self.forget(SAM_REF, [])                     # the record was not among the ones handed to forget
        new = self.two("l24-later", a=DANA, b=SAM, write_sig=False, speakers={"speaker_1": "Sam Diaz"},
                       sources={"speaker_1": dict(self.SAM_BEFORE, named="2026-11-21T10:00:00+02:00")})
        mk = self.compute_for(MODEL)
        self.identify(old, compute=mk)
        self.identify(new, compute=mk)
        self.assertEqual((self.wins(old.audio, old.diar, "speaker_1"), self.removed(old.audio, old.diar)),
                         (0, ["speaker_1"]))
        self.assertGreater(self.wins(new.audio, new.diar, "speaker_1"), 0)      # named after the forget: enrols again
        self.assertEqual(self.removed(new.audio, new.diar), [])

    def test_a_proposal_forget_swept_is_not_computed_once_its_file_is_gone(self):
        rec = self.two("l24-swept", a=DANA, b=SAM)
        fm, body = self.records.read(rec.path)
        fm["transcription"]["speaker_questions"] = {"speaker_1": {"quotes": [], "flags": [], "proposed": {
            "person": SAM_REF, "name": "Sam Diaz", "origin": "attendees", "why": "the only attendee left"}}}
        self.records.write(rec.path, fm, body)
        self.forget(SAM_REF, [rec])
        self.assertNotIn("proposed", self.t(rec)["speaker_questions"]["speaker_1"])   # the record names them no more
        self.p("forget-recording", rec.path, ctx=rec.ctx)
        self.identify(rec, compute=self.compute_for(MODEL))
        self.assertEqual(self.wins(rec.audio, rec.diar, "speaker_1"), 0)
        self.assertIn("speaker_1", self.removed(rec.audio, rec.diar))

    def test_a_rebuild_computes_none_of_their_labels_when_the_old_models_file_is_gone(self):
        rec = self.two("l24-rebuild", a=DANA, b=SAM, speakers={"speaker_0": "Dana Oren", "speaker_1": "Sam Diaz"},
                       sources={"speaker_0": dict(self.SAM_BEFORE, name="Dana Oren", person=DANA_REF),
                                "speaker_1": dict(self.SAM_BEFORE)})
        enrol.confirm(self.store, MODEL, TH, [{"audio": rec.audio, "diarization": rec.diar, "label": "speaker_0",
                                               "workspace": WS, "person": DANA_REF, "name": "Dana Oren",
                                               "confirmed": "2026-11-03T09:00:00+02:00"}])
        self.forget(SAM_REF, [rec])
        self.assertEqual(self.wins(rec.audio, rec.diar, "speaker_1"), 0)
        os.remove(self.store.signature_path(MODEL.id, rec.audio, rec.diar))     # a person deleted the old model's file
        self.p("rebuild", ctx=self.records_ctx([rec.ctx]), active=ACTIVE_B, compute=self.compute_for(MODEL_B))
        self.assertIsNotNone(self.sig(rec.audio, rec.diar, MODEL_B))
        self.assertEqual(self.wins(rec.audio, rec.diar, "speaker_1", MODEL_B), 0)
        self.assertIn("speaker_1", self.removed(rec.audio, rec.diar, MODEL_B))
        self.assertGreater(self.wins(rec.audio, rec.diar, "speaker_0", MODEL_B), 0)


class Line25(Harness):
    """After a user says a person's voice is never to be kept (`prints never <person>`), that person's voice print
    is gone as after forgetting, and confirming their name on a later recording writes the name, stores no voice
    print, and the reply says their voice is not kept"""

    def test_never_forgets_and_a_later_confirmation_stores_nothing_and_says_so(self):
        self.teach(DANA_REF, DANA)
        rec = self.two("l25-before")
        self.identify(rec)
        out = self.forget(DANA_REF, [rec], verb="never")
        self.assertEqual(self.all_prints_of(WS, DANA_REF), [])
        self.assertEqual(self.removed(rec.audio, rec.diar), ["speaker_0"])
        nv = self.store.never()
        self.assertEqual([(e["workspace"], e["person"], e["name"]) for e in nv], [(WS, DANA_REF, "Dana Oren")])
        self.assertEqual(len(self.store.forgotten()), 1)
        self.assertIn("not kept", out["reply"])
        self.assertNotIn("with this name", out["reply"])              # no namesake anywhere: nothing to count
        later = self.two("l25-later")
        self.identify(later)
        reply = self.answered(later, "speaker_0", DANA_REF)["reply"]
        self.assertEqual(self.t(later)["speakers"]["speaker_0"], "Dana Oren")
        self.assertEqual(self.t(later)["speaker_sources"]["speaker_0"]["status"], "confirmed")
        self.assertEqual(self.all_prints_of(WS, DANA_REF), [])
        self.assertIn("Dana Oren's voice is not kept", reply)

    def test_never_is_matched_by_name_in_another_workspace(self):
        self.teach(DANA_REF, DANA)
        self.forget(DANA_REF, verb="never")
        reps = self.teach_in(WS_B, "contacts/dana-o", "Dana Oren", DANA, tag="l25")
        self.assertTrue(all(r["stored"] == [] for r in reps))
        self.assertEqual(self.all_prints_of(WS_B, "contacts/dana-o"), [])

    def test_never_says_how_many_namesake_prints_in_other_workspaces_it_removed_naming_none(self):
        # review round 1, `never-removes-namesake-print-elsewhere-silently`; the coordinator's ruling
        # `decisions/2026-11-16--cr-modules-019-build-task-10-never-keeps-the-design-s-by-name-reach-and-counts-it`
        self.teach(SAM_REF, SAM)
        self.teach_in(WS_B, "users/sam-d", "Sam Diaz", vp_synth.voice("l25-another-sam"), tag="l25n")
        self.assertEqual(self.print_of("users/sam-d", ws=WS_B)["trust"], "trusted")
        out = self.forget(SAM_REF, verb="never")
        self.assertIsNone(self.print_of("users/sam-d", ws=WS_B))           # the design's by-name reach, kept
        self.assertIn("1 voice print of a person with this name in another workspace", out["reply"])
        self.assertEqual(out["namesakes_removed"], 1)
        self.assertNotIn(WS_B, json.dumps(out))
        self.assertNotIn("users/sam-d", json.dumps(out))
        out = self.forget(SAM_REF)                    # forget never reaches a namesake (line 35): nothing to count
        self.assertNotIn("with this name", out["reply"])


class Line31(Harness):
    """Run in one workspace, `prints list` and every message of identification show only people that workspace
    knows — a person enrolled only in another workspace is counted, never named"""

    B_KNOWN = {"contacts/dana-oren": "Dana Oren", PRIYA_REF: "Priya Raman"}

    def setUp(self):
        super().setUp()
        self.teach(DANA_REF, DANA)
        self.teach(SAM_REF, SAM)
        self.teach_in(WS_B, PRIYA_REF, "Priya Raman", PRIYA, tag="l31p")
        self.teach_in(WS_B, "contacts/dana-oren", "Dana Oren", DANA, tag="l31d", start=7)

    def test_prints_list_names_only_this_workspaces_people_and_counts_the_rest(self):
        out_b = self.p("list", ctx=self.base(WS_B, known=self.B_KNOWN))
        names = sorted(x["name"] for x in out_b["people"])
        self.assertEqual(names, ["Dana Oren", "Priya Raman"])
        self.assertIn("and 1 person known only in other workspaces", out_b["reply"])
        self.assertNotIn("Sam Diaz", json.dumps(out_b))
        self.assertNotIn(WS, json.dumps(out_b))
        self.assertFalse(tvi.numbers_in_a_list(out_b), "a list of numbers in the output")
        out_a = self.p("list")
        self.assertEqual(sorted(x["name"] for x in out_a["people"]), ["Dana Oren", "Sam Diaz"])
        self.assertIn("and 1 person known only in other workspaces", out_a["reply"])
        self.assertNotIn("Priya Raman", json.dumps(out_a))
        dana = next(x for x in out_a["people"] if x["name"] == "Dana Oren")
        self.assertEqual(dana["trust"], "trusted")
        self.assertGreaterEqual(dana["admitted"], 2)

    def test_forget_counts_the_other_workspaces_and_names_none(self):
        out = self.forget("contacts/dana-oren", ws=WS_B, known=self.B_KNOWN)
        self.assertIn("also known in 1 other workspace", out["reply"])
        self.assertIn("prints forget", out["reply"])
        self.assertNotIn(WS, json.dumps(out))
        self.assertNotIn("Sam Diaz", json.dumps(out))

    def test_identification_in_b_names_nobody_known_only_in_a(self):
        rec = self.two("l31-in-b", a=SAM, b=PRIYA, attendees=(PRIYA_REF,))
        rec.ctx.update(workspace=WS_B, known=dict(self.B_KNOWN),
                       workspace_users=[], candidates=[{"person": PRIYA_REF, "name": "Priya Raman", "kind": "user"}],
                       attendee_count=1)
        code, outs = self.cli(rec.path, recs=[rec])
        self.assertEqual(code, 0, outs)
        self.assertEqual(self.t(rec)["speakers"].get("speaker_1"), "Priya Raman")
        q = self.question(rec)
        for text in (json.dumps(outs), json.dumps(q), json.dumps(self.fm(rec))):
            self.assertNotIn("Sam Diaz", text)
            self.assertNotIn(SAM_REF, text)

    def test_a_voice_recognised_from_the_other_workspace_is_said_so_naming_nothing_from_there(self):
        rec = self.two("l31-recognised", a=SAM, b=PRIYA)
        rec.ctx.update(workspace=WS_B, known=dict(self.B_KNOWN, **{"contacts/sam-d": "Sam Diaz"}), workspace_users=[],
                       candidates=[{"person": "contacts/sam-d", "name": "Sam Diaz", "kind": "contact"},
                                   {"person": PRIYA_REF, "name": "Priya Raman", "kind": "user"}])
        self.identify(rec)
        self.cli("--shown", rec.path, recs=[rec])
        reply = self.answered(rec, "speaker_0", "contacts/sam-d")["reply"]
        self.assertIn(enrol.RECOGNISED, reply)
        self.assertNotIn(WS, reply)
        self.assertNotIn(SAM_REF, reply)


class Line35(Harness):
    """Forgetting a person in one workspace does not remove the voice print of a different person who only shares
    their name in another workspace"""

    def test_a_namesake_elsewhere_keeps_their_print_and_the_rebuild_says_so_once(self):
        self.teach(SAM_REF, SAM)
        other_sam = vp_synth.voice("l35-another-sam")
        self.teach_in(WS_B, "users/sam-diaz", "Sam Diaz", other_sam, tag="l35")
        theirs = self.print_of("users/sam-diaz", ws=WS_B)
        self.assertEqual(theirs["trust"], "trusted")
        self.assertNotEqual(theirs["id"], self.print_of(SAM_REF)["id"])
        self.forget(SAM_REF)
        self.assertEqual(self.all_prints_of(WS, SAM_REF), [])
        kept = self.print_of("users/sam-diaz", ws=WS_B)
        self.assertEqual((kept["id"], kept["trust"], len(kept["sources"])), (theirs["id"], "trusted", 2))
        for s in kept["sources"]:
            self.assertGreater(self.wins(s["audio"], s["diarization"], s["label"]), 0)
        out = self.p("rebuild", ctx=self.base(WS_B, known={"users/sam-diaz": "Sam Diaz"}))
        self.assertEqual(out["reply"].count("a person with this name was forgotten in another workspace"), 1)
        self.assertEqual(self.print_of("users/sam-diaz", ws=WS_B)["trust"], "trusted")


class FakeEmbedder:
    """`embed.Embedder`'s stand-in for `run`: each window is one synthetic window of the voice speaking at its
    middle, by this run's segments."""

    def __init__(self, model_id, h):
        self.model = store.Model(model_id, "f" * 64, 64)
        self.h = h

    def embed(self, samples, sr, windows):
        out = []
        for a, b in windows:
            self.h.embedded.append((a, b))
            voice = self.h.voice_at((a + b) / 2)
            out.append({"start": a, "end": b, "vector": vp_synth.windows(voice, 1, seed=("run", round(a, 3)))[0]})
        return out


class RunAgain(Harness):
    """`run` (transcribe_meeting.run) over a record, with decoding, recognition, the diariser and the embedder
    replaced, writing signatures to the harness's store under the default model."""

    def setUp(self):
        super().setUp()
        import transcribe_meeting as tm
        from voiceprints import models as vp_models
        self.tm = tm
        self.run_model = store.Model(vp_models.DEFAULT_MODEL, "f" * 64, 64)
        self.run_active = {"model": self.run_model.id, "pin": self.run_model,
                           "calib": dict(CALIB, model=self.run_model.id), "source": "shipped"}
        self.embedded = []
        self.voices = {}
        self.segs = []
        skill = self.root / "skill"
        skill.mkdir()
        self.audio_file = self.root / "clip.m4a"
        self.audio_file.write_bytes(b"synthetic bytes, never a voice")

    def voice_at(self, t):
        for s in self.segs:
            if s["start"] <= t < s["end"]:
                return self.voices[s["speaker"]]
        return STRANGER

    def run_again(self, rec, segs, voices):
        tm = self.tm
        self.segs, self.voices = segs, voices
        duration = max(s["end"] for s in segs)
        words = [{"start": float(i), "end": i + 0.8, "text": " word"} for i in range(int(duration))]
        home = self.store.home
        patches = {
            "choose_engine": lambda requested: ("cpu", None),
            "missing_models": lambda engine, num_speakers: [],
            "read_meeting": self.records.read, "write_meeting": self.records.write,
            "decode_audio": lambda src, dst: Path(dst).write_bytes(b"RIFF"),
            "diarize_safe": lambda wav, num_speakers=None: (copy.deepcopy(segs), None),
            "transcribe": lambda wav, language=None, engine="cpu": {"words": words, "language": ["en"],
                                                                     "duration": duration, "language_forced": language},
            "asr_cache_path_for": lambda p: str(self.root / "run.asr.json"),
            "read_samples": lambda wav: ([], 16000),
            "load_embedder": lambda model_id: FakeEmbedder(model_id, self),
            "open_store": lambda ctx: store.Store(home, exclude_backup=tvi.no_exclude),
            "HERE": str(self.root / "skill"),
        }
        with contextlib.ExitStack() as st:
            for k, v in patches.items():
                st.enter_context(mock.patch.object(tm, k, v))
            st.enter_context(contextlib.redirect_stdout(io.StringIO()))
            st.enter_context(contextlib.redirect_stderr(io.StringIO()))
            tm.run(rec.path, str(self.audio_file), "2026-11-22", num_speakers=2, language="en", engine="cpu",
                   context=rec.ctx)
        t = self.t(rec)
        rec.diar = t["diarization_id"]
        rec.ctx["diarization_id"] = rec.diar
        return t

    @staticmethod
    def swapped(n=20):
        """The re-run's diarisation of `make`'s two-label recordings, with the labels swapped: the old
        speaker_1's turns (6 s at 6 + 12k) are now speaker_0's."""
        segs = []
        for k in range(n):
            segs.append({"speaker": "speaker_1", "start": 12.0 * k, "end": 12.0 * k + 6.0})
            segs.append({"speaker": "speaker_0", "start": 12.0 * k + 6.0, "end": 12.0 * k + 12.0})
        return segs


class Line37(RunAgain):
    """After a person is forgotten, transcribing again a recording that names them stores no voice windows for
    the label carrying their earlier name and does not propose them for it"""

    def test_after_forget_run_stores_nothing_of_them_and_identify_proposes_nothing_of_them(self):
        self.teach(SAM_REF, SAM)
        rec = self.two("l37", a=DANA, b=SAM)
        self.identify(rec)
        self.cli("--shown", rec.path, recs=[rec])
        self.answered(rec, "speaker_1", "correct")
        self.assertEqual(self.t(rec)["speaker_sources"]["speaker_1"]["status"], "confirmed")
        self.forget(SAM_REF, [rec])
        t = self.run_again(rec, self.swapped(), {"speaker_0": SAM, "speaker_1": DANA})
        sam = next(e for e in t["previous_speakers"]["labels"].values() if e["name"] == "Sam Diaz")
        self.assertEqual((sam["new_label"], sam["offered"], sam["forgotten"]), ("speaker_0", False, True))
        sig = self.sig(rec.audio, rec.diar, self.run_model)
        self.assertEqual(sig["removed"], ["speaker_0"])
        self.assertEqual(sig["labels"]["speaker_0"]["windows"], [])
        self.assertTrue(self.embedded)
        self.assertTrue(all(int(a // 6) % 2 == 0 for a, b in self.embedded), "a window of the forgotten voice was embedded")
        self.identify(rec, active=self.run_active)
        t = self.t(rec)
        for q in (t.get("speaker_questions") or {}).values():
            self.assertNotEqual((q.get("proposed") or {}).get("person"), SAM_REF)
        self.assertNotIn("Sam Diaz", t["speakers"].values())


# ======================================================================================================
# the findings carried into this task

class StickyForgottenLifted(RunAgain):
    """Finding `sticky-forgotten-overrides-later-confirmation` (task 4, round 2): a person confirmed on a recording
    after they were forgotten is proposed again, and their voice windows kept, when that recording is transcribed
    again (design section 8 step 4: a confirmation made after `at` enrols again)."""

    T = "2026-11-10T09:00:00+02:00"

    def entry(self):
        return {"print": "p-5a9d1c2e", "known_as": [{"workspace": WS, "person": SAM_REF, "name": "Sam Diaz"}], "at": self.T}

    def test_forgotten_new_labels_stamps_the_instant_of_the_forget(self):
        prev = {"labels": {"speaker_1": {"name": "Sam Diaz", "source": {"person": SAM_REF, "named": "2026-11-01T10:00:00+02:00"},
                                         "new_label": "speaker_1", "share": 1.0, "offered": True}}}
        self.assertEqual(carry.forgotten_new_labels(prev, [self.entry()], WS), {"speaker_1"})
        e = prev["labels"]["speaker_1"]
        self.assertEqual((e["forgotten"], e["forgotten_at"], e["offered"]), (True, self.T, False))

    def test_a_confirmation_after_the_mark_lifts_it_in_the_merge(self):
        fm = {"transcription": {"diarization_id": "0123456789ab", "speakers": {"speaker_1": "Sam Diaz"},
                                "speaker_sources": {"speaker_1": {"name": "Sam Diaz", "person": SAM_REF, "origin": "hand",
                                                                  "status": "confirmed", "named": "2026-11-12T10:00:00+02:00"}},
                                "previous_speakers": {"diarization_id": "aaaaaaaaaaaa", "labels": {
                                    "speaker_1": {"name": "Sam Diaz", "new_label": "speaker_1", "share": 1.0, "offered": False,
                                                  "forgotten": True, "forgotten_at": self.T}}}}}
        entries, _ = carry.earlier(fm)
        self.assertEqual(len(entries), 1)
        self.assertNotIn("forgotten", entries[0])
        body = "## Transcript\n\n[00:00] Speaker 0: hello there\n\n[00:30] Speaker 1: hello back\n"
        segs = [{"speaker": "speaker_0", "start": 0.0, "end": 30.0}, {"speaker": "speaker_1", "start": 30.0, "end": 60.0}]
        prev = carry.previous(fm, body, None, segs, 60.0)
        self.assertEqual(carry.forgotten_new_labels(prev, [self.entry()], WS), set())
        self.assertTrue(prev["labels"]["speaker_1"]["offered"])
        self.assertNotIn("forgotten", prev["labels"]["speaker_1"])

    def test_a_mark_with_no_instant_stays(self):
        fm = {"transcription": {"diarization_id": "0123456789ab", "speakers": {"speaker_1": "Sam Diaz"},
                                "speaker_sources": {"speaker_1": {"name": "Sam Diaz", "person": SAM_REF, "origin": "hand",
                                                                  "status": "confirmed", "named": "2026-11-12T10:00:00+02:00"}},
                                "previous_speakers": {"labels": {"speaker_1": {"name": "Sam Diaz", "new_label": "speaker_1",
                                                                               "offered": False, "forgotten": True}}}}}
        entries, _ = carry.earlier(fm)
        self.assertTrue(entries[0].get("forgotten"))

    def test_end_to_end_forget_then_confirm_again_then_transcribe_again_keeps_them(self):
        self.teach(SAM_REF, SAM)
        rec = self.two("sticky", a=DANA, b=SAM)
        self.identify(rec)
        self.cli("--shown", rec.path, recs=[rec])
        self.answered(rec, "speaker_1", "correct")
        self.forget(SAM_REF, [rec])
        t = self.run_again(rec, self.swapped(), {"speaker_0": SAM, "speaker_1": DANA})
        sam = next(e for e in t["previous_speakers"]["labels"].values() if e["name"] == "Sam Diaz")
        self.assertTrue(sam["forgotten"])
        store.parse_instant(sam["forgotten_at"])
        # after the forget, a person confirms Sam on this record's speaker_0 (the label his time went to)
        fm, body = self.records.read(rec.path)
        later = "2026-11-21T10:00:00+02:00"
        fm["transcription"]["speakers"]["speaker_0"] = "Sam Diaz"
        fm["transcription"]["speaker_sources"] = {"speaker_0": {"name": "Sam Diaz", "person": SAM_REF, "origin": "hand",
                                                                "status": "confirmed", "named": later}}
        self.records.write(rec.path, fm, body)
        before = len(self.embedded)
        segs = self.swapped()
        segs[0]["start"] = 0.5                     # another diarisation (a removed label is never computed again)
        t = self.run_again(rec, segs, {"speaker_0": SAM, "speaker_1": DANA})
        sam = next(e for e in t["previous_speakers"]["labels"].values() if e["name"] == "Sam Diaz")
        self.assertNotIn("forgotten", sam)
        self.assertTrue(sam["offered"])
        sig = self.sig(rec.audio, rec.diar, self.run_model)
        self.assertEqual(sig["removed"], [])
        self.assertGreater(len(sig["labels"]["speaker_0"]["windows"]), 0)
        self.assertGreater(len(self.embedded), before)
        self.identify(rec, active=self.run_active)
        self.assertEqual(self.t(rec)["speaker_questions"]["speaker_0"]["proposed"]["person"], SAM_REF)


class EarlierKeyKeepsItsLabel(Harness):
    """Finding `earlier-key-drops-its-label` (task 4, round 2): transcribing a recording again keeps, for every
    earlier name, the label of the earlier diarisation it was on, so forgetting that person later removes those
    windows too."""

    def test_an_earlier_key_entry_carries_the_label_it_sat_on(self):
        fm = {"transcription": {"diarization_id": "d_prev000000", "speakers": {"speaker_0": "Priya Raman"},
                                "previous_speakers": {"diarization_id": "d_older00000", "labels": {
                                    "speaker_3": {"name": "Dana Oren", "source": {"person": DANA_REF},
                                                  "new_label": "speaker_0", "share": 0.5, "offered": False}}}}}
        body = "## Transcript\n\n[00:00] Speaker 0: hello there\n\n[00:30] Speaker 1: hello back\n"
        segs = [{"speaker": "speaker_0", "start": 0.0, "end": 30.0}, {"speaker": "speaker_1", "start": 30.0, "end": 60.0}]
        prev = carry.previous(fm, body, None, segs, 60.0)
        self.assertEqual(prev["diarization_id"], "d_prev000000")
        dana = prev["labels"]["earlier:speaker_3"]
        self.assertEqual(dana["label"], "speaker_0")              # d_prev's label, not the key
        self.assertNotIn("label", prev["labels"]["speaker_0"])   # a key that is its label needs none

    def test_forget_removes_the_windows_of_the_label_it_sat_on(self):
        rec = self.two("earlier-key", a=PRIYA, b=SAM, prev={"diarization_id": "d0a0b0c0d0e0", "labels": {
            "speaker_0": {"name": "Priya Raman", "new_label": "speaker_0", "share": 1.0, "offered": True},
            "earlier:speaker_3": {"name": "Dana Oren", "source": {"person": DANA_REF}, "label": "speaker_1",
                                  "new_label": None, "share": 0.0, "offered": False}}})
        self.sig_at(rec.audio, "d0a0b0c0d0e0", {"speaker_0": lab(PRIYA, "ek-p"), "speaker_1": lab(DANA, "ek-d")},
                    records=[{"workspace": WS, "record": rec.ref}])
        rows = self.rows([rec], DANA_REF, "Dana Oren")
        self.assertEqual(rows[0]["matches"][0]["label"], "speaker_1")
        self.forget(DANA_REF, [rec])
        self.assertEqual(self.removed(rec.audio, "d0a0b0c0d0e0"), ["speaker_1"])
        self.assertGreater(self.wins(rec.audio, "d0a0b0c0d0e0", "speaker_0"), 0)
        self.assertEqual(self.removed(rec.audio, rec.diar), [])     # mapped nowhere: nothing in the new one


class RebuildKeepsSourcesWaiting(Harness):
    """Finding `rebuild-before-new-model-signatures-drops-sources` (task 5): rebuilding the voice prints after the
    speaker model changes keeps every confirmation of every print, including recordings not yet embedded with
    the new model. `prints rebuild` computes what it can from the records it is handed; a source it cannot
    compute waits in the print (status `waiting`), never deleted, and is judged once its signature exists."""

    def test_a_rebuild_with_nothing_to_compute_from_keeps_every_source_waiting(self):
        self.teach(DANA_REF, DANA)
        out = self.p("rebuild", active=ACTIVE_B)
        p = self.print_of(DANA_REF, model=MODEL_B)
        self.assertIsNotNone(p, "the print was dropped")
        self.assertEqual([s["status"] for s in p["sources"]], ["waiting", "waiting"])
        self.assertEqual(p["trust"], "proposing")
        self.assertIn("wait", out["reply"])
        # their signatures appear (run or identify computed them): the next rebuild judges them
        mk = self.compute_for(MODEL_B)
        for c in self.train:
            self.store.write_signature(MODEL_B.id, mk(MODEL_B.id, c, c["fingerprint"][7:]),
                                       record={"workspace": WS, "record": c["record"]})
        self.p("rebuild", active=ACTIVE_B)
        p = self.print_of(DANA_REF, model=MODEL_B)
        self.assertEqual(([s["status"] for s in p["sources"]], p["trust"]), (["admitted", "admitted"], "trusted"))

    def test_a_partial_first_rebuild_is_completed_by_the_next(self):
        self.teach(DANA_REF, DANA)
        mk = self.compute_for(MODEL_B)
        self.p("rebuild", ctx=self.records_ctx(self.train[:1]), active=ACTIVE_B, compute=mk)
        p = self.print_of(DANA_REF, model=MODEL_B)
        self.assertEqual(sorted(s["status"] for s in p["sources"]), ["admitted", "waiting"])
        self.teach(DANA_REF, DANA, times=1, tag="late")     # a confirmation under the old model, after the first rebuild
        self.p("rebuild", ctx=self.records_ctx(self.train), active=ACTIVE_B, compute=mk)
        p = self.print_of(DANA_REF, model=MODEL_B)
        self.assertEqual(sorted(s["status"] for s in p["sources"]), ["admitted", "admitted", "admitted"])
        self.assertEqual(p["trust"], "trusted")

    def test_a_waiting_source_whose_label_was_removed_elsewhere_is_dropped(self):
        self.teach(DANA_REF, DANA)
        self.teach(SAM_REF, SAM)
        self.p("rebuild", active=ACTIVE_B)
        first = self.print_of(SAM_REF)["sources"][0]
        self.store.remove_windows(MODEL.id, first["audio"], first["diarization"], first["label"])
        self.p("rebuild", active=ACTIVE_B)
        self.assertEqual([s["status"] for s in self.print_of(SAM_REF, model=MODEL_B)["sources"]], ["waiting"])
        self.forget(DANA_REF)                              # forget sweeps the new model's folder as well
        self.p("rebuild", active=ACTIVE_B)
        self.assertIsNone(self.print_of(DANA_REF, model=MODEL_B))

    def test_a_correction_waits_too(self):
        self.teach(DANA_REF, DANA)
        wrong = self.two("rw-wrong", a=SAM, b=TOM)
        dana = self.print_of(DANA_REF)
        enrol.correct_provisional(self.store, MODEL, {"audio": wrong.audio, "diarization": wrong.diar,
                                                      "label": "speaker_0"}, dana["id"])
        self.p("rebuild", active=ACTIVE_B)
        p = self.print_of(DANA_REF, model=MODEL_B)
        self.assertEqual(p["negatives"], [{"audio": wrong.audio, "diarization": wrong.diar, "label": "speaker_0"}])
        self.assertFalse(p["auto"])

    def test_carry_merges_into_a_print_already_in_the_folder(self):
        self.teach(DANA_REF, DANA, times=1)
        enrol.carry(self.store, MODEL.id, MODEL_B)
        self.teach(DANA_REF, DANA, times=1, tag="second")
        enrol.carry(self.store, MODEL.id, MODEL_B)
        self.assertEqual(len(self.print_of(DANA_REF, model=MODEL_B)["sources"]), 2)


class FastPathSeesSignatureFiles(Harness):
    """Finding `fast-path-blind-to-signature-files` (task 5, round 2): after a recording is forgotten, no voice
    print counts it at the next answer, even when the forget was interrupted before it finished — a live answer
    judges only what is new only when every source's signature file is as the last pass left it."""

    def case(self):
        self.teach(DANA_REF, DANA)                        # trusted from two recordings
        sam = self.signature("fp-sam", {"speaker_0": lab(SAM, "fp-s"), "speaker_1": lab(TOM, "fp-t")})
        self.store.write_signature(MODEL.id, sam, record={"workspace": WS, "record": "meeting-recordings/fp-sam"})
        self.sam = sam
        return self.print_of(DANA_REF)

    def answer_sam(self):
        return enrol.confirm(self.store, MODEL, TH, [{"audio": self.sam["audio"], "diarization": self.sam["diarization"]["id"],
                                                      "label": "speaker_0", "workspace": WS, "person": SAM_REF,
                                                      "name": "Sam Diaz", "confirmed": "2026-11-21T09:00:00+02:00"}])

    def test_a_deleted_diarisation_file_of_a_print_that_does_not_learn_makes_the_next_answer_full(self):
        dana = self.case()
        first = dana["sources"][0]
        os.remove(self.store.signature_path(MODEL.id, first["audio"], first["diarization"]))   # forget-recording, interrupted
        rep = self.answer_sam()
        self.assertEqual(rep["pass"], "full")
        self.assertEqual(self.print_of(DANA_REF)["trust"], "proposing")

    def test_removed_windows_on_a_print_that_does_not_learn_make_the_next_answer_full(self):
        dana = self.case()
        first = dana["sources"][0]
        self.store.remove_windows(MODEL.id, first["audio"], first["diarization"], first["label"])
        rep = self.answer_sam()
        self.assertEqual(rep["pass"], "full")
        self.assertEqual(len(self.print_of(DANA_REF)["sources"]), 1)

    def test_with_nothing_changed_the_next_answer_is_still_fast(self):
        self.case()
        self.assertEqual(self.answer_sam()["pass"], "fast")


class DigestReadsWhatThePassRead(Harness):
    """Finding `digest-reads-never-and-forgotten-after-the-pass` (task 5, round 2): a person marked never while an
    answer is being applied has no voice print after the next answer."""

    def test_a_never_entry_written_during_a_pass_makes_the_next_answer_full(self):
        self.teach(DANA_REF, DANA)
        sam = self.signature("dg-sam", {"speaker_0": lab(SAM, "dg-s"), "speaker_1": lab(TOM, "dg-t")})
        self.store.write_signature(MODEL.id, sam, record={"workspace": WS, "record": "meeting-recordings/dg-sam"})
        real = enrol._persist

        def persist_then_never(*a, **k):
            real(*a, **k)
            self.store.add_never({"workspace": WS, "person": DANA_REF, "name": "Dana Oren", "at": "2026-11-21T08:00:00+02:00"})
        with mock.patch.object(enrol, "_persist", persist_then_never):
            enrol.confirm(self.store, MODEL, TH, [{"audio": sam["audio"], "diarization": sam["diarization"]["id"],
                                                   "label": "speaker_0", "workspace": WS, "person": SAM_REF,
                                                   "name": "Sam Diaz", "confirmed": "2026-11-21T09:00:00+02:00"}])
        tom = self.signature("dg-tom", {"speaker_0": lab(TOM, "dg-t2"), "speaker_1": lab(PRIYA, "dg-p")})
        self.store.write_signature(MODEL.id, tom, record={"workspace": WS, "record": "meeting-recordings/dg-tom"})
        rep = enrol.confirm(self.store, MODEL, TH, [{"audio": tom["audio"], "diarization": tom["diarization"]["id"],
                                                     "label": "speaker_0", "workspace": WS, "person": TOM_REF,
                                                     "name": "Tom Whitfield", "confirmed": "2026-11-21T10:00:00+02:00"}])
        self.assertEqual(rep["pass"], "full")
        self.assertIsNone(self.print_of(DANA_REF))


# ======================================================================================================
# task 10 review round 1

class ForgetHoldsTheStore(Harness):
    """Finding `confirm-racing-forget-keeps-its-windows`: a confirmation applied while `prints forget` runs leaves no
    voice windows of the forgotten person once forget returns — forget reads the prints under the store's locks
    (ruling D3: every model folder's lock, then the root's), so another session's answer waits for it."""

    def test_an_answer_from_another_thread_waits_for_forget_and_keeps_nothing_of_them(self):
        self.teach(SAM_REF, SAM)
        fresh = self.signature("race", {"speaker_0": lab(DANA, "race:d"), "speaker_1": lab(SAM, "race:s")})
        self.store.write_signature(MODEL.id, fresh, record={"workspace": WS, "record": "meeting-recordings/race"})
        audio, diar = fresh["audio"], fresh["diarization"]["id"]
        real = self.store.add_forgotten
        got, errors, threads = [], [], []

        def answer():
            try:
                got.append(enrol.confirm(self.store, MODEL, TH, [{
                    "audio": audio, "diarization": diar, "label": "speaker_1", "workspace": WS, "person": SAM_REF,
                    "name": "Sam Diaz", "confirmed": "2026-11-20T09:59:00+02:00"}]))   # stamped before the forget
            except Exception as e:  # pragma: no cover - reported below
                errors.append(e)

        def racing(entry):
            if not threads:      # another session's `identify --answer` lands while forget is under way
                th = threading.Thread(target=answer)
                threads.append(th)
                th.start()
                th.join(1.0)     # it finishes now, unless forget holds the store
            return real(entry)
        with mock.patch.object(self.store, "add_forgotten", racing):
            self.forget(SAM_REF, [])
        threads[0].join(30)
        self.assertEqual(errors, [])
        self.assertEqual(self.all_prints_of(WS, SAM_REF), [])
        stored, left = got[0]["stored"], self.wins(audio, diar, "speaker_1")
        self.assertTrue(stored == [] or left == 0, f"the racing answer stored {stored} and {left} windows stayed")


class PrintsWaitingForRebuild(Harness):
    """Finding `non-active-folder-loses-vectors-silently`: voice prints that need rebuilding after the speaker
    model changes back say so in identification and in `prints list`, naming `prints rebuild`."""

    def test_prints_a_forget_left_without_a_voice_name_prints_rebuild_until_it_runs(self):
        self.teach(DANA_REF, DANA)
        self.teach(SAM_REF, SAM)
        mk = self.compute_for(MODEL_B)
        for c in self.train:
            self.store.write_signature(MODEL_B.id, mk(MODEL_B.id, c, c["fingerprint"][7:]),
                                       record={"workspace": WS, "record": c["record"]})
        self.p("rebuild", ctx=self.records_ctx(self.train), active=ACTIVE_B, compute=mk)
        self.forget(SAM_REF, [], active=ACTIVE_B)       # the old folder is replayed with no calibration of its own
        old = self.print_of(DANA_REF)
        self.assertEqual((old["trust"], bool(old.get("vector"))), ("proposing", False))
        # the old model is the active one again (a rollback)
        r = self.identify(self.two("pw-a", b=STRANGER), active=ACTIVE)
        self.assertTrue(any("prints rebuild" in x for x in r["lines"]), r["lines"])
        self.assertIn("prints rebuild", self.p("list", active=ACTIVE)["reply"])
        self.p("rebuild", active=ACTIVE)
        self.assertEqual(self.print_of(DANA_REF)["trust"], "trusted")
        rec = self.two("pw-b", b=STRANGER)
        r = self.identify(rec, active=ACTIVE)
        self.assertFalse(any("prints rebuild" in x for x in r["lines"]), r["lines"])
        self.assertEqual(self.t(rec)["speakers"].get("speaker_0"), "Dana Oren")
        self.assertNotIn("prints rebuild", self.p("list", active=ACTIVE)["reply"])


class RebuildLineStays(Harness):
    """Finding `rebuild-line-lost-once-confirmed-under-new-model` (acceptance line 11): identify's `prints rebuild`
    line stays while a person of this workspace has a trusted print in another model folder whose recordings
    the active model's print of them lacks."""

    def test_the_line_stays_after_a_confirmation_under_the_new_model_and_goes_after_the_rebuild(self):
        self.teach(DANA_REF, DANA)
        self.teach(SAM_REF, SAM)
        rec = self.two("rl-a", model=MODEL_B)
        r = self.identify(rec, active=ACTIVE_B)
        self.assertTrue(any("prints rebuild" in x for x in r["lines"]), r["lines"])
        self.cli("--shown", rec.path, recs=[rec], active=ACTIVE_B)
        code, outs = self.cli("--answer", rec.path, f"speaker_0={DANA_REF}", f"speaker_1={SAM_REF}", recs=[rec],
                              active=ACTIVE_B)
        self.assertEqual(code, 0, outs)
        self.assertEqual(self.print_of(DANA_REF, model=MODEL_B)["trust"], "proposing")
        r = self.identify(self.two("rl-b", model=MODEL_B), active=ACTIVE_B)
        self.assertTrue(any("prints rebuild" in x for x in r["lines"]), r["lines"])
        self.assertIn("prints rebuild", self.p("list", active=ACTIVE_B)["reply"])
        self.p("rebuild", ctx=self.records_ctx(self.train), active=ACTIVE_B, compute=self.compute_for(MODEL_B))
        self.assertEqual(self.print_of(DANA_REF, model=MODEL_B)["trust"], "trusted")
        rec = self.two("rl-c", model=MODEL_B)
        r = self.identify(rec, active=ACTIVE_B)
        self.assertFalse(any("prints rebuild" in x for x in r["lines"]), r["lines"])
        self.assertEqual(self.t(rec)["speakers"].get("speaker_0"), "Dana Oren")


# ======================================================================================================
# the other verbs

class Link(Harness):
    """`prints link <person>` joins two prints the user says are one person (design section 8), naming nothing
    from elsewhere; the joining entry carries no `since` (ruling D21)."""

    def test_link_joins_a_resembling_print_from_another_workspace(self):
        self.teach(DANA_REF, DANA)
        reps = self.teach_in(WS_B, "contacts/d-oren", "D. Oren", DANA, tag="link")
        self.assertIn("resembles", reps[0]["notices"][0]["text"])
        mine = self.print_of("contacts/d-oren", ws=WS_B)
        out = self.p("link", "contacts/d-oren", ctx=dict(self.base(WS_B, known={"contacts/d-oren": "D. Oren"}),
                                                         person={"ref": "contacts/d-oren", "name": "D. Oren"}))
        joined = self.print_of(DANA_REF)
        self.assertEqual(self.print_of("contacts/d-oren", ws=WS_B)["id"], joined["id"])
        self.assertNotEqual(joined["id"], mine["id"])
        entry = next(k for k in joined["known_as"] if k["workspace"] == WS_B)
        self.assertEqual(entry, {"workspace": WS_B, "person": "contacts/d-oren", "name": "D. Oren"})
        self.assertEqual(len(joined["sources"]), 4)
        self.assertEqual(joined["trust"], "trusted")
        self.assertIn("D. Oren", out["reply"])
        self.assertNotIn("Dana Oren", json.dumps(out))
        self.assertNotIn(WS, json.dumps(out))
        self.assertFalse(os.path.exists(self.store.print_path(MODEL.id, mine["id"])))

    def test_nothing_resembles_nothing_is_joined(self):
        self.teach_in(WS_B, "contacts/d-oren", "D. Oren", DANA, tag="alone")
        code, outs = self.pcli("link", "contacts/d-oren", ctx=dict(self.base(WS_B, known={"contacts/d-oren": "D. Oren"}),
                                                                   person={"ref": "contacts/d-oren", "name": "D. Oren"}))
        self.assertEqual(code, 1, outs)
        self.assertIn("nothing joined", json.dumps(outs))


class Reseed(Harness):
    """`prints reseed <person>`: the first admitted source is kept aside and the print starts again from the rest
    (design section 9, step 5)."""

    def test_reseed_marks_the_first_source_and_replays(self):
        self.teach(DANA_REF, DANA, times=3)
        out = self.p("reseed", DANA_REF, ctx=dict(self.base(), person={"ref": DANA_REF, "name": "Dana Oren"}))
        p = self.print_of(DANA_REF)
        self.assertEqual([s["status"] for s in p["sources"]], ["reseeded", "admitted", "admitted"])
        self.assertIn("Dana Oren", out["reply"])

    def test_a_person_with_no_print_here_is_refused(self):
        code, outs = self.pcli("reseed", DANA_REF, ctx=dict(self.base(), person={"ref": DANA_REF, "name": "Dana Oren"}))
        self.assertEqual(code, 1, outs)


class TheVerb(Harness):
    """`transcribe_meeting.py prints` and its refusals."""

    def test_usage(self):
        for args in (("nonsense",), ("forget",), ("forget-recording",), ()):
            code, outs = self.pcli(*args) if args else self.pcli("")
            self.assertEqual(code, 2, (args, outs))
            self.assertIn("usage", outs[0])

    def test_a_person_this_workspace_does_not_know_is_refused_before_anything_is_written(self):
        self.teach(DANA_REF, DANA)
        code, outs = self.pcli("forget", "users/nobody-here", ctx=self.person_ctx("users/nobody-here"))
        self.assertEqual(code, 2, outs)
        self.assertEqual(self.store.forgotten(), [])

    def test_the_verb_is_wired_and_needs_its_context(self):
        p = subprocess.run([sys.executable, "-B", str(SKILL / "transcribe_meeting.py"), "prints", "list"],
                           capture_output=True, text=True, cwd=str(self.root),
                           env=dict(os.environ, VOICE_PRINTS_HOME=str(self.root / "vp2")))
        self.assertEqual(p.returncode, 2, p.stderr + p.stdout)
        self.assertIn("--context", p.stdout + p.stderr)


if __name__ == "__main__":
    unittest.main()
