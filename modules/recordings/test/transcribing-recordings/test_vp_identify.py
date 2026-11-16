"""`identify` (cr-modules-019 task 9): names, proposals, the end-of-run question and a person's answer —
design sections 6, 10, 11 and 22, one class per acceptance line it carries (each docstring quotes its line
of cr-modules-019), plus the obligations earlier reviews carried into it: every carried name re-checked
against forgotten.json (finding `forgotten-unchecked-without-store`), questions taken from `decide`'s
flags (ruling D18), enrolment only through `enrol.confirm`, and a computed signature that keeps every
other model folder's `removed` (Revisions entry 1).

Standard library only, so a bare python3 runs it (vp-identify.test.mjs). Every voice is synthetic and made
at run time by vp_synth.py, each voice and each source with its own seed (ruling D13). Every store is a
temp folder with a fake `exclude_backup` (ruling D14); records are written by vp_records (JSON frontmatter)
under the same temp folder; prints become trusted the real way, through `enrol.confirm`, except where a
test seeds them on purpose (line 17).
"""
from __future__ import annotations

import contextlib
import copy
import hashlib
import io
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
SKILL = HERE.parents[1] / "skills" / "transcribing-recordings"
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(SKILL))

import vp_records  # noqa: E402
import vp_synth  # noqa: E402
from voiceprints import enrol, identify, models, naming, quotes, store, vec  # noqa: E402

TH = dict(enrol.PLACEHOLDERS)
MODEL = store.Model("campp-test", "c" * 64, 64)
CALIB = {"model": MODEL.id, "thresholds": dict(TH), "print_closed": "auto", "print_open": "auto",
         "elimination": "propose", "split_weak": False, "source": "shipped"}
ACTIVE = {"model": MODEL.id, "pin": MODEL, "calib": CALIB, "source": "shipped"}
WS = "northwind-hq"

DANA_REF, SAM_REF, PRIYA_REF, TOM_REF = "users/dana-oren", "contacts/sam-diaz", "contacts/priya-raman", "users/tom-whitfield"
NAMES = {DANA_REF: "Dana Oren", SAM_REF: "Sam Diaz", PRIYA_REF: "Priya Raman", TOM_REF: "Tom Whitfield"}
DANA, SAM, PRIYA, TOM = (vp_synth.voice(s) for s in ("id-dana", "id-sam", "id-priya", "id-tom"))
STRANGER = vp_synth.voice("id-stranger")

BASE = {"workspace": WS, "guard": {}, "known": dict(NAMES),
        "workspace_users": [{"person": DANA_REF, "name": "Dana Oren"}, {"person": TOM_REF, "name": "Tom Whitfield"}]}


def no_exclude(home):
    return None


def audio_of(name):
    return hashlib.sha256(("id-audio:" + name).encode()).hexdigest()


def diar_of(name):
    return hashlib.sha256(("id-diar:" + name).encode()).hexdigest()[:12]


def plane(u, other, deg):
    """A unit vector at `deg` degrees from `u`, in the plane of `u` and `other`."""
    u = vec.unit(u)
    d = sum(x * y for x, y in zip(other, u))
    w = vec.unit([x - d * y for x, y in zip(other, u)])
    r = math.radians(deg)
    return vec.unit([math.cos(r) * a + math.sin(r) * b for a, b in zip(u, w)])


def sentence(j, k):
    return (f"Point {j} {k} we can move the review of this item to the next slot. "
            f"Then close the open notes today please.")


def numbers_in_a_list(obj):
    """True when `obj` holds a list with a number in it: a vector never goes in a record."""
    if isinstance(obj, dict):
        return any(numbers_in_a_list(v) for v in obj.values())
    if isinstance(obj, (list, tuple)):
        return any(isinstance(v, (int, float)) and not isinstance(v, bool) for v in obj) or \
            any(numbers_in_a_list(v) for v in obj)
    return False


class Rec:
    def __init__(self, name, path, ref, ctx, audio, diar, sig):
        self.name, self.path, self.ref, self.ctx, self.audio, self.diar, self.sig = name, path, ref, ctx, audio, diar, sig


def lab(voice=None, seed=None, n=20, seconds=120.0, longest=40.0, vectors=None, noise=0.15, share=None):
    return {"voice": voice, "seed": seed, "n": n, "seconds": seconds, "longest": longest, "vectors": vectors,
            "noise": noise, "share": share}


class Harness(unittest.TestCase):
    def setUp(self):
        self._td = tempfile.TemporaryDirectory(prefix="vp-identify-")
        self.addCleanup(self._td.cleanup)
        self.root = Path(os.path.realpath(self._td.name))
        home = self.root / "home"
        home.mkdir()
        env = mock.patch.dict(os.environ, {"HOME": str(home), "USERPROFILE": str(home),
                                           "VOICE_PRINTS_HOME": str(self.root / "unused")})
        env.start()
        self.addCleanup(env.stop)
        self.store = store.Store(str(self.root / "vp"), exclude_backup=no_exclude)
        self.records = vp_records.Records()
        self.ws = self.root / "ws"
        self.tick = 0

    # -- the clock: every answer later than the one before ----------------------------------------------
    def now(self):
        self.tick += 1
        return f"2026-11-20T{10 + self.tick // 3600:02d}:{(self.tick // 60) % 60:02d}:{self.tick % 60:02d}+02:00"

    # -- prints made the real way -------------------------------------------------------------------------
    def teach(self, ref, voice, times=2, seconds=120.0, model=MODEL, tag=""):
        """`times` confirmed training recordings of `voice` as `ref`, through enrol.confirm: two make a
        trusted print (two admitted sources, a minute of speech)."""
        for i in range(times):
            nm = f"train-{ref}-{tag}{i}"
            filler = vp_synth.voice(f"filler:{nm}")
            sig = self.signature(nm, {"speaker_0": lab(voice, f"{nm}:v", seconds=seconds),
                                      "speaker_1": lab(filler, f"{nm}:f")}, model=model)
            self.store.write_signature(model.id, sig, record={"workspace": WS, "record": f"meeting-recordings/{nm}"})
            enrol.confirm(self.store, model, TH, [{
                "audio": sig["audio"], "diarization": sig["diarization"]["id"], "label": "speaker_0",
                "workspace": WS, "person": ref, "name": NAMES[ref],
                "confirmed": f"2026-11-0{1 + i}T09:00:{len(tag):02d}+02:00"}])

    def print_of(self, ref, model=MODEL):
        for p in self.store.prints(model.id):
            if any(k.get("workspace") == WS and k.get("person") == ref for k in p.get("known_as") or []):
                return p
        return None

    # -- recordings -----------------------------------------------------------------------------------
    def signature(self, name, spec, hint=2, fallback=None, model=MODEL):
        labels = sorted(spec)
        out = {}
        for j, l in enumerate(labels):
            s = spec[l]
            vs = s["vectors"] if s.get("vectors") is not None else \
                vp_synth.windows(s["voice"], s["n"], noise=s["noise"], seed=s["seed"] or f"{name}:{l}")
            ws = [{"start": (k * len(labels) + j) * 6.0, "end": (k * len(labels) + j) * 6.0 + 6.0, "vector": v}
                  for k, v in enumerate(vs)]
            out[l] = {"seconds": s["seconds"], "longest_turn": s["longest"], "windows": ws}
            if s.get("share") is not None:
                out[l]["share"] = s["share"]
        total = sum(v["seconds"] for v in out.values()) or 1.0
        for v in out.values():
            v.setdefault("share", round(v["seconds"] / total, 4))
        return {"version": 1, "audio": audio_of(name),
                "diarization": {"id": diar_of(name), "labels": len(out), "speakers_hint": hint, "fallback": fallback},
                "model": {"id": model.id, "sha256": model.sha256, "dim": model.dim},
                "labels": out, "removed": []}

    def make(self, name, spec, *, hint=2, fallback=None, attendees=(DANA_REF, SAM_REF), meeting=True,
             certain=True, speakers=None, sources=None, prev=None, write_sig=True, documents=(), model=MODEL,
             transcription=None):
        sig = self.signature(name, spec, hint=hint, fallback=fallback, model=model)
        ref = f"meeting-recordings/2026/11/2026-11-20--{name}"
        if write_sig:
            self.store.write_signature(model.id, sig, record={"workspace": WS, "record": ref})
        labels = sorted(spec)
        turns = []
        for j, l in enumerate(labels):
            for k, w in enumerate(sig["labels"][l]["windows"]):
                turns.append((w["start"], l, sentence(j, k)))
        turns.sort()
        lines = [f"[{int(t) // 60:02d}:{int(t) % 60:02d}] Speaker {l.split('_')[1]}: {text}" for t, l, text in turns]
        body = f"# {name}\n\n## Transcript\n\n" + "\n\n".join(lines) + "\n"
        if transcription is not None:
            t = transcription
        else:
            t = {"generated": "2026-11-20", "diarization_id": sig["diarization"]["id"], "speakers": dict(speakers or {})}
            if hint:
                t["speakers_hint"] = hint
            if fallback:
                t["diarization_fallback"] = fallback
            if sources:
                t["speaker_sources"] = copy.deepcopy(sources)
            if prev:
                t["previous_speakers"] = copy.deepcopy(prev)
        fm = {"name": f"Northwind {name}", "date": "2026-11-20", "fingerprint": "sha256:" + sig["audio"],
              "transcription": t}
        if meeting:
            fm["meeting"] = f"meetings/2026/11/2026-11-20--{name}"
        path = str(self.ws / "data" / "meeting-recordings" / "2026" / "11" / f"2026-11-20--{name}.meeting-recording.md")
        self.records.write(path, fm, body)
        cands = [{"person": r, "name": NAMES[r], "kind": "user" if r.startswith("users/") else "contact"}
                 for r in (attendees if meeting else (DANA_REF, TOM_REF, PRIYA_REF, SAM_REF))]
        if meeting and DANA_REF in attendees:
            cands[list(attendees).index(DANA_REF)]["you"] = True
        ctx = dict(copy.deepcopy(BASE), record=ref, record_path=path, audio=None, fingerprint="sha256:" + sig["audio"],
                   diarization_id=sig["diarization"]["id"],
                   meeting=({"ref": fm["meeting"], "name": f"Northwind {name}", "date": "2026-11-20", "location": None}
                            if meeting else None),
                   candidates=cands, attendee_count=len(cands) if meeting else None,
                   attendee_count_certain=certain if meeting else False, documents=list(documents))
        return Rec(name, path, ref, ctx, sig["audio"], sig["diarization"]["id"], sig)

    def two(self, name, a=DANA, b=SAM, **kw):
        return self.make(name, {"speaker_0": lab(a, f"{name}:a"), "speaker_1": lab(b, f"{name}:b")}, **kw)

    # -- the verb -------------------------------------------------------------------------------------
    def cli(self, *args, recs=(), ctx=None, active=ACTIVE, skill_dir=None, compute=None, store_=None):
        if ctx is None:
            ctx = recs[0].ctx if len(recs) == 1 else dict(copy.deepcopy(BASE), records=[r.ctx for r in recs])
        cf = self.root / f"ctx-{self.tick}-{len(self.records.writes)}.json"
        cf.write_text(json.dumps(ctx), encoding="utf-8")
        outs = []
        code = identify.main(["identify", *args, "--context", str(cf)], skill_dir=skill_dir, read=self.records.read,
                             write=self.records.write, store=store_ if store_ is not None else self.store,
                             active=active, compute=compute, out=outs.append, now=self.now)
        self.outs = outs
        parsed = []
        for o in outs:
            try:
                parsed.append(json.loads(o))
            except ValueError:
                parsed.append(o)
        return code, parsed

    def identify(self, rec, **kw):
        code, outs = self.cli(rec.path, recs=[rec], **kw)
        self.assertEqual(code, 0, outs)
        return outs[0]["records"][0]

    def answer(self, rec, *pairs, **kw):
        code, outs = self.cli("--answer", rec.path, *pairs, recs=[rec], **kw)
        self.assertEqual(code, 0, outs)
        return outs[0]

    def question(self, *recs):
        code, outs = self.cli("--question", *[r.path for r in recs], recs=list(recs))
        self.assertEqual(code, 0, outs)
        return outs[0] if outs else None

    def shown(self, *recs):
        code, outs = self.cli("--shown", *[r.path for r in recs], recs=list(recs))
        self.assertEqual(code, 0, outs)
        return outs[0]

    def fm(self, rec):
        return self.records.fm(rec.path)

    def t(self, rec):
        return self.fm(rec)["transcription"]


# ======================================================================================================
# quotes (design section 22, left to the builder)

class Quotes(unittest.TestCase):
    """`quotes.pick`: the two least alike parts of a label (the groups of `vec.two_means`), the label's turn
    nearest each group's centre, 10 to 25 whole words, whole sentences where the timing allows."""

    def turns(self, n=12, label="speaker_0", other="speaker_1", text=None):
        out = []
        for k in range(n):
            out.append({"label": label, "start": 20.0 * k, "text": text(k) if text else sentence(0, k)})
            out.append({"label": other, "start": 20.0 * k + 10.0, "text": f"the other speaker says {k} words here now"})
        return out

    def test_the_two_quotes_come_from_the_two_least_alike_parts(self):
        # the first half of the windows is one voice, the second half another: one quote from each half
        ws = [{"start": 20.0 * k, "end": 20.0 * k + 6.0, "vector": v}
              for k, v in enumerate(vp_synth.windows(DANA, 6, seed="q-a") + vp_synth.windows(SAM, 6, seed="q-b"))]
        got = quotes.pick(ws, self.turns(), "speaker_0")
        self.assertEqual(len(got), 2)
        mins = sorted(int(q["at"].split(":")[0]) * 60 + int(q["at"].split(":")[1]) for q in got)
        self.assertLess(mins[0], 120)
        self.assertGreaterEqual(mins[1], 120)

    def test_quotes_are_10_to_25_whole_words_of_that_labels_turn(self):
        long_text = lambda k: ("We start with the budget. " * 3 + f"Then item {k} needs a decision before Friday. "
                               + "Everyone agrees with the plan for the launch. " * 3)
        ts = self.turns(text=long_text)
        ws = [{"start": 20.0 * k, "end": 20.0 * k + 6.0, "vector": v} for k, v in
              enumerate(vp_synth.windows(DANA, 12, seed="q-c"))]
        got = quotes.pick(ws, ts, "speaker_0")
        self.assertEqual(len(got), 2)
        mine = [t["text"] for t in ts if t["label"] == "speaker_0"]
        for q in got:
            words = q["text"].split()
            self.assertTrue(10 <= len(words) <= 25, q)
            self.assertTrue(any(q["text"] in t for t in mine), q)
            self.assertTrue(q["text"].endswith("."), q)          # whole sentences: the timing allows it here

    def test_a_sentence_longer_than_25_words_is_cut_to_25_whole_words(self):
        text = lambda k: " ".join(f"word{k}x{i}" for i in range(60))
        ts = self.turns(n=2, text=text)
        ws = [{"start": 0.0, "end": 6.0, "vector": DANA}, {"start": 20.0, "end": 26.0, "vector": SAM}]
        for q in quotes.pick(ws, ts, "speaker_0"):
            self.assertEqual(len(q["text"].split()), 25)
            src = next(t["text"] for t in ts if t["label"] == "speaker_0" and q["text"] in t["text"])
            self.assertTrue(set(q["text"].split()) <= set(src.split()))

    def test_never_a_word_of_another_label(self):
        ws = [{"start": 10.0, "end": 16.0, "vector": DANA}, {"start": 30.0, "end": 36.0, "vector": SAM}]
        for q in quotes.pick(ws, self.turns(n=3), "speaker_0"):
            self.assertNotIn("other speaker", q["text"])

    def test_hebrew_quotes_are_whole_words_of_that_speaker(self):
        shalom, all_, yes = "\u05e9\u05dc\u05d5\u05dd", "\u05dc\u05db\u05d5\u05dc\u05dd", "\u05db\u05df"
        he = lambda k: " ".join([shalom, all_, f"{k}"] * 5) + "."
        ts = []
        for k in range(4):
            ts.append({"label": "speaker_0", "start": 20.0 * k, "text": he(k)})
            ts.append({"label": "speaker_1", "start": 20.0 * k + 10, "text": (yes + " ") * 12})
        ws = [{"start": 20.0 * k, "end": 20.0 * k + 6, "vector": v} for k, v in
              enumerate(vp_synth.windows(DANA, 4, seed="q-he"))]
        got = quotes.pick(ws, ts, "speaker_0")
        self.assertTrue(got)
        for q in got:
            self.assertNotIn(yes, q["text"].split())
            self.assertTrue(10 <= len(q["text"].split()) <= 25)

    def test_timestamps_are_mm_ss(self):
        ts = [{"label": "speaker_0", "start": 3725.0, "text": sentence(0, 1)},
              {"label": "speaker_0", "start": 65.0, "text": sentence(0, 2)}]
        got = quotes.pick([], ts, "speaker_0")
        self.assertEqual([q["at"] for q in got], ["01:05", "62:05"])

    def test_with_no_windows_the_earliest_and_latest_turns(self):
        got = quotes.pick([], self.turns(n=5), "speaker_0")
        self.assertEqual([q["at"] for q in got], ["00:00", "01:20"])

    def test_no_turn_of_the_label_no_quote(self):
        self.assertEqual(quotes.pick([], self.turns(n=2), "speaker_7"), [])


# ======================================================================================================
# acceptance lines

class Line01(Harness):
    """On a recording of a two-person meeting whose two attendees both have a trusted voice print
    /identify-speakers writes the right name on each speaker label and marks each as named from a print with
    its score and as provisional"""

    def setUp(self):
        super().setUp()
        self.teach(DANA_REF, DANA)
        self.teach(SAM_REF, SAM)
        self.rec = self.two("weekly")

    def test_both_named_provisional_from_a_print_with_their_score(self):
        r = self.identify(self.rec)
        t = self.t(self.rec)
        self.assertEqual(t["speakers"], {"speaker_0": "Dana Oren", "speaker_1": "Sam Diaz"})
        for label, ref in (("speaker_0", DANA_REF), ("speaker_1", SAM_REF)):
            s = t["speaker_sources"][label]
            self.assertEqual((s["name"], s["person"], s["origin"], s["status"]), (NAMES[ref], ref, "print", "provisional"))
            self.assertGreaterEqual(s["score"], TH["accept"])
            self.assertLessEqual(s["score"], 1.0)
            self.assertGreaterEqual(s["margin"], TH["margin"])
            self.assertEqual(s["model"], MODEL.id)
            store.parse_instant(s["named"])
            self.assertEqual(s["seconds"], 120.0)
        self.assertEqual(t["identification"]["outcome"], "named")
        self.assertEqual(r["outcome"], "named")
        self.assertIn("Dana Oren", r["labels"]["speaker_0"])

    def test_the_record_holds_no_vector(self):
        self.identify(self.rec)
        self.assertFalse(numbers_in_a_list(self.fm(self.rec)))

    def test_identification_names_the_model_the_calibration_and_the_attendees(self):
        self.identify(self.rec)
        ident = self.t(self.rec)["identification"]
        self.assertEqual((ident["model"], ident["calibration"], ident["attendees"]), (MODEL.id, "shipped", 2))
        self.assertEqual(ident["generated"], "2026-11-20")


class Line02(Harness):
    """A voice that has no voice print keeps its Speaker N label and the run says, for that label, that no
    known voice matched — the nearest known attendee's name is not written on it"""

    def test_an_unknown_voice_keeps_its_label_and_the_run_says_no_known_voice_matched(self):
        self.teach(DANA_REF, DANA)
        self.teach(SAM_REF, SAM)
        rec = self.two("unknown", a=DANA, b=STRANGER)
        r = self.identify(rec)
        t = self.t(rec)
        self.assertNotIn("speaker_1", t["speakers"])
        self.assertNotIn("Sam Diaz", t["speakers"].values())
        self.assertIn("Speaker 1: no known voice matched", r["lines"])
        self.assertNotIn("proposed", t["speaker_questions"]["speaker_1"])
        self.assertEqual(r["labels"]["speaker_1"], "Speaker 1: no known voice matched")

    def test_with_no_meeting_too(self):
        self.teach(DANA_REF, DANA)
        rec = self.two("unknown-open", a=DANA, b=STRANGER, meeting=False)
        r = self.identify(rec)
        self.assertNotIn("speaker_1", self.t(rec)["speakers"])
        self.assertIn("Speaker 1: no known voice matched", r["lines"])


class Line03(Harness):
    """A recording diarised as one speaker whose meeting has two or more distinct attendees — whether the
    diariser collapsed or the run declared one speaker — gets no machine-written name and no question, and the
    record says why"""

    def setUp(self):
        super().setUp()
        self.teach(DANA_REF, DANA)

    def check(self, rec):
        r = self.identify(rec)
        t = self.t(rec)
        self.assertEqual(t["speakers"], {})
        self.assertFalse(t.get("speaker_questions"))
        self.assertEqual(t["identification"]["outcome"], "collapsed")
        self.assertTrue(any("--speakers 2" in x for x in t["identification"]["reports"]), t["identification"])
        self.assertEqual(self.fm(rec)["speaker_naming"], "closed")
        self.assertEqual(r["speaker_naming"], "closed")
        self.assertIsNone(self.question(rec))

    def test_a_fallback_to_one_speaker(self):
        rec = self.make("fell-back", {"speaker_0": lab(DANA, "fb", seconds=600.0)}, hint=None,
                        fallback="diariser exited -10; one speaker")
        self.check(rec)
        self.assertTrue(any("fell back" in x for x in self.t(rec)["identification"]["reports"]))

    def test_one_speaker_declared(self):
        rec = self.make("declared", {"speaker_0": lab(DANA, "dc", seconds=600.0)}, hint=1)
        self.check(rec)
        self.assertTrue(any("one speaker was declared" in x for x in self.t(rec)["identification"]["reports"]))


class Line04(Harness):
    """Two speaker labels that both resemble one person's voice print and do not resemble each other are both
    left unnamed and the record says a mixed diarisation is suspected"""

    def test_both_unnamed_and_a_mixed_diarisation_suspected(self):
        self.teach(DANA_REF, DANA)
        p = self.print_of(DANA_REF)["vector"]
        a, b = plane(p, STRANGER, 35.0), plane(p, STRANGER, -35.0)
        self.assertLess(vec.cos(a, b), TH["same"])
        rec = self.make("resemble", {"speaker_0": lab(a, "r-a", noise=0.05), "speaker_1": lab(b, "r-b", noise=0.05)},
                        attendees=(DANA_REF, PRIYA_REF))
        r = self.identify(rec)
        t = self.t(rec)
        self.assertEqual(t["speakers"], {})
        self.assertEqual(t["identification"]["outcome"], "mixed-suspected")
        self.assertTrue(any("mixed diarisation is suspected" in x for x in t["identification"]["reports"]))
        for label in ("speaker_0", "speaker_1"):
            self.assertIn(naming.MIXED, t["speaker_questions"][label]["flags"])
            self.assertNotIn("proposed", t["speaker_questions"][label])
        self.assertEqual(r["speaker_naming"], "waiting")


class Line05(Harness):
    """At the end of a run one question in the chat lists each unknown voice with two quotes and their
    timestamps and the meeting's attendees as the choices — and a user is never asked to run a labelling
    session"""

    def test_one_message_for_two_recordings_with_two_quotes_each_and_the_attendees(self):
        a = self.two("first-call")
        b = self.two("second-call", a=PRIYA, b=TOM, attendees=(PRIYA_REF, TOM_REF))
        self.identify(a)
        self.identify(b)
        msg = self.question(a, b)
        self.assertEqual(len(self.outs), 1)                       # one message
        text = msg["message"]
        self.assertIn("Northwind first-call", text)
        self.assertIn("Northwind second-call", text)
        self.assertEqual(text.count("Who is this?"), 4)
        for tail in ("someone else", "these two quotes are different people", "nobody I can name", "skip"):
            self.assertEqual(text.count(tail), 4, tail)
        self.assertIn("Dana Oren (you)", text)
        self.assertIn("Sam Diaz", text)
        self.assertIn("Priya Raman", text)
        self.assertTrue(text.rstrip().endswith(identify.STORE_LINE))
        self.assertEqual(text.count(identify.STORE_LINE), 1)
        # two quotes with timestamps for every label, each whole words of that label's turns
        body = self.records.read(a.path)[1]
        for rec_q in msg["records"]:
            for q in rec_q["labels"]:
                self.assertEqual(len(q["quotes"]), 2, q)
                for x in q["quotes"]:
                    self.assertRegex(x["at"], r"^\d{2,}:\d{2}$")
                    self.assertTrue(10 <= len(x["text"].split()) <= 25)
                    self.assertIn(f'[{x["at"]}] "{x["text"]}"', text)
        mine = [ln for ln in body.splitlines() if "] Speaker 0:" in ln]
        q0 = msg["records"][0]["labels"][0]
        self.assertEqual(q0["label"], "speaker_0")
        for x in q0["quotes"]:
            self.assertTrue(any(f"[{x['at']}] Speaker 0: {x['text']}" in ln for ln in mine), x)

    def test_the_proposal_is_the_first_choice(self):
        self.teach(DANA_REF, DANA)
        rec = self.two("proposal-first")
        self.identify(rec)
        msg = self.question(rec)
        q = msg["records"][0]["labels"]
        sam = next(x for x in q if x["label"] == "speaker_1")
        self.assertEqual(sam["choices"][0]["answer"], f"speaker_1={SAM_REF}")
        self.assertIn("Sam Diaz (the only attendee left)", msg["message"])

    def test_nothing_open_gives_no_message(self):
        rec = self.two("all-answered")
        self.identify(rec)
        self.answer(rec, f"speaker_0={DANA_REF}", f"speaker_1={SAM_REF}")
        self.assertIsNone(self.question(rec))
        self.assertEqual(self.outs, [])

    def test_no_labelling_session_is_asked_for(self):
        rec = self.two("no-session")
        self.identify(rec)
        text = self.question(rec)["message"]
        self.assertNotIn("labelling", text.lower())
        self.assertNotIn("label ", text)
        self.assertNotIn("evaluate-speakers", text)


class Line06(Harness):
    """A user's answer to that question writes the name on the transcript as confirmed; on the user's next
    recording a voice that matches that person's voice print is proposed as them; and once a second confirmed
    recording of theirs has matched the first, with at least a minute of their speech across the two, that
    person is written without asking, as provisional — while two confirmed recordings that do not match each
    other leave them proposed, never written"""

    def first(self):
        rec = self.two("rec1")
        self.identify(rec)
        out = self.answer(rec, f"speaker_0={DANA_REF}", f"speaker_1={SAM_REF}")
        return rec, out

    def test_the_answer_writes_the_names_as_confirmed(self):
        rec, out = self.first()
        t = self.t(rec)
        self.assertEqual(t["speakers"], {"speaker_0": "Dana Oren", "speaker_1": "Sam Diaz"})
        for label in ("speaker_0", "speaker_1"):
            self.assertEqual((t["speaker_sources"][label]["origin"], t["speaker_sources"][label]["status"]),
                             ("hand", "confirmed"))
        self.assertFalse(t.get("speaker_questions"))
        self.assertEqual(self.fm(rec)["speaker_naming"], "named")
        self.assertIn("Stored a voice print for Dana Oren", out["reply"])
        self.assertEqual(self.print_of(DANA_REF)["trust"], "proposing")

    def test_the_next_recording_proposes_them(self):
        self.first()
        rec2 = self.two("rec2")
        self.identify(rec2)
        t = self.t(rec2)
        self.assertEqual(t["speakers"], {})
        self.assertEqual(t["speaker_questions"]["speaker_0"]["proposed"]["person"], DANA_REF)
        self.assertEqual(t["speaker_questions"]["speaker_0"]["proposed"]["origin"], "print")

    def test_a_second_matching_confirmed_recording_makes_them_written_as_provisional(self):
        self.first()
        rec2 = self.two("rec2")
        self.identify(rec2)
        self.answer(rec2, f"speaker_0={DANA_REF}", f"speaker_1={SAM_REF}")
        self.assertEqual(self.print_of(DANA_REF)["trust"], "trusted")
        rec3 = self.two("rec3")
        self.identify(rec3)
        t = self.t(rec3)
        self.assertEqual(t["speakers"]["speaker_0"], "Dana Oren")
        self.assertEqual(t["speaker_sources"]["speaker_0"]["status"], "provisional")
        self.assertEqual(t["speaker_sources"]["speaker_0"]["origin"], "print")

    def test_two_confirmed_recordings_that_do_not_match_leave_them_proposed(self):
        self.first()
        rec2 = self.two("rec2-other", a=STRANGER)
        self.identify(rec2)
        out = self.answer(rec2, f"speaker_0={DANA_REF}")
        self.assertIn("kept aside", out["reply"])
        self.assertEqual(self.print_of(DANA_REF)["trust"], "proposing")
        rec3 = self.two("rec3-dana")
        self.identify(rec3)
        t = self.t(rec3)
        self.assertNotIn("speaker_0", t["speakers"])
        self.assertEqual(t["speaker_questions"]["speaker_0"]["proposed"]["person"], DANA_REF)


class Line07(Harness):
    """Confirming a contact's name on a speaker label that holds one voice and at least 20 seconds of their
    speech stores a voice print of that contact with no separate consent step, unless the user said that
    person's voice is never kept, and the reply names each person whose voice print was stored or changed"""

    def rec(self):
        # one voice, short turns, under 90% of the speech, unlike the other label and every print
        self.teach(TOM_REF, TOM)
        rec = self.two("contact", a=DANA, b=SAM)
        sig = rec.sig
        self.assertFalse(naming.long_turn("speaker_1", sig))
        self.assertFalse(naming.two_voices("speaker_1", sig, TH["split"]))
        self.identify(rec)
        return rec

    def test_a_contact_confirmed_on_a_one_voice_label_is_enrolled_and_named_in_the_reply(self):
        rec = self.rec()
        out = self.answer(rec, f"speaker_1={SAM_REF}")
        p = self.print_of(SAM_REF)
        self.assertIsNotNone(p)
        self.assertTrue(p["vector"])
        self.assertEqual([s["status"] for s in p["sources"]], ["admitted"])
        self.assertIn("Stored a voice print for Sam Diaz", out["reply"])
        self.assertNotIn("consent", out["reply"].lower())
        self.assertEqual(self.t(rec)["speakers"]["speaker_1"], "Sam Diaz")

    def test_unless_their_voice_is_never_kept(self):
        rec = self.rec()
        self.store.add_never({"workspace": WS, "person": SAM_REF, "name": "Sam Diaz", "at": "2026-11-10T10:00:00+02:00"})
        out = self.answer(rec, f"speaker_1={SAM_REF}")
        self.assertIsNone(self.print_of(SAM_REF))
        self.assertIn("Sam Diaz's voice is not kept", out["reply"])
        self.assertEqual(self.t(rec)["speakers"]["speaker_1"], "Sam Diaz")


class Line08(Harness):
    """Confirming a name on a speaker label in which a second voice holds at least a fifth of the speech, or
    that the user says holds different people, writes the name, stores no voice print from that label, and
    the reply says why"""

    def test_a_second_voice_of_a_fifth_is_named_and_not_enrolled(self):
        ws = vp_synth.mixed(DANA, PRIYA, 40, 0.2, seed="l8-mix")
        rec = self.make("fifth", {"speaker_0": lab(vectors=ws), "speaker_1": lab(SAM, "l8-sam")})
        self.assertTrue(naming.two_voices("speaker_0", rec.sig, 0.55))       # check 5 separates at split 0.55
        self.identify(rec)
        out = self.answer(rec, f"speaker_0={DANA_REF}")
        self.assertEqual(self.t(rec)["speakers"]["speaker_0"], "Dana Oren")
        p = self.print_of(DANA_REF)
        self.assertFalse(p and p.get("vector"))
        self.assertFalse(any(s["status"] == "admitted" for s in (p or {}).get("sources") or []))
        self.assertIn("second voice", out["reply"])

    def test_different_names_nothing_and_flags_the_label_mixed(self):
        rec = self.two("different")
        self.identify(rec)
        out = self.answer(rec, "speaker_1=different")
        t = self.t(rec)
        self.assertNotIn("speaker_1", t["speakers"])
        q = t["speaker_questions"]["speaker_1"]
        self.assertEqual(q["closed"], "different")
        self.assertIn(naming.MIXED, q["flags"])
        self.assertIn("--speakers", out["reply"])
        self.assertIsNone(self.print_of(SAM_REF))

    def test_a_name_given_with_different_is_written_and_not_enrolled(self):
        rec = self.two("different-named")
        self.identify(rec)
        out = self.answer(rec, f"speaker_0=different:{DANA_REF}")
        t = self.t(rec)
        self.assertEqual(t["speakers"]["speaker_0"], "Dana Oren")
        self.assertEqual(t["speaker_sources"]["speaker_0"]["status"], "confirmed")
        p = self.print_of(DANA_REF)
        self.assertFalse(p and p.get("vector"))
        self.assertIn("you said it holds different people", out["reply"])


class Line09(Harness):
    """A recording diarised into two or more speaker labels in which one label holds an unbroken turn of more
    than five minutes stores no voice print from that label, whether or not a meeting is linked"""

    def check(self, meeting):
        rec = self.make("long-turn" + ("" if meeting else "-open"),
                        {"speaker_0": lab(DANA, "l9-d", seconds=400.0, longest=360.0), "speaker_1": lab(SAM, "l9-s")},
                        meeting=meeting)
        self.identify(rec)
        out = self.answer(rec, f"speaker_0={DANA_REF}")
        self.assertEqual(self.t(rec)["speakers"]["speaker_0"], "Dana Oren")   # the name IS written
        p = self.print_of(DANA_REF)
        self.assertFalse(p and p.get("vector"))
        self.assertIn("a turn over five minutes", out["reply"])

    def test_with_a_meeting(self):
        self.check(True)

    def test_without_a_meeting(self):
        self.check(False)


class Line10(Harness):
    """When one voice and one attendee are left unnamed that attendee is proposed for the voice and no name
    is written until a person answers"""

    def setUp(self):
        super().setUp()
        self.teach(DANA_REF, DANA)
        self.rec = self.two("elimination")
        self.identify(self.rec)

    def test_the_only_attendee_left_is_proposed_not_written(self):
        t = self.t(self.rec)
        self.assertEqual(t["speakers"], {"speaker_0": "Dana Oren"})
        self.assertEqual(t["speaker_questions"]["speaker_1"]["proposed"],
                         {"person": SAM_REF, "name": "Sam Diaz", "origin": "attendees", "why": "the only attendee left"})

    def test_the_answer_writes_it_proposed_by_attendees(self):
        self.answer(self.rec, f"speaker_1={SAM_REF}")
        s = self.t(self.rec)["speaker_sources"]["speaker_1"]
        self.assertEqual((s["status"], s["origin"], s["proposed_by"]), ("confirmed", "hand", "attendees"))


class Line15(Harness):
    """A name a person typed or confirmed is never replaced by identification — a disagreement is reported,
    and that speaker label's name and its source are unchanged"""

    def setUp(self):
        super().setUp()
        self.teach(SAM_REF, SAM)

    def test_a_typed_name_is_never_replaced_and_the_disagreement_is_reported(self):
        rec = self.two("typed", a=SAM, b=PRIYA, speakers={"speaker_0": "Dana Oren"})
        r = self.identify(rec)
        t = self.t(rec)
        self.assertEqual(t["speakers"]["speaker_0"], "Dana Oren")
        self.assertNotIn("speaker_0", t.get("speaker_sources") or {})
        self.assertTrue(any("named Dana Oren on the record but its voice matches Sam Diaz" in x for x in r["lines"]), r)

    def test_a_confirmed_name_and_its_source_are_unchanged(self):
        src = {"name": "Dana Oren", "person": DANA_REF, "origin": "hand", "status": "confirmed",
               "named": "2026-11-01T10:00:00+02:00"}
        rec = self.two("confirmed", a=SAM, b=PRIYA, speakers={"speaker_0": "Dana Oren"}, sources={"speaker_0": src})
        r = self.identify(rec)
        t = self.t(rec)
        self.assertEqual(t["speakers"]["speaker_0"], "Dana Oren")
        self.assertEqual(t["speaker_sources"]["speaker_0"], src)
        self.assertTrue(any("its voice matches Sam Diaz" in x for x in r["lines"]))


class Line16(Harness):
    """Reverting identification on a record removes every provisional machine-written name and leaves every
    confirmed name in place"""

    def setUp(self):
        super().setUp()
        self.teach(DANA_REF, DANA)

    def test_revert_removes_every_provisional_name_and_keeps_confirmed_and_unverified(self):
        src = {"name": "Priya Raman", "person": PRIYA_REF, "origin": "hand", "status": "confirmed",
               "named": "2026-11-01T10:00:00+02:00"}
        rec = self.make("revert", {"speaker_0": lab(DANA, "rv-d"), "speaker_1": lab(PRIYA, "rv-p"),
                                   "speaker_2": lab(TOM, "rv-t")},
                        hint=3, attendees=(DANA_REF, PRIYA_REF, TOM_REF),
                        speakers={"speaker_1": "Priya Raman", "speaker_2": "Tom Whitfield"}, sources={"speaker_1": src})
        self.identify(rec)
        self.assertEqual(self.t(rec)["speaker_sources"]["speaker_0"]["status"], "provisional")
        code, outs = self.cli("--revert", rec.path, recs=[rec])
        self.assertEqual(code, 0, outs)
        fm = self.fm(rec)
        t = fm["transcription"]
        self.assertEqual(t["speakers"], {"speaker_1": "Priya Raman", "speaker_2": "Tom Whitfield"})
        self.assertEqual(t["speaker_sources"], {"speaker_1": src})
        self.assertNotIn("speaker_questions", t)
        self.assertNotIn("identification", t)
        self.assertNotIn("speaker_naming", fm)

    def test_revert_for_one_person_across_the_workspace(self):
        a = self.two("revert-a", a=DANA, b=STRANGER)
        b = self.two("revert-b", a=DANA, b=vp_synth.voice("id-stranger-2"))
        self.identify(a)
        self.identify(b)
        rows = [{"record": r.ref, "record_path": r.path, "matches": [{"label": "speaker_0", "where": "speaker_sources"}]}
                for r in (a, b)]
        ctx = dict(copy.deepcopy(BASE), person={"ref": DANA_REF, "name": "Dana Oren"}, person_records=rows)
        code, outs = self.cli("--revert", "--person", DANA_REF, ctx=ctx)
        self.assertEqual(code, 0, outs)
        for r in (a, b):
            t = self.t(r)
            self.assertNotIn("speaker_0", t["speakers"])
            self.assertNotIn("speaker_0", t.get("speaker_sources") or {})
            self.assertNotIn("speaker_naming", self.fm(r))


class Line17(Harness):
    """On a fresh install, with no evaluation run on that machine, a person whose voice print became trusted
    through the user's own confirmations is named using the calibration shipped with the module"""

    DIM = 512

    def setUp(self):
        super().setUp()
        self.skill = self.root / "skill"
        shutil.copytree(str(SKILL), str(self.skill), ignore=shutil.ignore_patterns("__pycache__", ".venv"))
        e = models.entry(models.DEFAULT_MODEL)
        self.pin = store.Model(e["id"], e["sha256"], e["dim"])
        self.assertEqual(self.pin.dim, self.DIM)
        cal = self.skill / "calibration"
        cal.mkdir(exist_ok=True)
        self.file = cal / f"{e['id']}.json"
        self.file.write_text(json.dumps({
            "version": 1, "model": {"id": e["id"], "sha256": e["sha256"], "dim": e["dim"]}, "thresholds": TH,
            "print_closed": "auto", "print_open": "auto", "elimination": "propose", "split_weak": False,
            "counts": {"recordings": 14, "people": 4, "genuine": 20, "impostor": 60, "written": 12, "wrong": 0},
            "bound": 0.25, "generated": "2026-11-16"}), encoding="utf-8")
        self.dana, self.sam = vp_synth.voice("id17-dana", self.DIM), vp_synth.voice("id17-sam", self.DIM)
        # the store seeded with two trusted synthetic prints, made with the shipped model
        for ref, v in ((DANA_REF, self.dana), (SAM_REF, self.sam)):
            self.store.write_print(self.pin.id, {
                "version": 1, "id": "p-" + hashlib.sha256(ref.encode()).hexdigest()[:8],
                "known_as": [{"workspace": WS, "person": ref, "name": NAMES[ref]}],
                "model": {"id": self.pin.id, "sha256": self.pin.sha256, "dim": self.pin.dim},
                "vector": vp_synth.near(v, 0.95, seed=f"p17:{ref}"), "seconds": 240.0, "trust": "trusted",
                "auto": True, "sources": [], "negatives": []})
        self.rec = self.make("fresh", {"speaker_0": lab(self.dana, "f17-d", n=12), "speaker_1": lab(self.sam, "f17-s", n=12)},
                             model=self.pin)

    def test_a_fresh_install_names_with_the_shipped_calibration(self):
        self.identify(self.rec, active=None, skill_dir=str(self.skill))
        t = self.t(self.rec)
        self.assertEqual(t["speakers"], {"speaker_0": "Dana Oren", "speaker_1": "Sam Diaz"})
        self.assertEqual(t["identification"]["calibration"], "shipped")

    def test_with_the_file_removed_it_writes_none(self):
        self.file.unlink()
        self.identify(self.rec, active=None, skill_dir=str(self.skill))
        t = self.t(self.rec)
        self.assertEqual(t["speakers"], {})
        self.assertEqual(t["speaker_questions"]["speaker_0"]["proposed"]["person"], DANA_REF)


class Line18(Harness):
    """With no calibration for the active speaker model — neither shipped with the module nor measured locally —
    identification writes no name"""

    def setUp(self):
        super().setUp()
        self.teach(DANA_REF, DANA)
        self.teach(SAM_REF, SAM)
        self.active = dict(ACTIVE, calib=None, source=None)

    def test_no_calibration_writes_no_name_and_proposes(self):
        rec = self.two("uncalibrated")
        r = self.identify(rec, active=self.active)
        t = self.t(rec)
        self.assertEqual(t["speakers"], {})
        self.assertEqual(t["speaker_questions"]["speaker_0"]["proposed"]["person"], DANA_REF)
        self.assertTrue(any("no calibration" in x for x in r["lines"]))
        self.assertEqual(t["identification"]["calibration"], "none")

    def test_an_answer_without_calibration_is_remembered_and_builds_no_print(self):
        rec = self.two("uncalibrated-answer", a=PRIYA, b=TOM, attendees=(PRIYA_REF, TOM_REF))
        self.identify(rec, active=self.active)
        out = self.answer(rec, f"speaker_0={PRIYA_REF}", active=self.active)
        p = self.print_of(PRIYA_REF)
        self.assertEqual([s["status"] for s in p["sources"]], ["uncalibrated"])
        self.assertFalse(p["vector"])
        self.assertIn("calibration", out["reply"])


class Line23(Harness):
    """A name written from a voice print is shown to the user with two quotes from that speaker label and their
    timestamps, in the end-of-run message, before it can be confirmed"""

    def setUp(self):
        super().setUp()
        self.teach(DANA_REF, DANA)
        self.rec = self.two("shown-first", a=DANA, b=STRANGER)
        self.identify(self.rec)

    def test_the_unconfirmed_name_is_in_the_message_with_two_quotes(self):
        msg = self.question(self.rec)
        text = msg["message"]
        self.assertIn(identify.UNCONFIRMED_HEAD, text)
        line = next(ln for ln in text.splitlines() if ln.startswith("**Speaker 0 → Dana Oren**"))
        self.assertEqual(line.count('] "'), 2)
        self.assertRegex(line, r"\([01]\.\d\d\)")
        un = next(x for x in msg["records"][0]["labels"] if x["label"] == "speaker_0")
        self.assertEqual(un["kind"], "unconfirmed")
        self.assertEqual(len(un["quotes"]), 2)

    def test_confirm_prints_the_two_quotes_first(self):
        self.question(self.rec)
        self.shown(self.rec)
        code, outs = self.cli("--confirm", self.rec.path, "speaker_0", recs=[self.rec])
        self.assertEqual(code, 0, outs)
        reply = outs[0]["reply"]
        quotes_at = reply.index('] "')
        self.assertLess(quotes_at, reply.index("confirmed"))
        s = self.t(self.rec)["speaker_sources"]["speaker_0"]
        self.assertEqual((s["status"], s["origin"], s["proposed_by"]), ("confirmed", "hand", "print"))

    # review round 1, `confirm-needs-no-shown-question` (decision ...-task-9-confirm-only-what-was-shown): a label
    # is confirmed only when `speaker_questions.<label>.shown` is stamped
    def test_confirm_of_a_name_never_shown_prints_its_quotes_and_confirms_nothing(self):
        before = len(self.print_of(DANA_REF)["sources"])
        for args in (("speaker_0",), ()):                    # named, and bare
            code, outs = self.cli("--confirm", self.rec.path, *args, recs=[self.rec])
            self.assertEqual(code, 0, outs)
            reply = outs[0]["reply"]
            self.assertIn("**Speaker 0 → Dana Oren** — [", reply)
            self.assertEqual(reply.count('] "'), 2)
            self.assertIn("not confirmed", reply)
            self.assertIn("--shown", reply)
            self.assertNotIn("Dana Oren, confirmed", reply)
            t = self.t(self.rec)
            self.assertEqual(t["speaker_sources"]["speaker_0"]["status"], "provisional")
            self.assertIsNone(t["speaker_questions"]["speaker_0"].get("shown"))     # --confirm never stamps shown
            self.assertEqual(len(self.print_of(DANA_REF)["sources"]), before)

    def test_correct_on_a_name_never_shown_confirms_nothing(self):
        before = len(self.print_of(DANA_REF)["sources"])
        out = self.answer(self.rec, "speaker_0=correct")
        self.assertIn("not confirmed", out["reply"])
        self.assertEqual(self.t(self.rec)["speaker_sources"]["speaker_0"]["status"], "provisional")
        self.assertEqual(len(self.print_of(DANA_REF)["sources"]), before)
        self.shown(self.rec)
        out = self.answer(self.rec, "speaker_0=correct")
        self.assertIn("Speaker 0 → Dana Oren, confirmed.", out["reply"])
        self.assertEqual(self.t(self.rec)["speaker_sources"]["speaker_0"]["status"], "confirmed")
        self.assertEqual(len(self.print_of(DANA_REF)["sources"]), before + 1)

    def test_bare_confirm_confirms_only_the_names_that_were_shown(self):
        self.teach(SAM_REF, SAM)
        rec = self.two("shown-half")
        self.identify(rec)
        self.shown(rec)
        fm, body = self.records.read(rec.path)
        del fm["transcription"]["speaker_questions"]["speaker_1"]["shown"]
        self.records.write(rec.path, fm, body)
        code, outs = self.cli("--confirm", rec.path, recs=[rec])
        self.assertEqual(code, 0, outs)
        t = self.t(rec)
        self.assertEqual(t["speaker_sources"]["speaker_0"]["status"], "confirmed")
        self.assertEqual(t["speaker_sources"]["speaker_1"]["status"], "provisional")
        self.assertIn("Speaker 0 → Dana Oren, confirmed.", outs[0]["reply"])
        self.assertIn("**Speaker 1 → Sam Diaz** — [", outs[0]["reply"])

    def test_unverified_names_are_offered_with_two_quotes_and_confirmed_once_shown(self):
        rec = self.two("unverified-offer", speakers={"speaker_0": "Dana Oren"})
        self.identify(rec)
        msg = self.question(rec)
        text = msg["message"]
        self.assertIn("1 name here was not confirmed by you; confirm it to teach the voice?", text)
        line = next(ln for ln in text.splitlines() if ln.startswith("**Speaker 0 → Dana Oren**"))
        self.assertEqual(line.count('] "'), 2)
        un = next(x for x in msg["records"][0]["labels"] if x["label"] == "speaker_0")
        self.assertEqual((un["kind"], len(un["quotes"])), ("unverified", 2))
        self.assertEqual(un["choices"][0]["answer"], "speaker_0=correct")
        self.assertEqual(self.fm(rec)["speaker_naming"], "waiting")          # speaker_1 is still asked
        self.shown(rec)
        q0 = self.t(rec)["speaker_questions"]["speaker_0"]
        store.parse_instant(q0["shown"])
        self.assertEqual(q0["quotes"], un["quotes"])                          # the quotes that were shown
        code, outs = self.cli("--confirm", rec.path, recs=[rec])
        self.assertEqual(code, 0, outs)
        s = self.t(rec)["speaker_sources"]["speaker_0"]
        self.assertEqual((s["status"], s["person"]), ("confirmed", DANA_REF))
        self.assertEqual([x["status"] for x in self.print_of(DANA_REF)["sources"]], ["admitted"] * 3)  # 2 taught + this
        again = self.question(rec)
        self.assertNotIn("Speaker 0 → Dana Oren", (again or {}).get("message") or "")


class Line25(Harness):
    """After a user says a person's voice is never to be kept (`prints never <person>`), that person's voice
    print is gone as after forgetting, and confirming their name on a later recording writes the name, stores no
    voice print, and the reply says their voice is not kept"""

    def test_confirming_a_never_person_writes_the_name_stores_nothing_and_says_so(self):
        self.store.add_never({"workspace": WS, "person": DANA_REF, "name": "Dana Oren", "at": "2026-11-10T10:00:00+02:00"})
        rec = self.two("never")
        self.identify(rec)
        out = self.answer(rec, f"speaker_0={DANA_REF}")
        self.assertEqual(self.t(rec)["speakers"]["speaker_0"], "Dana Oren")
        self.assertIsNone(self.print_of(DANA_REF))
        self.assertIn("Dana Oren's voice is not kept", out["reply"])


class Line26(Harness):
    """A speaker label that holds an unbroken turn of more than five minutes, in a recording diarised into two or
    more labels, gets no machine-written name even when it matches a trusted voice print, and the end-of-run
    question asks about it saying the label may hold more than one voice"""

    def test_no_name_and_asked_may_hold_more_than_one_voice(self):
        self.teach(DANA_REF, DANA)
        rec = self.make("six-minutes", {"speaker_0": lab(DANA, "l26-d", seconds=420.0, longest=360.0),
                                        "speaker_1": lab(SAM, "l26-s")})
        self.identify(rec)
        t = self.t(rec)
        self.assertNotIn("speaker_0", t["speakers"])
        self.assertIn(naming.VOICES, t["speaker_questions"]["speaker_0"]["flags"])
        text = self.question(rec)["message"]
        block = text[text.index("**Speaker 0**"):text.index("**Speaker 1**")]
        self.assertIn("may hold more than one voice", block)


class Line29(Harness):
    """Two speaker labels of a two-attendee recording whose voices resemble each other get no machine-written name
    on either, and the record says a mixed diarisation is suspected"""

    def test_two_alike_labels_are_not_named(self):
        self.teach(DANA_REF, DANA)
        rec = self.make("alike", {"speaker_0": lab(DANA, "l29-a"), "speaker_1": lab(vp_synth.near(DANA, 0.9, seed="l29"), "l29-b")})
        self.identify(rec)
        t = self.t(rec)
        self.assertEqual(t["speakers"], {})
        self.assertEqual(t["identification"]["outcome"], "mixed-suspected")
        self.assertTrue(any("mixed diarisation is suspected" in x for x in t["identification"]["reports"]))
        for label in ("speaker_0", "speaker_1"):
            self.assertIn(naming.MIXED, t["speaker_questions"][label]["flags"])


class Line32(Harness):
    """A name on a record that no person confirmed — written before this feature, edited by hand, carried over by
    transcribing again, or written by the machine — stores no voice print"""

    def sources_of(self, ref):
        p = self.print_of(ref)
        return len((p or {}).get("sources") or [])

    def test_a_machine_written_name_stores_no_print(self):
        self.teach(DANA_REF, DANA)
        before = self.sources_of(DANA_REF)
        rec = self.two("machine", a=DANA, b=STRANGER)
        self.identify(rec)
        self.shown(rec)
        self.assertEqual(self.t(rec)["speaker_sources"]["speaker_0"]["status"], "provisional")
        self.assertEqual(self.sources_of(DANA_REF), before)

    def test_a_name_written_before_the_feature_or_edited_by_hand_stores_no_print(self):
        edited = {"name": "Sam D.", "person": SAM_REF, "origin": "hand", "status": "confirmed",
                  "named": "2026-11-01T10:00:00+02:00"}
        rec = self.two("legacy", speakers={"speaker_0": "Dana Oren", "speaker_1": "Sam Diaz"},
                       sources={"speaker_1": edited})
        self.identify(rec)
        self.shown(rec)
        self.assertIsNone(self.print_of(DANA_REF))
        self.assertIsNone(self.print_of(SAM_REF))
        self.assertEqual(self.fm(rec)["speaker_naming"], "named")

    def test_a_carried_name_stores_no_print(self):
        prev = {"diarization_id": "0123456789ab", "labels": {
            "speaker_0": {"name": "Dana Oren", "new_label": "speaker_0", "share": 1.0, "offered": True}}}
        rec = self.two("carried", prev=prev)
        self.identify(rec)
        self.shown(rec)
        self.assertEqual(self.t(rec)["speaker_questions"]["speaker_0"]["proposed"]["origin"], "carried")
        self.assertIsNone(self.print_of(DANA_REF))


class Line33(Harness):
    """A confirmed recording that does not match a person's trusted voice print never stops that print writing
    names, and the reply says the recording was kept aside"""

    def test_a_non_matching_confirmation_is_kept_aside_and_the_print_still_writes(self):
        self.teach(DANA_REF, DANA)
        rec = self.two("mismatch", a=STRANGER, b=SAM)
        self.identify(rec)
        out = self.answer(rec, f"speaker_0={DANA_REF}")
        self.assertIn("kept aside", out["reply"])
        p = self.print_of(DANA_REF)
        self.assertEqual((p["trust"], p["auto"]), ("trusted", True))
        nxt = self.two("after-mismatch")
        self.identify(nxt)
        self.assertEqual(self.t(nxt)["speakers"]["speaker_0"], "Dana Oren")


class Line36(Harness):
    """Transcribing again a recording that has names writes none of them, keeps them on the record, and
    /identify-speakers then offers each as a proposal on the speaker label that now holds most of that speaker's
    time; two earlier names on one label are not offered"""

    def test_each_carried_name_is_proposed_on_the_label_that_now_holds_its_time(self):
        src = {"name": "Dana Oren", "person": DANA_REF, "origin": "hand", "status": "confirmed",
               "named": "2026-08-01T10:00:00+02:00"}
        prev = {"diarization_id": "0123456789ab", "labels": {
            "speaker_0": {"name": "Dana Oren", "source": src, "new_label": "speaker_1", "share": 1.0, "offered": True},
            "speaker_1": {"name": "Sam Diaz", "new_label": "speaker_0", "share": 0.9, "offered": True}}}
        rec = self.two("again", a=SAM, b=DANA, prev=prev)
        self.identify(rec)
        t = self.t(rec)
        self.assertEqual(t["speakers"], {})
        self.assertEqual(t["speaker_questions"]["speaker_1"]["proposed"],
                         {"person": DANA_REF, "name": "Dana Oren", "origin": "carried", "why": identify.CARRIED_WHY})
        self.assertEqual(t["speaker_questions"]["speaker_0"]["proposed"]["person"], SAM_REF)
        self.assertEqual(t["speaker_questions"]["speaker_0"]["proposed"]["origin"], "carried")
        self.assertEqual(t["previous_speakers"], prev)          # kept on the record
        self.assertEqual(self.fm(rec)["speaker_naming"], "waiting")

    def test_two_earlier_names_on_one_label_are_not_offered(self):
        prev = {"diarization_id": "0123456789ab", "labels": {
            "speaker_0": {"name": "Dana Oren", "new_label": "speaker_0", "share": 1.0, "offered": False},
            "speaker_1": {"name": "Sam Diaz", "new_label": "speaker_0", "share": 1.0, "offered": False}}}
        rec = self.two("two-on-one", prev=prev)
        self.identify(rec)
        for q in self.t(rec)["speaker_questions"].values():
            self.assertNotIn("proposed", q)

    def test_the_answer_to_a_carried_proposal_records_it(self):
        prev = {"diarization_id": "0123456789ab", "labels": {
            "earlier:speaker_3": {"name": "Dana Oren", "new_label": "speaker_0", "share": 1.0, "offered": True}}}
        rec = self.two("carried-answer", prev=prev)
        self.identify(rec)
        self.answer(rec, f"speaker_0={DANA_REF}")
        self.assertEqual(self.t(rec)["speaker_sources"]["speaker_0"]["proposed_by"], "carried")


class Line38(Harness):
    """When identification finds on one label the voice of a person whose name is already on another label of
    the record, it writes no name, reports the disagreement and asks"""

    def test_no_name_a_report_and_a_question(self):
        self.teach(DANA_REF, DANA)
        src = {"name": "Dana Oren", "person": DANA_REF, "origin": "hand", "status": "confirmed",
               "named": "2026-11-01T10:00:00+02:00"}
        rec = self.two("conflict", a=SAM, b=DANA, speakers={"speaker_0": "Dana Oren"}, sources={"speaker_0": src})
        r = self.identify(rec)
        t = self.t(rec)
        self.assertEqual(t["speakers"], {"speaker_0": "Dana Oren"})
        self.assertIn(naming.CONFLICT + "speaker_0", t["speaker_questions"]["speaker_1"]["flags"])
        self.assertTrue(any("already named on Speaker 0" in x for x in r["lines"]))
        text = self.question(rec)["message"]
        self.assertIn("conflicts with Speaker 0", text)


class Line39(Harness):
    """After the end-of-run answer names a speaker, every document the run wrote from that transcript is either
    written again or listed in the run's report as written before the name"""

    def test_the_reply_lists_the_documents_written_before_the_names(self):
        docs = [{"ref": "meeting-summaries/2026/11/2026-11-20--northwind-docs", "kind": "summary", "created": "2026-11-20"},
                {"ref": "meeting-analyses/2026/11/2026-11-20--northwind-docs", "kind": "analysis", "created": "2026-11-20"},
                {"ref": "tasks/2026-11-20--send-the-file", "kind": "task", "created": "2026-11-20"}]
        rec = self.two("docs", documents=docs)
        self.identify(rec)
        out = self.answer(rec, f"speaker_0={DANA_REF}")
        for d in docs:
            self.assertIn(d["ref"], out["reply"])
        self.assertIn("before", out["reply"])

    def test_no_name_written_no_document_listed(self):
        docs = [{"ref": "meeting-summaries/2026/11/2026-11-20--northwind-skip", "kind": "summary", "created": "2026-11-20"}]
        rec = self.two("docs-skip", documents=docs)
        self.identify(rec)
        out = self.answer(rec, "speaker_0=skip")
        self.assertNotIn(docs[0]["ref"], out["reply"])


class Line40(Harness):
    """On a recording transcribed before this feature /identify-speakers writes no name and asks no question,
    says it has to be transcribed again before its voices can be named or confirmed, and is not offered for that
    recording again"""

    def pre_feature(self):
        t = {"generated": "2026-08-01", "diarization": "sherpa-onnx", "speakers": {"speaker_0": "Dana Oren", "speaker_1": "Sam Diaz"}}
        return self.two("pre-feature", transcription=t, write_sig=False)

    def test_closed_needs_retranscription_and_the_message(self):
        rec = self.pre_feature()
        before = copy.deepcopy(self.t(rec))
        r = self.identify(rec)
        fm = self.fm(rec)
        self.assertEqual(fm["speaker_naming"], "closed")
        t = fm["transcription"]
        self.assertEqual(t["identification"]["outcome"], "needs-retranscription")
        self.assertEqual(t["speakers"], before["speakers"])
        self.assertNotIn("speaker_questions", t)
        self.assertIn(identify.PRE_FEATURE, r["lines"])
        self.assertIsNone(self.question(rec))

    def test_transcribed_again_it_is_offered_again_and_proposes_the_carried_names(self):
        import transcribe_meeting as tm
        rec = self.pre_feature()
        self.identify(rec)
        segs = [{"speaker": "speaker_0", "start": 0.0, "end": 60.0}, {"speaker": "speaker_1", "start": 60.0, "end": 120.0}]
        body = "## Transcript\n\n[00:00] Speaker 1: good morning everyone\n\n[01:00] Speaker 0: thanks for having me\n"
        fm, _ = self.records.read(rec.path)
        self.records.write(rec.path, fm, body)
        cache = str(self.root / "cache.asr.json")
        words = [{"start": float(i), "end": i + 0.8, "text": " word"} for i in range(120)]
        patches = {
            "choose_engine": lambda requested: ("cpu", None),
            "missing_models": lambda engine, num_speakers: [],
            "read_meeting": self.records.read, "write_meeting": self.records.write,
            "decode_audio": lambda src, dst: Path(dst).write_bytes(b"RIFF"),
            "diarize_safe": lambda wav, num_speakers=None: (copy.deepcopy(segs), None),
            "transcribe": lambda wav, language=None, engine="cpu": {"words": words, "language": ["en"], "duration": 120.0,
                                                                     "language_forced": language},
            "asr_cache_path_for": lambda p: cache,
        }
        audio = self.root / "clip.m4a"
        audio.write_bytes(b"synthetic bytes")
        with contextlib.ExitStack() as stack:
            for k, v in patches.items():
                stack.enter_context(mock.patch.object(tm, k, v))
            stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            stack.enter_context(contextlib.redirect_stderr(io.StringIO()))
            tm.run(rec.path, str(audio), "2026-11-21", num_speakers=2, language="en", engine="cpu", context=None)
        fm = self.fm(rec)
        self.assertNotIn("speaker_naming", fm)                       # run clears it: offered again
        diar = fm["transcription"]["diarization_id"]
        sig = self.signature("pre-feature-again", {"speaker_0": lab(SAM, "l40-s"), "speaker_1": lab(DANA, "l40-d")})
        sig["audio"], sig["diarization"]["id"] = rec.audio, diar
        self.store.write_signature(MODEL.id, sig, record={"workspace": WS, "record": rec.ref})
        ctx = dict(rec.ctx, diarization_id=diar)
        code, outs = self.cli(rec.path, ctx=ctx)
        self.assertEqual(code, 0, outs)
        t = self.t(rec)
        self.assertEqual(t["speakers"], {})
        self.assertEqual(t["speaker_questions"]["speaker_1"]["proposed"]["name"], "Dana Oren")
        self.assertEqual(t["speaker_questions"]["speaker_0"]["proposed"]["name"], "Sam Diaz")
        self.assertEqual(self.fm(rec)["speaker_naming"], "waiting")


class Line41(Harness):
    """A recording whose machine-written names were never shown to a person is still offered for
    /identify-speakers by `dt next`, and one whose every voice was answered, shown, or closed by a person is not"""

    def setUp(self):
        super().setUp()
        self.teach(DANA_REF, DANA)
        self.teach(SAM_REF, SAM)

    def test_machine_names_of_an_unattended_run_are_waiting_until_shown(self):
        rec = self.two("unattended")
        r = self.identify(rec)
        self.assertEqual(r["speaker_naming"], "waiting")
        self.assertEqual(self.fm(rec)["speaker_naming"], "waiting")
        out = self.shown(rec)
        self.assertEqual(out["records"][0]["speaker_naming"], "named")
        t = self.t(rec)
        for label in ("speaker_0", "speaker_1"):
            store.parse_instant(t["speaker_questions"][label]["shown"])
        self.assertEqual(self.fm(rec)["speaker_naming"], "named")
        self.assertIsNone(self.question(rec))               # shown and unanswered: not asked again

    def test_a_skipped_label_stays_waiting_and_nobody_closes_it(self):
        rec = self.two("skipped", a=DANA, b=STRANGER)
        self.identify(rec)
        self.shown(rec)
        self.assertEqual(self.fm(rec)["speaker_naming"], "waiting")
        self.answer(rec, "speaker_1=skip")
        self.assertEqual(self.fm(rec)["speaker_naming"], "waiting")
        self.answer(rec, "speaker_1=nobody")
        self.assertEqual(self.fm(rec)["speaker_naming"], "named")
        self.assertEqual(self.t(rec)["speaker_questions"]["speaker_1"]["closed"], "nobody")
        self.identify(rec)                                   # not asked about again
        self.assertEqual(self.fm(rec)["speaker_naming"], "named")

    # review round 1, `closed-label-named-again-on-rerun`: a label a person closed is never named again
    def closed_then_rerun(self, name, answer):
        rec = self.two(name, a=DANA, b=STRANGER)
        self.identify(rec)
        self.assertEqual(self.t(rec)["speakers"], {"speaker_0": "Dana Oren"})
        self.question(rec)
        self.shown(rec)
        self.answer(rec, f"speaker_0={answer}", "speaker_1=skip")
        self.assertEqual(self.fm(rec)["speaker_naming"], "waiting")
        r = self.identify(rec)                               # the next attended run, speaker_1 still open
        t = self.t(rec)
        self.assertNotIn("speaker_0", t["speakers"])
        self.assertNotIn("speaker_0", t.get("speaker_sources") or {})
        self.assertEqual(t["speaker_questions"]["speaker_0"]["closed"], answer)
        self.assertNotIn("proposed", t["speaker_questions"]["speaker_0"])
        self.assertIn("closed", r["labels"]["speaker_0"])
        self.assertNotIn("Dana Oren", r["labels"]["speaker_0"])
        msg = self.question(rec)
        self.assertEqual([x["label"] for x in msg["records"][0]["labels"]], ["speaker_1"])
        self.assertNotIn("Speaker 0", msg["message"])
        self.shown(rec)
        self.answer(rec, "speaker_1=nobody")
        self.identify(rec)
        self.assertEqual(self.fm(rec)["speaker_naming"], "named")
        self.assertEqual(self.t(rec)["speakers"], {})        # never named on a name the person rejected
        return rec

    def test_a_machine_name_closed_by_nobody_is_not_written_again_by_a_later_run(self):
        self.closed_then_rerun("rejected-nobody", "nobody")

    def test_a_machine_name_closed_by_different_is_not_written_again_by_a_later_run(self):
        rec = self.closed_then_rerun("rejected-different", "different")
        self.assertEqual(self.t(rec)["speaker_questions"]["speaker_0"]["flags"], [naming.MIXED])


class ClosedByAPerson(Harness):
    """Design section 6: "'Nobody I can name' closes the label: it stays `Speaker N` and is not asked about
    again" and "'Different people' names nothing ... and marks the label mixed" — until `run` replaces the
    block (transcribed again), no later identify writes a name on it, proposes one, or puts it in the question
    (review round 1, `closed-label-named-again-on-rerun`)."""

    def test_a_carried_or_attendee_proposal_is_not_put_on_a_closed_label(self):
        prev = {"diarization_id": "0123456789ab", "labels": {
            "speaker_0": {"name": "Dana Oren", "new_label": "speaker_0", "share": 1.0, "offered": True}}}
        rec = self.two("closed-carried", prev=prev)
        self.identify(rec)
        self.assertEqual(self.t(rec)["speaker_questions"]["speaker_0"]["proposed"]["origin"], "carried")
        self.answer(rec, "speaker_0=nobody", "speaker_1=different")
        closed = copy.deepcopy(self.t(rec)["speaker_questions"])
        r = self.identify(rec)
        t = self.t(rec)
        self.assertEqual(t["speaker_questions"], closed)
        self.assertEqual(t["speakers"], {})
        self.assertEqual(self.fm(rec)["speaker_naming"], "named")
        self.assertIsNone(self.question(rec))
        for label in ("speaker_0", "speaker_1"):
            self.assertIn("closed", r["labels"][label])

    def test_run_replacing_the_block_lifts_the_closure(self):
        self.teach(DANA_REF, DANA)
        rec = self.two("closed-retranscribed", a=DANA, b=STRANGER)
        self.identify(rec)
        self.answer(rec, "speaker_0=nobody")
        fm, body = self.records.read(rec.path)
        fm["transcription"].pop("speaker_questions")        # what `run` does: a new transcription block
        fm.pop("speaker_naming")
        self.records.write(rec.path, fm, body)
        self.identify(rec)
        self.assertEqual(self.t(rec)["speakers"], {"speaker_0": "Dana Oren"})


# ======================================================================================================
# the obligations of earlier reviews

class ForgottenRecheck(Harness):
    """Finding `forgotten-unchecked-without-store` (task 4 review): `run` with no context or a refused store
    never read forgotten.json, so a forgotten person's carried name can be `offered: true`. identify re-checks
    every carried entry, read by value (ruling D20) — `earlier:<key>` entries included — against forgotten.json
    itself, and never proposes a forgotten person."""

    def forget(self, ref, at="2026-10-01T10:00:00+02:00"):
        self.store.add_forgotten({"print": "p-gone", "known_as": [{"workspace": WS, "person": ref, "name": NAMES[ref]}],
                                  "at": at})

    def prev(self, **entries):
        return {"diarization_id": "0123456789ab", "labels": entries}

    def test_a_forgotten_person_by_reference_is_not_proposed(self):
        self.forget(DANA_REF)
        src = {"name": "Dana Oren", "person": DANA_REF, "origin": "hand", "status": "confirmed",
               "named": "2026-08-01T10:00:00+02:00"}
        rec = self.two("forgot-ref", prev=self.prev(speaker_0={"name": "Dana Oren", "source": src, "new_label": "speaker_0",
                                                               "share": 1.0, "offered": True}))
        self.identify(rec)
        t = self.t(rec)
        e = t["previous_speakers"]["labels"]["speaker_0"]
        self.assertEqual((e["offered"], e["forgotten"]), (False, True))
        for q in (t.get("speaker_questions") or {}).values():
            self.assertNotEqual((q.get("proposed") or {}).get("person"), DANA_REF)
            self.assertNotEqual((q.get("proposed") or {}).get("name"), "Dana Oren")
        self.assertNotIn("speaker_0", t.get("speaker_questions") or {})
        sig = self.store.read_signature(MODEL.id, rec.audio, rec.diar)
        self.assertEqual(sig["labels"]["speaker_0"]["windows"], [])
        self.assertIn("speaker_0", sig["removed"])

    def test_an_earlier_key_matched_by_name_is_not_proposed(self):
        self.forget(SAM_REF)
        rec = self.two("forgot-name", prev=self.prev(**{"earlier:speaker_4": {
            "name": "Sam Diaz", "new_label": "speaker_1", "share": 1.0, "offered": True}}))
        self.identify(rec)
        t = self.t(rec)
        e = t["previous_speakers"]["labels"]["earlier:speaker_4"]
        self.assertEqual((e["offered"], e["forgotten"]), (False, True))
        for q in (t.get("speaker_questions") or {}).values():
            self.assertNotEqual((q.get("proposed") or {}).get("name"), "Sam Diaz")

    def test_a_forgotten_flag_is_never_proposed(self):
        rec = self.two("forgot-flag", prev=self.prev(speaker_0={"name": "Dana Oren", "new_label": "speaker_0",
                                                                "share": 1.0, "offered": True, "forgotten": True}))
        self.identify(rec)
        for q in (self.t(rec).get("speaker_questions") or {}).values():
            self.assertNotEqual((q.get("proposed") or {}).get("name"), "Dana Oren")

    def test_a_name_confirmed_after_the_forget_is_proposed(self):
        self.forget(DANA_REF, at="2026-07-01T10:00:00+02:00")
        src = {"name": "Dana Oren", "person": DANA_REF, "origin": "hand", "status": "confirmed",
               "named": "2026-08-01T10:00:00+02:00"}
        rec = self.two("forgot-before", prev=self.prev(speaker_0={"name": "Dana Oren", "source": src,
                                                                  "new_label": "speaker_0", "share": 1.0, "offered": True}))
        self.identify(rec)
        self.assertEqual(self.t(rec)["speaker_questions"]["speaker_0"]["proposed"]["person"], DANA_REF)


class QuestionsFromFlags(Harness):
    """Ruling D18: the questions and their flags are `decide`'s `flags`, never its `reports`."""

    def test_each_question_carries_decides_flags(self):
        self.teach(DANA_REF, DANA)
        rec = self.make("flags", {"speaker_0": lab(DANA, "qf-d", seconds=420.0, longest=360.0), "speaker_1": lab(STRANGER, "qf-s")})
        self.identify(rec)
        d = naming.decide(rec.sig, rec.ctx, {DANA_REF: self.print_of(DANA_REF)}, {}, CALIB)
        qs = self.t(rec)["speaker_questions"]
        for label in ("speaker_0", "speaker_1"):
            self.assertEqual(qs[label]["flags"], d["flags"].get(label, []))

    def test_a_named_label_flagged_by_step_3_is_not_asked(self):
        rec = self.make("flag-named", {"speaker_0": lab(DANA, "qn-d", seconds=420.0, longest=360.0), "speaker_1": lab(SAM, "qn-s")},
                        speakers={"speaker_0": "Dana Oren"})
        r = self.identify(rec)
        self.assertNotIn("speaker_0", self.t(rec)["speaker_questions"])
        self.assertTrue(any("Speaker 0" in x and "five minutes" in x for x in r["lines"]))


class ComputedSignature(Harness):
    """Revisions entry 1: with no file in the active model's folder, identify computes the signature from the audio
    and a matching ASR cache, keeps `removed` from every sibling file of the same audio and diarisation id in other
    model folders, and skips any label whose carried name is forgotten."""

    def fake_compute(self, rec):
        self.calls = []

        def compute(model_id, rctx, audio, removed=()):
            self.calls.append({"model": model_id, "audio": audio, "removed": sorted(removed), "record": rctx.get("record")})
            sig = copy.deepcopy(rec.sig)
            sig["removed"] = sorted(removed)
            for l in removed:
                sig["labels"][l]["windows"] = []
            return sig
        return compute

    def test_removed_of_other_model_folders_and_forgotten_carried_labels_are_never_computed(self):
        prev = {"diarization_id": "0123456789ab", "labels": {
            "speaker_0": {"name": "Dana Oren", "new_label": "speaker_0", "share": 1.0, "offered": False, "forgotten": True}}}
        rec = self.make("computed", {"speaker_0": lab(DANA, "cs-d"), "speaker_1": lab(SAM, "cs-s"),
                                     "speaker_2": lab(TOM, "cs-t")}, hint=3, attendees=(DANA_REF, SAM_REF, TOM_REF),
                        prev=prev, write_sig=False)
        other = store.Model("other-test", "d" * 64, 64)
        self.store.write_json(self.store.signature_path(other.id, rec.audio, rec.diar),
                              {"version": 1, "audio": rec.audio, "diarization": {"id": rec.diar}, "removed": ["speaker_1"],
                               "labels": {}, "model": {"id": other.id, "sha256": other.sha256, "dim": other.dim}})
        self.identify(rec, compute=self.fake_compute(rec))
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.calls[0]["removed"], ["speaker_0", "speaker_1"])
        self.assertEqual((self.calls[0]["model"], self.calls[0]["audio"]), (MODEL.id, rec.audio))
        sig = self.store.read_signature(MODEL.id, rec.audio, rec.diar)
        self.assertEqual(sig["records"], [{"workspace": WS, "record": rec.ref}])
        self.assertEqual(sig["removed"], ["speaker_0", "speaker_1"])

    def test_with_nothing_to_compute_from_the_record_is_left_as_it_was(self):
        rec = self.two("no-signature", write_sig=False)
        before = self.fm(rec)
        code, outs = self.cli(rec.path, recs=[rec])
        self.assertEqual(code, 1)
        self.assertIn("no voice signature", outs[0]["records"][0]["error"])
        self.assertEqual(self.fm(rec), before)

    def test_a_forgotten_name_that_cannot_be_placed_computes_nothing(self):
        prev = {"diarization_id": None, "labels": {
            "speaker_0": {"name": "Dana Oren", "new_label": None, "share": 0.0, "offered": False, "forgotten": True}}}
        rec = self.two("unplaced", prev=prev, write_sig=False)
        self.identify(rec, compute=self.fake_compute(rec))
        self.assertEqual(self.calls, [])
        fm = self.fm(rec)
        self.assertEqual(fm["transcription"]["speakers"], {})
        self.assertEqual(fm["speaker_naming"], "closed")


class NamingState(unittest.TestCase):
    """Design section 11's table: `speaker_naming` from the record alone."""

    def fm(self, speakers=None, sources=None, questions=None, outcome="waiting", diar="7c1d09a4e2b1"):
        t = {"diarization_id": diar, "speakers": speakers or {}, "identification": {"outcome": outcome}}
        if sources:
            t["speaker_sources"] = sources
        if questions is not None:
            t["speaker_questions"] = questions
        return {"transcription": t}

    def prov(self, name="Dana Oren"):
        return {"name": name, "person": DANA_REF, "origin": "print", "status": "provisional"}

    def test_collapsed_and_pre_feature_are_closed(self):
        self.assertEqual(identify.naming_state(self.fm(outcome="collapsed")), "closed")
        self.assertEqual(identify.naming_state(self.fm(outcome="needs-retranscription", diar=None)), "closed")

    def test_no_diarised_label_at_all_is_closed(self):
        self.assertEqual(identify.naming_state(self.fm(questions={}, outcome="none")), "closed")

    def test_an_unnamed_label_is_waiting_shown_or_not(self):
        self.assertEqual(identify.naming_state(self.fm(questions={"speaker_0": {"quotes": []}}, outcome="none")), "waiting")
        self.assertEqual(identify.naming_state(self.fm(questions={"speaker_0": {"quotes": [], "shown": "x"}})), "waiting")

    def test_a_flagged_label_is_waiting(self):
        q = {"speaker_0": {"quotes": [], "flags": [naming.MIXED]}, "speaker_1": {"quotes": [], "flags": [naming.MIXED]}}
        self.assertEqual(identify.naming_state(self.fm(questions=q, outcome="mixed-suspected")), "waiting")

    def test_a_provisional_name_waits_until_shown(self):
        sp, so = {"speaker_0": "Dana Oren"}, {"speaker_0": self.prov()}
        self.assertEqual(identify.naming_state(self.fm(sp, so, {"speaker_0": {"quotes": []}})), "waiting")
        self.assertEqual(identify.naming_state(self.fm(sp, so, {"speaker_0": {"quotes": [], "shown": "t"}})), "named")

    def test_confirmed_unverified_and_closed_by_a_person_are_named(self):
        sp = {"speaker_0": "Dana Oren", "speaker_1": "Sam Diaz"}
        so = {"speaker_0": dict(self.prov(), status="confirmed", origin="hand")}
        q = {"speaker_2": {"closed": "nobody"}, "speaker_3": {"closed": "different", "flags": [naming.MIXED]}}
        self.assertEqual(identify.naming_state(self.fm(sp, so, q)), "named")

    def test_a_name_whose_string_differs_from_its_source_is_unverified(self):
        sp, so = {"speaker_0": "Dana O."}, {"speaker_0": self.prov()}
        self.assertEqual(identify.status_of(self.fm(sp, so)["transcription"], "speaker_0"), "unverified")
        self.assertEqual(identify.naming_state(self.fm(sp, so, {"speaker_0": {"quotes": []}})), "named")


class Corrections(Harness):
    """`--correct <record> <label> <person>`: a provisional name goes to `enrol.correct_provisional` (a negative,
    `auto` false); a confirmed one to `enrol.correct_confirmed`."""

    def test_a_provisional_name_corrected_adds_a_negative_and_turns_auto_off(self):
        self.teach(DANA_REF, DANA)
        rec = self.two("correct-prov", a=DANA, b=STRANGER)
        self.identify(rec)
        code, outs = self.cli("--correct", rec.path, "speaker_0", SAM_REF, recs=[rec])
        self.assertEqual(code, 0, outs)
        t = self.t(rec)
        self.assertEqual(t["speakers"]["speaker_0"], "Sam Diaz")
        self.assertEqual(t["speaker_sources"]["speaker_0"]["status"], "confirmed")
        p = self.print_of(DANA_REF)
        self.assertIn({"audio": rec.audio, "diarization": rec.diar, "label": "speaker_0"}, p["negatives"])
        self.assertFalse(p["auto"])

    def test_a_confirmed_name_corrected_moves_its_source(self):
        rec = self.two("correct-conf")
        self.identify(rec)
        self.answer(rec, f"speaker_0={DANA_REF}")
        code, outs = self.cli("--correct", rec.path, "speaker_0", PRIYA_REF, recs=[rec])
        self.assertEqual(code, 0, outs)
        self.assertEqual(self.t(rec)["speakers"]["speaker_0"], "Priya Raman")
        d = self.print_of(DANA_REF)
        self.assertEqual([s["status"] for s in (d or {}).get("sources") or []], ["corrected"])
        self.assertEqual([s["status"] for s in self.print_of(PRIYA_REF)["sources"]], ["admitted"])


class RefusedStore:
    """A store whose location is refused: `ensure` raises, and so does every other use, so a verb that works
    from the records alone is proved never to touch it."""

    def __getattr__(self, name):
        def refuse(*a, **k):
            raise store.StoreRefused("inside a synced folder", "/synced/voice-prints")
        return refuse


class WithoutTheStore(Harness):
    """Review round 1, `refused-store-blocks-question-and-revert`: with the print store refused or the
    calibration ambiguous, the end-of-run question is still asked (and stamped shown) from what the records
    hold, and reverting still removes provisional names; only naming and enrolment stop, and say why."""

    def setUp(self):
        super().setUp()
        self.teach(DANA_REF, DANA)
        self.rec = self.two("refused", a=DANA, b=STRANGER, speakers=None)
        self.identify(self.rec)
        self.unverified = self.two("refused-unverified", speakers={"speaker_0": "Dana Oren"})
        self.identify(self.unverified)

    def check_record_verbs(self, **kw):
        code, outs = self.cli("--question", self.rec.path, self.unverified.path, recs=[self.rec, self.unverified], **kw)
        self.assertEqual(code, 0, outs)
        msg = outs[0]
        self.assertIn("**Speaker 0 → Dana Oren**", msg["message"])
        self.assertEqual(sorted(x["kind"] for r in msg["records"] for x in r["labels"]),
                         ["ask", "ask", "unconfirmed", "unverified"])
        for r in msg["records"]:
            for x in r["labels"]:
                self.assertEqual(len(x["quotes"]), 2, x)
        code, outs = self.cli("--shown", self.rec.path, self.unverified.path, recs=[self.rec, self.unverified], **kw)
        self.assertEqual(code, 0, outs)
        self.assertEqual(self.fm(self.rec)["speaker_naming"], "waiting")       # speaker_1 still asked
        store.parse_instant(self.t(self.rec)["speaker_questions"]["speaker_0"]["shown"])
        store.parse_instant(self.t(self.unverified)["speaker_questions"]["speaker_0"]["shown"])
        code, outs = self.cli("--revert", self.rec.path, recs=[self.rec], **kw)
        self.assertEqual(code, 0, outs)
        self.assertEqual(self.t(self.rec)["speakers"], {})
        self.assertNotIn("speaker_naming", self.fm(self.rec))
        rows = [{"record": self.unverified.ref, "record_path": self.unverified.path, "matches": []}]
        ctx = dict(copy.deepcopy(BASE), person={"ref": DANA_REF, "name": "Dana Oren"}, person_records=rows)
        code, outs = self.cli("--revert", "--person", DANA_REF, ctx=ctx, **kw)
        self.assertEqual(code, 0, outs)

    def check_naming_stops(self, why, **kw):
        before = self.fm(self.unverified)
        for args in ((self.unverified.path,), ("--answer", self.unverified.path, f"speaker_1={SAM_REF}"),
                     ("--confirm", self.unverified.path)):
            code, outs = self.cli(*args, recs=[self.unverified], **kw)
            self.assertEqual(code, 1, (args, outs))
            self.assertIn(why, outs[0])
        self.assertEqual(self.fm(self.unverified), before)

    def test_a_refused_store(self):
        self.check_record_verbs(store_=RefusedStore())
        self.check_naming_stops("synced folder", store_=RefusedStore())

    def test_an_ambiguous_calibration(self):
        def ambiguous(skill_dir, st):
            raise models.CalibrationAmbiguous("calibration/ names two models: campp-test, other-test")
        with mock.patch.object(identify, "resolve_active", ambiguous):
            self.check_record_verbs(active=None)
            self.check_naming_stops("names two models", active=None)


class TheVerb(Harness):
    """`transcribe_meeting.py identify` and its refusals."""

    def test_an_unknown_label_or_person_is_refused_before_anything_is_written(self):
        rec = self.two("refuse")
        self.identify(rec)
        before = self.fm(rec)
        code, _ = self.cli("--answer", rec.path, "speaker_9=" + DANA_REF, recs=[rec])
        self.assertEqual(code, 2)
        code, _ = self.cli("--answer", rec.path, "speaker_0=users/nobody-here", recs=[rec])
        self.assertEqual(code, 2)
        self.assertEqual(self.fm(rec), before)

    def test_the_verb_is_wired_and_needs_its_context(self):
        p = subprocess.run([sys.executable, "-B", str(SKILL / "transcribe_meeting.py"), "identify", "x.md"],
                           capture_output=True, text=True, cwd=str(self.root),
                           env=dict(os.environ, VOICE_PRINTS_HOME=str(self.root / "vp2")))
        self.assertEqual(p.returncode, 2, p.stderr + p.stdout)
        self.assertIn("--context", p.stdout + p.stderr)


if __name__ == "__main__":
    unittest.main()
