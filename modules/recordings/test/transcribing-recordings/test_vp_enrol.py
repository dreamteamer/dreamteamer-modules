"""Enrolment (cr-modules-019 task 5): design section 9's checks 1 to 10, admission, trust, the reseed
notice, and one global replay in a total order that live confirmation shares (design-review round 5:
`check-7-keeps-out-what-the-reseed-notice-counts`, `reseed-mark-is-a-stored-status-the-next-rebuild-
ignores`, `replay-order-not-total-and-cross-print-checks-not-pinned`, `correcting-a-confirmed-first-
source-leaves-it-in-the-print`; plan rulings D3 to D6).

Standard library only, so a bare python3 runs it (vp-enrol.test.mjs). Every voice is synthetic and made
at run time by vp_synth.py, each voice and each source with its own seed (ruling D13). Every store is a
temp directory with a fake `exclude_backup` (ruling D14), and signature files are written through
`store.write_signature` in design section 8's shape.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1] / "skills" / "transcribing-recordings"))

import vp_synth  # noqa: E402
from voiceprints import enrol, naming, store, vec  # noqa: E402

TH = dict(enrol.PLACEHOLDERS)
MODEL = store.Model("campp-test", "c" * 64, 64)
MODEL_B = store.Model("eres2netv2-test", "e" * 64, 64)
WS, WS_B = "northwind-hq", "harbor-mutual"

DANA = vp_synth.voice("dana-oren")
SAM = vp_synth.voice("sam-diaz")
PRIYA = vp_synth.voice("priya-raman")
TOM = vp_synth.voice("tom-whitfield")

DANA_P = {"workspace": WS, "person": "users/dana-oren", "name": "Dana Oren"}
SAM_P = {"workspace": WS, "person": "contacts/sam-diaz", "name": "Sam Diaz"}
PRIYA_P = {"workspace": WS, "person": "contacts/priya-raman", "name": "Priya Raman"}
TOM_P = {"workspace": WS, "person": "users/tom-whitfield", "name": "Tom Whitfield"}


def no_exclude(home):
    return None


# -- builders --------------------------------------------------------------------------------------------
def audio_of(name):
    return hashlib.sha256(("audio:" + name).encode()).hexdigest()


def diar_of(name):
    return hashlib.sha256(("diar:" + name).encode()).hexdigest()[:12]


def plane(u, other, deg):
    """A unit vector at `deg` degrees from `u`, in the plane of `u` and `other`."""
    u = vec.unit(u)
    d = sum(x * y for x, y in zip(other, u))
    w = vec.unit([x - d * y for x, y in zip(other, u)])
    r = math.radians(deg)
    return vec.unit([math.cos(r) * a + math.sin(r) * b for a, b in zip(u, w)])


def label(voice, seed, n=40, seconds=120.0, longest=40.0, share=None, noise=0.05, vectors=None):
    vs = vectors if vectors is not None else vp_synth.windows(voice, n, noise=noise, seed=seed)
    out = {"seconds": seconds, "longest_turn": longest,
           "windows": [{"start": 6.0 * i, "end": 6.0 * (i + 1), "vector": v} for i, v in enumerate(vs)]}
    if share is not None:
        out["share"] = share
    return out


def signature(name, labels, hint=2, model=MODEL):
    total = sum(l["seconds"] for l in labels.values()) or 1.0
    for l in labels.values():
        l.setdefault("share", round(l["seconds"] / total, 4))
    return {"version": 1, "audio": audio_of(name),
            "diarization": {"id": diar_of(name), "labels": len(labels), "speakers_hint": hint, "fallback": None},
            "model": {"id": model.id, "sha256": model.sha256, "dim": model.dim},
            "labels": labels, "removed": []}


def conf(name, lab, who, at, different=False, condition="device"):
    c = {"audio": audio_of(name), "diarization": diar_of(name), "label": lab, "workspace": who["workspace"],
         "person": who["person"], "name": who["name"], "confirmed": at, "condition": condition}
    if different:
        c["different"] = True
    return c


def at(day, sec=0):
    return f"2026-11-{day:02d}T10:00:{sec:02d}+02:00"


def ref(name, lab):
    return {"audio": audio_of(name), "diarization": diar_of(name), "label": lab}


def statuses(p):
    return [(s["label"], s["audio"][:6], s["status"]) for s in p["sources"]]


def essence(p):
    """A print without the bookkeeping dates: what a replay must reproduce exactly."""
    return {k: v for k, v in p.items() if k not in ("created", "updated")}


def a_print(pid, who, vector, sources=(), negatives=(), trust="trusted", auto=True):
    return {"version": 1, "id": pid, "known_as": [dict(who)], "vector": vector, "trust": trust, "auto": auto,
            "sources": list(sources), "negatives": list(negatives),
            "model": {"id": MODEL.id, "sha256": MODEL.sha256, "dim": MODEL.dim}}


class StoreCase(unittest.TestCase):
    def setUp(self):
        self._td = tempfile.TemporaryDirectory()
        self.addCleanup(self._td.cleanup)
        self.root = os.path.realpath(self._td.name)
        home = os.path.join(self.root, "home")
        os.makedirs(home)
        env = mock.patch.dict(os.environ, {"HOME": home, "USERPROFILE": home,
                                           "VOICE_PRINTS_HOME": os.path.join(self.root, "unused")})
        env.start()
        self.addCleanup(env.stop)
        self.store = self.new_store("vp")

    def new_store(self, name):
        return store.Store(os.path.join(self.root, name), exclude_backup=no_exclude)

    def put(self, sig, model=MODEL, workspace=WS, st=None):
        (st or self.store).write_signature(model.id, sig, record={
            "workspace": workspace, "record": "meeting-recordings/2026/11/" + sig["audio"][:8]})
        return sig

    def rec(self, name, labels, hint=2, model=MODEL, st=None):
        return self.put(signature(name, labels, hint=hint, model=model), model=model, st=st)

    def prints(self, model=MODEL, st=None):
        return {p["id"]: p for p in (st or self.store).prints(model.id, model=model)}

    def print_of(self, who, model=MODEL, st=None):
        for p in (st or self.store).prints(model.id, model=model):
            if any(k["workspace"] == who["workspace"] and k["person"] == who["person"] for k in p["known_as"]):
                return p
        return None

    def confirm(self, *confs, th=TH, st=None):
        return enrol.confirm(st or self.store, MODEL, th, list(confs))

    def two_dana(self, secs=(120.0, 120.0)):
        """Two clean recordings of Dana with Sam, each confirmed: a trusted print."""
        self.rec("r1", {"speaker_0": label(DANA, "r1-dana", seconds=secs[0]), "speaker_1": label(SAM, "r1-sam")})
        self.rec("r2", {"speaker_0": label(DANA, "r2-dana", seconds=secs[1]), "speaker_1": label(SAM, "r2-sam")})
        self.confirm(conf("r1", "speaker_0", DANA_P, at(1)))
        self.confirm(conf("r2", "speaker_0", DANA_P, at(2)))
        return self.print_of(DANA_P)


# -- the placeholders and trust ---------------------------------------------------------------------------
class Placeholders(unittest.TestCase):
    def test_the_six_values_of_the_global_constraints(self):
        self.assertEqual(enrol.PLACEHOLDERS, {"accept": 0.80, "accept_open": 0.85, "margin": 0.10,
                                              "same": 0.75, "split": 0.55, "suggest": 0.65})
        self.assertEqual(enrol.PLACEHOLDERS, naming.UNCALIBRATED)


class Trust(unittest.TestCase):
    def src(self, status, seconds):
        return {"status": status, "seconds": seconds}

    def test_two_admitted_sources_and_a_minute_are_trusted(self):
        self.assertEqual(enrol.trust({"sources": [self.src("admitted", 30.0), self.src("admitted", 30.0)]}), "trusted")

    def test_two_admitted_sources_under_sixty_seconds_stay_proposing(self):
        self.assertEqual(enrol.trust({"sources": [self.src("admitted", 25.0), self.src("admitted", 25.0)]}), "proposing")

    def test_one_admitted_source_however_long_stays_proposing(self):
        self.assertEqual(enrol.trust({"sources": [self.src("admitted", 900.0)]}), "proposing")

    def test_held_uncalibrated_and_excluded_sources_never_count(self):
        p = {"sources": [self.src("admitted", 40.0), self.src("held", 400.0), self.src("uncalibrated", 400.0),
                         self.src("reseeded", 400.0), self.src("corrected", 400.0)]}
        self.assertEqual(enrol.trust(p), "proposing")


# -- checks 1 to 10, each failing alone ---------------------------------------------------------------------
class Checks(unittest.TestCase):
    """Each check failing alone keeps the label out with its reason; the base case passes every check."""

    def setUp(self):
        self.sig = signature("c", {"speaker_0": label(DANA, "c-dana"), "speaker_1": label(SAM, "c-sam")})

    def numbers(self, sig=None, person=DANA_P, prints=(), never=(), th=TH, different=False, lab="speaker_0"):
        out = enrol.checks(lab, sig or self.sig, person, list(prints), list(never), th, user_said_different=different)
        for f in out:
            self.assertTrue(f["reason"], f)
        return [f["check"] for f in out]

    def test_the_base_case_passes_every_check(self):
        self.assertEqual(self.numbers(), [])

    def test_check_1_never(self):
        self.assertEqual(self.numbers(never=[dict(DANA_P, at=at(1))]), [1])

    def test_check_1_never_matches_by_name_in_another_workspace_not_a_namesake_here(self):
        elsewhere = {"workspace": WS_B, "person": "contacts/d-oren", "name": "Dana Oren", "at": at(1)}
        self.assertEqual(self.numbers(never=[elsewhere]), [1])
        here_other_ref = {"workspace": WS, "person": "contacts/dana-oren-2", "name": "Dana Oren", "at": at(1)}
        self.assertEqual(self.numbers(never=[here_other_ref]), [])

    def test_check_2_no_calibration(self):
        out = enrol.checks("speaker_0", self.sig, DANA_P, [], [], None)
        self.assertEqual([f["check"] for f in out], [2])

    def test_check_3_under_twenty_seconds(self):
        sig = signature("c", {"speaker_0": label(DANA, "c-dana", seconds=15.0), "speaker_1": label(SAM, "c-sam")})
        self.assertEqual(self.numbers(sig), [3])

    def test_check_3_a_label_whose_windows_were_deleted(self):
        sig = signature("c", {"speaker_0": label(DANA, "c-dana", vectors=[]), "speaker_1": label(SAM, "c-sam")})
        sig["removed"] = ["speaker_0"]
        self.assertEqual(self.numbers(sig), [3])

    def test_check_4_a_turn_over_five_minutes_with_no_meeting(self):
        sig = signature("c", {"speaker_0": label(DANA, "c-dana", longest=360.0), "speaker_1": label(SAM, "c-sam")})
        self.assertEqual(self.numbers(sig), [4])

    def test_check_4_over_ninety_percent_of_the_speech(self):
        sig = signature("c", {"speaker_0": label(DANA, "c-dana", seconds=950.0, share=0.95),
                              "speaker_1": label(SAM, "c-sam", seconds=50.0, share=0.05)})
        self.assertEqual(self.numbers(sig), [4])

    def test_check_4_needs_two_labels(self):
        sig = signature("c", {"speaker_0": label(DANA, "c-dana", longest=900.0, share=1.0)}, hint=None)
        self.assertEqual(self.numbers(sig), [])

    def test_check_5_two_voices_inside_the_label(self):
        mixed = vp_synth.mixed(DANA, TOM, 40, 0.4, seed="c-mixed", noise=0.05)
        sig = signature("c", {"speaker_0": label(None, None, vectors=mixed), "speaker_1": label(SAM, "c-sam")})
        self.assertEqual(self.numbers(sig), [5])

    def test_check_6_another_label_sounds_alike(self):
        alike = plane(DANA, SAM, 25.0)          # cos 0.91, above same 0.75
        sig = signature("c", {"speaker_0": label(DANA, "c-dana"), "speaker_1": label(alike, "c-alike")})
        self.assertEqual(self.numbers(sig), [6])

    def test_check_6_is_computed_without_the_label(self):
        sig = signature("c", {"speaker_0": label(DANA, "c-dana")}, hint=None)
        self.assertEqual(self.numbers(sig), [])

    def test_check_7_between_suggest_and_accept_is_held_not_dropped(self):
        own = a_print("p-dana", DANA_P, plane(DANA, PRIYA, 41.0))       # cos 0.75: between 0.65 and 0.80
        out = enrol.checks("speaker_0", self.sig, DANA_P, [own], [], TH)
        self.assertEqual([f["check"] for f in out], [7])
        self.assertIn("0.7", out[0]["reason"])

    def test_check_7_below_suggest_is_held_too(self):
        own = a_print("p-dana", DANA_P, plane(DANA, PRIYA, 65.0))       # cos 0.42
        self.assertEqual(self.numbers(prints=[own]), [7])

    def test_check_8_another_person_known_here_matches(self):
        sams = a_print("p-sam", SAM_P, DANA)
        self.assertEqual(self.numbers(prints=[sams]), [8])

    def test_check_8_is_computed_without_the_label_and_only_against_people_known_here(self):
        own = a_print("p-dana", DANA_P, DANA)                           # the person's own print never counts
        elsewhere = a_print("p-other", {"workspace": WS_B, "person": "contacts/x", "name": "Priya Raman"}, DANA)
        self.assertEqual(self.numbers(prints=[own, elsewhere]), [])

    def test_check_9_a_known_negative(self):
        own = a_print("p-dana", DANA_P, DANA, negatives=[{"audio": self.sig["audio"],
                                                          "diarization": self.sig["diarization"]["id"],
                                                          "label": "speaker_0"}])
        self.assertEqual(self.numbers(prints=[own]), [9])

    def test_check_10_the_user_said_different_people(self):
        self.assertEqual(self.numbers(different=True), [10])

    def test_prints_may_be_given_as_a_mapping(self):
        sams = a_print("p-sam", SAM_P, DANA)
        out = enrol.checks("speaker_0", self.sig, DANA_P, {"contacts/sam-diaz": sams}, [], TH)
        self.assertEqual([f["check"] for f in out], [8])


# -- confirmation, admission and trust ----------------------------------------------------------------------
class Admission(StoreCase):
    def test_a_first_source_is_admitted_and_proposes(self):
        self.rec("r1", {"speaker_0": label(DANA, "r1-dana"), "speaker_1": label(SAM, "r1-sam")})
        rep = self.confirm(conf("r1", "speaker_0", DANA_P, at(1)))
        p = self.print_of(DANA_P)
        self.assertEqual(statuses(p), [("speaker_0", audio_of("r1")[:6], "admitted")])
        self.assertEqual(p["trust"], "proposing")
        self.assertTrue(p["auto"])
        self.assertGreater(vec.cos(p["vector"], DANA), 0.99)
        self.assertEqual(p["model"], {"id": MODEL.id, "sha256": MODEL.sha256, "dim": MODEL.dim})
        self.assertEqual([s["status"] for s in rep["stored"]], ["admitted"])
        self.assertIn(p["id"], rep["changed"])

    def test_a_matching_second_source_is_admitted_and_the_print_trusted(self):
        p = self.two_dana()
        self.assertEqual([s["status"] for s in p["sources"]], ["admitted", "admitted"])
        self.assertEqual(p["trust"], "trusted")
        self.assertEqual(p["seconds"], 240.0)

    def test_a_later_source_between_suggest_and_accept_is_held_and_the_print_stays_trusted(self):
        before = self.two_dana()
        weak = plane(DANA, PRIYA, 41.0)                                   # cos 0.75 to Dana
        self.rec("r3", {"speaker_0": label(weak, "r3-weak"), "speaker_1": label(SAM, "r3-sam")})
        rep = self.confirm(conf("r3", "speaker_0", DANA_P, at(3)))
        p = self.print_of(DANA_P)
        self.assertEqual([s["status"] for s in p["sources"]], ["admitted", "admitted", "held"])
        self.assertTrue(p["sources"][2]["reason"])
        self.assertEqual(p["trust"], "trusted")
        self.assertEqual(p["vector"], before["vector"])
        self.assertEqual(rep["stored"][0]["status"], "held")

    def test_a_long_weak_source_after_two_short_ones_is_held_and_unseats_neither(self):
        """The round-4 case: one 80-window weak source after a 10- and a 20-window source."""
        self.rec("r1", {"speaker_0": label(DANA, "r1-dana", n=10, seconds=35.0), "speaker_1": label(SAM, "r1-sam")})
        self.rec("r2", {"speaker_0": label(DANA, "r2-dana", n=20, seconds=30.0), "speaker_1": label(SAM, "r2-sam")})
        self.confirm(conf("r1", "speaker_0", DANA_P, at(1)), conf("r2", "speaker_0", DANA_P, at(2)))
        before = self.print_of(DANA_P)
        self.assertEqual(before["trust"], "trusted")
        weak = plane(DANA, PRIYA, 43.0)
        self.rec("r3", {"speaker_0": label(weak, "r3-weak", n=80, seconds=480.0),
                        "speaker_1": label(SAM, "r3-sam")})
        self.confirm(conf("r3", "speaker_0", DANA_P, at(3)))
        p = self.print_of(DANA_P)
        self.assertEqual([s["status"] for s in p["sources"]], ["admitted", "admitted", "held"])
        self.assertEqual(p["vector"], before["vector"])
        self.assertEqual(p["trust"], "trusted")
        self.assertEqual(p["seconds"], 65.0)

    def test_each_source_weighs_the_same_however_long(self):
        other = plane(DANA, PRIYA, 25.0)                                 # cos 0.906: admitted against Dana
        s1 = self.rec("r1", {"speaker_0": label(DANA, "r1-dana", n=10, seconds=40.0), "speaker_1": label(SAM, "r1-sam")})
        s2 = self.rec("r2", {"speaker_0": label(other, "r2-dana", n=80, seconds=900.0, share=0.8),
                             "speaker_1": label(SAM, "r2-sam", seconds=225.0, share=0.2)})
        self.confirm(conf("r1", "speaker_0", DANA_P, at(1)))
        self.confirm(conf("r2", "speaker_0", DANA_P, at(2)))
        p = self.print_of(DANA_P)
        self.assertEqual([s["status"] for s in p["sources"]], ["admitted", "admitted"])
        c1, c2 = naming.label_centroid(s1, "speaker_0"), naming.label_centroid(s2, "speaker_0")
        want = vec.mean_unit([c1, c2])
        for a, b in zip(p["vector"], want):
            self.assertAlmostEqual(a, b, places=12)
        self.assertAlmostEqual(vec.cos(p["vector"], c1), vec.cos(p["vector"], c2), places=6)

    def test_two_admitted_sources_under_sixty_seconds_stay_proposing(self):
        p = self.two_dana(secs=(25.0, 25.0))
        self.assertEqual([s["status"] for s in p["sources"]], ["admitted", "admitted"])
        self.assertEqual(p["trust"], "proposing")

    def test_a_label_kept_out_is_not_stored_and_says_why(self):
        self.rec("r1", {"speaker_0": label(DANA, "r1-dana", seconds=12.0), "speaker_1": label(SAM, "r1-sam")})
        rep = self.confirm(conf("r1", "speaker_0", DANA_P, at(1)))
        self.assertIsNone(self.print_of(DANA_P))
        self.assertEqual(rep["stored"], [])
        self.assertEqual([c["check"] for c in rep["kept_out"][0]["checks"]], [3])
        self.assertEqual(rep["kept_out"][0]["person"], DANA_P["person"])

    def test_the_user_saying_different_keeps_the_label_out(self):
        self.rec("r1", {"speaker_0": label(DANA, "r1-dana"), "speaker_1": label(SAM, "r1-sam")})
        rep = self.confirm(conf("r1", "speaker_0", DANA_P, at(1), different=True))
        self.assertIsNone(self.print_of(DANA_P))
        self.assertEqual([c["check"] for c in rep["kept_out"][0]["checks"]], [10])

    def test_a_person_in_never_stores_nothing(self):
        self.rec("r1", {"speaker_0": label(DANA, "r1-dana"), "speaker_1": label(SAM, "r1-sam")})
        self.store.add_never(dict(DANA_P, at=at(1)))
        rep = self.confirm(conf("r1", "speaker_0", DANA_P, at(2)))
        self.assertIsNone(self.print_of(DANA_P))
        self.assertEqual([c["check"] for c in rep["kept_out"][0]["checks"]], [1])

    def test_a_mixed_label_never_teaches(self):
        mixed = vp_synth.mixed(DANA, TOM, 40, 0.4, seed="r1-mixed", noise=0.05)
        self.rec("r1", {"speaker_0": label(None, None, vectors=mixed), "speaker_1": label(SAM, "r1-sam")})
        rep = self.confirm(conf("r1", "speaker_0", DANA_P, at(1)))
        self.assertIsNone(self.print_of(DANA_P))
        self.assertEqual([c["check"] for c in rep["kept_out"][0]["checks"]], [5])

    def test_a_long_turn_never_teaches(self):
        self.rec("r1", {"speaker_0": label(DANA, "r1-dana", longest=400.0), "speaker_1": label(SAM, "r1-sam")})
        rep = self.confirm(conf("r1", "speaker_0", DANA_P, at(1)))
        self.assertIsNone(self.print_of(DANA_P))
        self.assertEqual([c["check"] for c in rep["kept_out"][0]["checks"]], [4])

    def test_confirming_the_same_label_again_adds_nothing(self):
        self.two_dana()
        before = self.print_of(DANA_P)
        rep = self.confirm(conf("r1", "speaker_0", DANA_P, at(5)))
        self.assertEqual(essence(self.print_of(DANA_P)), essence(before))
        self.assertEqual(rep["stored"], [])

    def test_a_similarly_mixed_pair_leaves_the_second_held(self):
        """A diarisation that put one blended voice into both labels: each label resembles the print as much
        as the other, so the confirmed one does not beat its own recording's other label by `margin`."""
        blend = vec.unit([a + b for a, b in zip(DANA, SAM)])
        self.rec("r1", {"speaker_0": label(blend, "r1-blend"), "speaker_1": label(TOM, "r1-tom")})
        self.confirm(conf("r1", "speaker_0", DANA_P, at(1)))
        a = plane(blend, PRIYA, 22.0)                                  # cos 0.927 to the blend
        b = vec.unit([2 * vec.cos(a, blend) * x - y for x, y in zip(blend, a)])   # its mirror: the same score
        self.assertLess(vec.cos(a, b), TH["same"])                     # not alike enough for check 6
        self.rec("r2", {"speaker_0": label(a, "r2-a"), "speaker_1": label(b, "r2-b")})
        rep = self.confirm(conf("r2", "speaker_0", DANA_P, at(2)))
        p = self.print_of(DANA_P)
        self.assertEqual([s["status"] for s in p["sources"]], ["admitted", "held"])
        self.assertIn("Speaker 1", p["sources"][1]["reason"])
        self.assertEqual(rep["stored"][0]["status"], "held")
        self.assertEqual(p["trust"], "proposing")

    def test_a_source_that_does_not_beat_another_print_admitted_in_its_recording_is_held(self):
        """Admission bullet 4, against the other print as it stands at that point of the replay. Sam is
        known only in another workspace, so check 8 does not see his print; bullet 4 does, because his
        source in the same recording comes first in the total order (`harbor-mutual` < `northwind-hq`)."""
        sam_b = dict(SAM_P, workspace=WS_B)
        samx = plane(DANA, SAM, 78.0)                                  # a voice 78 degrees from Dana's
        close = plane(DANA, SAM, 35.0)                                 # 0.82 to Dana, 0.73 to that voice
        self.assertLess(vec.cos(close, samx), TH["same"])
        self.assertLess(vec.cos(close, DANA) - vec.cos(close, samx), TH["margin"])
        self.rec("r1", {"speaker_0": label(DANA, "r1-dana", noise=0.01), "speaker_1": label(TOM, "r1-tom")})
        self.rec("r2", {"speaker_0": label(samx, "r2-samx", noise=0.01), "speaker_1": label(TOM, "r2-tom")})
        self.rec("r3", {"speaker_0": label(close, "r3-close", noise=0.01),
                        "speaker_1": label(samx, "r3-samx", noise=0.01)})
        self.confirm(conf("r1", "speaker_0", DANA_P, at(1)), conf("r2", "speaker_0", sam_b, at(1)))
        self.confirm(conf("r3", "speaker_0", DANA_P, at(3)), conf("r3", "speaker_1", sam_b, at(3)))
        self.assertEqual([s["status"] for s in self.print_of(sam_b)["sources"]], ["admitted", "admitted"])
        dana = self.print_of(DANA_P)
        self.assertEqual([s["status"] for s in dana["sources"]], ["admitted", "held"])
        self.assertIn("another voice print", dana["sources"][1]["reason"])


# -- an uncalibrated confirmation (ruling D4) -----------------------------------------------------------------
class Uncalibrated(StoreCase):
    def test_a_confirmation_failing_only_check_2_is_a_source_with_no_vector(self):
        self.rec("r1", {"speaker_0": label(DANA, "r1-dana"), "speaker_1": label(SAM, "r1-sam")})
        self.rec("r2", {"speaker_0": label(DANA, "r2-dana"), "speaker_1": label(SAM, "r2-sam")})
        rep = self.confirm(conf("r1", "speaker_0", DANA_P, at(1)), conf("r2", "speaker_0", DANA_P, at(2)), th=None)
        p = self.print_of(DANA_P)
        self.assertEqual([s["status"] for s in p["sources"]], ["uncalibrated", "uncalibrated"])
        self.assertIsNone(p["vector"])
        self.assertEqual(p["trust"], "proposing")
        self.assertEqual([s["status"] for s in rep["stored"]], ["uncalibrated", "uncalibrated"])

    def test_every_replay_with_thresholds_judges_it_again_from_the_start(self):
        self.rec("r1", {"speaker_0": label(DANA, "r1-dana"), "speaker_1": label(SAM, "r1-sam")})
        self.rec("r2", {"speaker_0": label(DANA, "r2-dana"), "speaker_1": label(SAM, "r2-sam")})
        self.confirm(conf("r1", "speaker_0", DANA_P, at(1)), conf("r2", "speaker_0", DANA_P, at(2)), th=None)
        enrol.replay(self.store, MODEL, TH)
        p = self.print_of(DANA_P)
        self.assertEqual([s["status"] for s in p["sources"]], ["admitted", "admitted"])
        self.assertEqual(p["trust"], "trusted")

    def test_an_uncalibrated_confirmation_failing_another_check_is_not_stored(self):
        self.rec("r1", {"speaker_0": label(DANA, "r1-dana", seconds=10.0), "speaker_1": label(SAM, "r1-sam")})
        rep = self.confirm(conf("r1", "speaker_0", DANA_P, at(1)), th=None)
        self.assertIsNone(self.print_of(DANA_P))
        self.assertEqual([c["check"] for c in rep["kept_out"][0]["checks"]], [2, 3])


# -- one replay, in a total order ------------------------------------------------------------------------------
class Replay(StoreCase):
    def build(self):
        """Three recordings, Dana and Sam on each; r2's two labels confirmed in one answer at one instant."""
        for i in (1, 2, 3):
            self.rec(f"r{i}", {"speaker_0": label(DANA, f"r{i}-dana"), "speaker_1": label(SAM, f"r{i}-sam")})
        self.confirm(conf("r1", "speaker_0", DANA_P, at(1)))
        self.confirm(conf("r2", "speaker_1", SAM_P, at(2)), conf("r2", "speaker_0", DANA_P, at(2)))
        self.confirm(conf("r3", "speaker_1", SAM_P, at(3)))

    def strip(self, model=MODEL, scramble=True):
        """The prints reduced to their inputs (identity and confirmations), sources in a scrambled order."""
        for p in self.store.prints(model.id, model=model):
            p["vector"], p["trust"], p["seconds"] = None, "proposing", 0.0
            srcs = []
            for s in p["sources"]:
                s = dict(s)
                if s.get("status") not in ("reseeded", "corrected"):
                    s.pop("status", None), s.pop("reason", None)
                srcs.append(s)
            p["sources"] = list(reversed(srcs)) if scramble else srcs
            self.store.write_print(model.id, p)

    def test_replay_twice_gives_identical_prints_and_statuses(self):
        self.build()
        enrol.replay(self.store, MODEL, TH)
        first = {k: essence(v) for k, v in self.prints().items()}
        enrol.replay(self.store, MODEL, TH)
        self.assertEqual({k: essence(v) for k, v in self.prints().items()}, first)

    def test_live_confirmations_equal_a_replay_from_nothing(self):
        """Two people confirmed in one `confirm` call give the same prints as a replay from nothing."""
        self.build()
        live = {k: essence(v) for k, v in self.prints().items()}
        self.assertEqual(sorted(p["trust"] for p in live.values()), ["trusted", "trusted"])
        self.strip()
        enrol.replay(self.store, MODEL, TH)
        self.assertEqual({k: essence(v) for k, v in self.prints().items()}, live)

    def test_the_order_inside_one_answer_does_not_matter(self):
        self.build()
        one = {k: essence(v) for k, v in self.prints().items()}
        other = self.new_store("vp2")
        for i in (1, 2, 3):
            self.rec(f"r{i}", {"speaker_0": label(DANA, f"r{i}-dana"), "speaker_1": label(SAM, f"r{i}-sam")}, st=other)
        self.confirm(conf("r1", "speaker_0", DANA_P, at(1)), st=other)
        self.confirm(conf("r2", "speaker_0", DANA_P, at(2)), conf("r2", "speaker_1", SAM_P, at(2)), st=other)
        self.confirm(conf("r3", "speaker_1", SAM_P, at(3)), st=other)
        two = {k: essence(v) for k, v in self.prints(st=other).items()}
        self.assertEqual(two, one)

    def test_sources_are_stored_in_the_total_order(self):
        self.build()
        sams = self.print_of(SAM_P)
        self.assertEqual([s["confirmed"] for s in sams["sources"]], [at(2), at(3)])
        self.assertEqual(enrol.total_order(sams["sources"][0])[1:], (WS, audio_of("r2"), diar_of("r2"), "speaker_1",
                                                                    SAM_P["person"]))

    def test_instants_order_across_offsets(self):
        early = {"confirmed": "2026-11-20T10:00:00+02:00", "workspace": "b", "audio": "x", "diarization": "y", "label": "z"}
        late = {"confirmed": "2026-11-20T09:30:00+00:00", "workspace": "a", "audio": "x", "diarization": "y", "label": "z"}
        self.assertLess(enrol.total_order(early), enrol.total_order(late))

    def test_in_a_new_model_folder_it_replays_in_order(self):
        self.build()
        live = {k: essence(v) for k, v in self.prints().items()}
        for i in (1, 2, 3):
            self.rec(f"r{i}", {"speaker_0": label(DANA, f"r{i}-dana"), "speaker_1": label(SAM, f"r{i}-sam")},
                     model=MODEL_B)
        enrol.carry(self.store, MODEL.id, MODEL_B)
        self.strip(model=MODEL_B)                                       # scrambled order on disk
        enrol.replay(self.store, MODEL_B, TH)
        got = {k: essence(v) for k, v in self.prints(MODEL_B).items()}
        for v in got.values():
            self.assertEqual(v.pop("model"), {"id": MODEL_B.id, "sha256": MODEL_B.sha256, "dim": MODEL_B.dim})
        for v in live.values():
            v.pop("model")
        self.assertEqual(got, live)

    def test_a_custom_order_is_used_with_the_rest_of_the_key_breaking_ties(self):
        """Ruling D6: the calibration replay passes recording date then label; sources need no instant."""
        self.rec("r1", {"speaker_0": label(DANA, "r1-dana"), "speaker_1": label(SAM, "r1-sam")})
        weak = plane(DANA, PRIYA, 41.0)
        self.rec("r2", {"speaker_0": label(weak, "r2-weak"), "speaker_1": label(SAM, "r2-sam")})
        self.confirm(conf("r1", "speaker_0", DANA_P, at(1)), conf("r2", "speaker_0", DANA_P, at(2)))
        self.assertEqual([s["status"] for s in self.print_of(DANA_P)["sources"]], ["admitted", "held"])
        dates = {audio_of("r1"): "2026-11-09", audio_of("r2"): "2026-11-01"}
        p = self.print_of(DANA_P)
        for s in p["sources"]:
            s.pop("confirmed")
        self.store.write_print(MODEL.id, p)
        enrol.replay(self.store, MODEL, TH, order=lambda s: (dates[s["audio"]], s["label"]))
        p = self.print_of(DANA_P)
        self.assertEqual([(s["audio"], s["status"]) for s in p["sources"]],
                         [(audio_of("r2"), "admitted"), (audio_of("r1"), "held")])

    def test_a_source_whose_diarisation_file_is_gone_is_dropped_and_reported(self):
        self.build()
        os.remove(self.store.signature_path(MODEL.id, audio_of("r3"), diar_of("r3")))
        rep = enrol.replay(self.store, MODEL, TH)
        sams = self.print_of(SAM_P)
        self.assertEqual([s["audio"] for s in sams["sources"]], [audio_of("r2")])
        self.assertEqual(sams["trust"], "proposing")
        self.assertEqual([(d["audio"], d["label"]) for d in rep["dropped"]], [(audio_of("r3"), "speaker_1")])
        self.assertIn("gone", rep["dropped"][0]["why"])

    def test_a_print_left_with_no_source_is_removed(self):
        self.rec("r1", {"speaker_0": label(DANA, "r1-dana"), "speaker_1": label(SAM, "r1-sam")})
        self.confirm(conf("r1", "speaker_0", DANA_P, at(1)))
        pid = self.print_of(DANA_P)["id"]
        os.remove(self.store.signature_path(MODEL.id, audio_of("r1"), diar_of("r1")))
        rep = enrol.replay(self.store, MODEL, TH)
        self.assertIsNone(self.print_of(DANA_P))
        self.assertFalse(os.path.exists(self.store.print_path(MODEL.id, pid)))
        self.assertIn(pid, rep["removed"])

    def test_it_skips_sources_of_a_person_in_never(self):
        self.build()
        self.store.add_never(dict(SAM_P, at=at(9)))
        rep = enrol.replay(self.store, MODEL, TH)
        self.assertIsNone(self.print_of(SAM_P))
        self.assertEqual(len(rep["skipped"]), 2)
        self.assertEqual({s["why"] for s in rep["skipped"]}, {"never"})

    def test_it_skips_confirmations_before_a_matching_forgotten_entry(self):
        self.build()
        self.store.add_forgotten({"print": "p-gone", "known_as": [dict(SAM_P)], "at": at(2, 1)})
        enrol.replay(self.store, MODEL, TH)
        sams = self.print_of(SAM_P)
        self.assertEqual([s["confirmed"] for s in sams["sources"]], [at(3)])   # r2's, a second before, skipped
        self.rec("r4", {"speaker_0": label(DANA, "r4-dana"), "speaker_1": label(SAM, "r4-sam")})
        self.confirm(conf("r4", "speaker_1", SAM_P, at(4)))                    # after `at`: enrols again
        self.assertEqual([s["status"] for s in self.print_of(SAM_P)["sources"]], ["admitted", "admitted"])

    def test_a_confirmation_made_earlier_the_same_day_is_before_at(self):
        self.rec("r1", {"speaker_0": label(DANA, "r1-dana"), "speaker_1": label(SAM, "r1-sam")})
        self.store.add_forgotten({"print": "p-gone", "known_as": [dict(DANA_P)], "at": "2026-11-01T18:00:00+02:00"})
        rep = self.confirm(conf("r1", "speaker_0", DANA_P, "2026-11-01T09:00:00+02:00"))
        self.assertIsNone(self.print_of(DANA_P))
        self.assertEqual(rep["stored"], [])

    def test_a_namesake_under_another_reference_is_rebuilt_and_noticed_once(self):
        self.build()
        self.store.add_forgotten({"print": "p-gone", "at": at(9),
                                  "known_as": [{"workspace": WS_B, "person": "contacts/s-diaz", "name": "Sam Diaz"}]})
        rep = enrol.replay(self.store, MODEL, TH)
        self.assertEqual(self.print_of(SAM_P)["trust"], "trusted")
        same = [n for n in rep["notices"] if n["kind"] == "namesake"]
        self.assertEqual(len(same), 1)
        self.assertEqual(same[0]["workspace"], WS)
        self.assertIn("run `prints forget` here", same[0]["text"])
        self.assertNotIn("Sam", same[0]["text"])

    def test_replay_holds_the_model_lock(self):
        self.build()
        seen = []
        real = self.store.lock

        def spy(model_id):
            seen.append(model_id)
            return real(model_id)

        with mock.patch.object(self.store, "lock", side_effect=spy):
            enrol.replay(self.store, MODEL, TH)
            enrol.confirm(self.store, MODEL, TH, [])
        self.assertEqual(seen[:1], [MODEL.id])
        self.assertIn(MODEL.id, seen[1:])

    def test_a_print_of_another_model_is_refused(self):
        self.build()
        p = self.print_of(DANA_P)
        p["model"] = {"id": MODEL.id, "sha256": "f" * 64, "dim": 64}
        self.store.write_print(MODEL.id, p)
        with self.assertRaises(store.ModelMismatch) as e:
            enrol.replay(self.store, MODEL, TH)
        self.assertIn("prints rebuild", str(e.exception))


# -- a bad first source and reseed ------------------------------------------------------------------------------
class Reseed(StoreCase):
    def stuck(self):
        """Dana's first confirmed label is a poor seed: every later source scores below `suggest`."""
        poor = plane(DANA, PRIYA, 62.0)                               # cos 0.47 to Dana
        self.rec("r1", {"speaker_0": label(poor, "r1-poor"), "speaker_1": label(SAM, "r1-sam")})
        for i in (2, 3, 4):
            self.rec(f"r{i}", {"speaker_0": label(DANA, f"r{i}-dana"), "speaker_1": label(SAM, f"r{i}-sam")})
        reps = [self.confirm(conf(f"r{i}", "speaker_0", DANA_P, at(i))) for i in (1, 2, 3)]
        return reps

    def test_the_notice_comes_once_after_two_held(self):
        reps = self.stuck()
        p = self.print_of(DANA_P)
        self.assertEqual([s["status"] for s in p["sources"]], ["admitted", "held", "held"])
        self.assertTrue(all("check 7" in s["reason"] for s in p["sources"][1:]))
        self.assertEqual([n for n in reps[1]["notices"] if n["kind"] == "reseed"], [])
        notices = [n for n in reps[2]["notices"] if n["kind"] == "reseed"]
        self.assertEqual(len(notices), 1)
        self.assertEqual(notices[0]["text"], "Dana Oren's first recording may hold two voices; `prints reseed "
                                             "users/dana-oren` starts their voice print again from their next "
                                             "confirmed recording.")
        self.assertEqual(notices[0]["text"], enrol.reseed_notice("Dana Oren", "users/dana-oren"))
        later = self.confirm(conf("r4", "speaker_0", DANA_P, at(4)))
        self.assertEqual([n for n in later["notices"] if n["kind"] == "reseed"], [])

    def test_reseed_starts_the_print_again_from_the_next_confirmed_recording(self):
        self.stuck()
        pid = self.print_of(DANA_P)["id"]
        rep = enrol.reseed(self.store, MODEL, TH, pid, at(5))
        p = self.print_of(DANA_P)
        self.assertEqual([s["status"] for s in p["sources"]], ["reseeded", "admitted", "admitted"])
        self.assertEqual(p["sources"][0]["at"], at(5))
        self.assertEqual(p["trust"], "trusted")
        self.assertGreater(vec.cos(p["vector"], DANA), 0.99)
        self.assertEqual(rep["reseeded"]["audio"], audio_of("r1"))

    def test_a_replay_keeps_the_reseeded_print(self):
        self.stuck()
        enrol.reseed(self.store, MODEL, TH, self.print_of(DANA_P)["id"], at(5))
        after = essence(self.print_of(DANA_P))
        enrol.replay(self.store, MODEL, TH)
        self.assertEqual(essence(self.print_of(DANA_P)), after)

    def test_reseed_then_replay_in_a_new_model_folder_keeps_the_reseeded_print(self):
        self.stuck()
        enrol.reseed(self.store, MODEL, TH, self.print_of(DANA_P)["id"], at(5))
        poor = plane(DANA, PRIYA, 62.0)
        self.rec("r1", {"speaker_0": label(poor, "r1-poor"), "speaker_1": label(SAM, "r1-sam")}, model=MODEL_B)
        for i in (2, 3):
            self.rec(f"r{i}", {"speaker_0": label(DANA, f"r{i}-dana"), "speaker_1": label(SAM, f"r{i}-sam")},
                     model=MODEL_B)
        enrol.carry(self.store, MODEL.id, MODEL_B)
        enrol.replay(self.store, MODEL_B, TH)
        p = self.print_of(DANA_P, model=MODEL_B)
        self.assertEqual([s["status"] for s in p["sources"]], ["reseeded", "admitted", "admitted"])
        self.assertEqual(p["trust"], "trusted")
        self.assertGreater(vec.cos(p["vector"], DANA), 0.99)

    def test_reseed_of_a_print_with_no_admitted_source_is_refused(self):
        self.rec("r1", {"speaker_0": label(DANA, "r1-dana"), "speaker_1": label(SAM, "r1-sam")})
        self.confirm(conf("r1", "speaker_0", DANA_P, at(1)), th=None)
        with self.assertRaises(ValueError):
            enrol.reseed(self.store, MODEL, TH, self.print_of(DANA_P)["id"], at(5))


# -- corrections (design section 11) ----------------------------------------------------------------------------
class Corrections(StoreCase):
    def test_correcting_a_confirmed_first_source_moves_it_and_the_right_person_learns(self):
        """Round 5: Sam's voice confirmed as Dana by mistake is Dana's first source; Dana's own recording is then
        held and Sam's confirmation kept out by check 8. The correction undoes both."""
        self.rec("r1", {"speaker_0": label(SAM, "r1-sam"), "speaker_1": label(TOM, "r1-tom")})
        self.rec("r2", {"speaker_0": label(DANA, "r2-dana"), "speaker_1": label(TOM, "r2-tom")})
        self.rec("r3", {"speaker_0": label(TOM, "r3-tom"), "speaker_1": label(SAM, "r3-sam")})
        self.confirm(conf("r1", "speaker_0", DANA_P, at(1)))
        self.confirm(conf("r2", "speaker_0", DANA_P, at(2)))
        rep3 = self.confirm(conf("r3", "speaker_1", SAM_P, at(3)))
        self.assertEqual([s["status"] for s in self.print_of(DANA_P)["sources"]], ["admitted", "held"])
        self.assertEqual([c["check"] for c in rep3["kept_out"][0]["checks"]], [8])
        self.assertIsNone(self.print_of(SAM_P))

        pid = self.print_of(DANA_P)["id"]
        rep = enrol.correct_confirmed(self.store, MODEL, TH, ref("r1", "speaker_0"), pid, SAM_P, at=at(4))
        dana = self.print_of(DANA_P)
        self.assertEqual([(s["audio"], s["status"]) for s in dana["sources"]],
                         [(audio_of("r1"), "corrected"), (audio_of("r2"), "admitted")])
        self.assertGreater(vec.cos(dana["vector"], DANA), 0.99)
        sams = self.print_of(SAM_P)
        self.assertEqual([(s["audio"], s["status"]) for s in sams["sources"]], [(audio_of("r1"), "admitted")])
        self.assertEqual(rep["corrected"]["print"], pid)
        self.assertIn(pid, rep["changed"])
        self.assertIn(sams["id"], rep["changed"])

        self.confirm(conf("r3", "speaker_1", SAM_P, at(5)))
        self.assertEqual(self.print_of(SAM_P)["trust"], "trusted")

        before = {k: essence(v) for k, v in self.prints().items()}
        enrol.replay(self.store, MODEL, TH)                              # the correction is an input of every replay
        self.assertEqual({k: essence(v) for k, v in self.prints().items()}, before)

    def test_correcting_a_later_confirmed_source_takes_it_out_of_the_vector(self):
        """Ruling D5: a print of three admitted sources, the second corrected — it leaves the vector, the third
        stays admitted, and the right person learns from it."""
        s = plane(DANA, PRIYA, 32.0)                                    # 0.85 to Dana: admitted as hers
        d3 = plane(DANA, PRIYA, -14.0)                                  # the far side: 0.87 to the print of two
        self.rec("r1", {"speaker_0": label(DANA, "r1-dana"), "speaker_1": label(TOM, "r1-tom")})
        self.rec("r2", {"speaker_0": label(s, "r2-s"), "speaker_1": label(TOM, "r2-tom")})
        self.rec("r3", {"speaker_0": label(d3, "r3-dana"), "speaker_1": label(TOM, "r3-tom")})
        for i in (1, 2, 3):
            self.confirm(conf(f"r{i}", "speaker_0", DANA_P, at(i)))
        dana = self.print_of(DANA_P)
        self.assertEqual([x["status"] for x in dana["sources"]], ["admitted", "admitted", "admitted"])
        rep = enrol.correct_confirmed(self.store, MODEL, TH, ref("r2", "speaker_0"), dana["id"], PRIYA_P, at=at(4))
        dana = self.print_of(DANA_P)
        self.assertEqual([x["status"] for x in dana["sources"]], ["admitted", "corrected", "admitted"])
        c1 = naming.label_centroid(self.store.read_signature(MODEL.id, audio_of("r1"), diar_of("r1")), "speaker_0")
        c3 = naming.label_centroid(self.store.read_signature(MODEL.id, audio_of("r3"), diar_of("r3")), "speaker_0")
        want = vec.mean_unit([c1, c3])
        for a, b in zip(dana["vector"], want):
            self.assertAlmostEqual(a, b, places=12)
        priya = self.print_of(PRIYA_P)
        self.assertEqual([(x["audio"], x["status"]) for x in priya["sources"]], [(audio_of("r2"), "admitted")])
        self.assertEqual(rep["stored"][0]["status"], "admitted")

    def test_correcting_a_provisional_name_adds_a_negative_and_turns_auto_off(self):
        p = self.two_dana()
        self.rec("r3", {"speaker_0": label(plane(DANA, PRIYA, 20.0), "r3-x"), "speaker_1": label(SAM, "r3-sam")})
        rep = enrol.correct_provisional(self.store, MODEL, ref("r3", "speaker_0"), p["id"])
        p = self.print_of(DANA_P)
        self.assertEqual(p["negatives"], [ref("r3", "speaker_0")])
        self.assertFalse(p["auto"])
        self.assertFalse(rep["auto"])
        enrol.replay(self.store, MODEL, TH)                              # unchanged, it still matches its negative
        self.assertFalse(self.print_of(DANA_P)["auto"])
        again = self.confirm(conf("r3", "speaker_0", DANA_P, at(5)))   # check 9 keeps the negative out
        self.assertEqual([c["check"] for c in again["kept_out"][0]["checks"]], [9])

    def test_auto_returns_when_the_print_no_longer_matches_its_negative(self):
        """Design section 11: back to true only when the print, after a later rebuild, scores below
        `suggest` against every negative and passes its trust test."""
        p = self.two_dana()
        self.rec("r3", {"speaker_0": label(plane(DANA, PRIYA, 45.0), "r3-x"), "speaker_1": label(SAM, "r3-sam")})
        enrol.correct_provisional(self.store, MODEL, ref("r3", "speaker_0"), p["id"])
        enrol.replay(self.store, MODEL, TH)
        self.assertFalse(self.print_of(DANA_P)["auto"])                 # 0.71 against the negative
        for i, deg in ((4, -15.0), (5, -25.0)):                         # each matches the print so far
            self.rec(f"r{i}", {"speaker_0": label(plane(DANA, PRIYA, deg), f"r{i}-d"),
                               "speaker_1": label(SAM, f"r{i}-sam")})
            self.confirm(conf(f"r{i}", "speaker_0", DANA_P, at(i)))
        p = self.print_of(DANA_P)
        self.assertEqual([s["status"] for s in p["sources"]], ["admitted"] * 4)
        neg = naming.label_centroid(self.store.read_signature(MODEL.id, audio_of("r3"), diar_of("r3")), "speaker_0")
        self.assertLess(vec.cos(neg, p["vector"]), TH["suggest"] - 0.03)
        self.assertEqual(p["trust"], "trusted")
        self.assertTrue(p["auto"])
        self.assertEqual(p["negatives"], [ref("r3", "speaker_0")])

    def test_a_negative_whose_windows_are_gone_is_dropped_and_auto_waits_for_a_new_source(self):
        p = self.two_dana()
        self.rec("r3", {"speaker_0": label(plane(DANA, PRIYA, 20.0), "r3-x"), "speaker_1": label(SAM, "r3-sam")})
        enrol.correct_provisional(self.store, MODEL, ref("r3", "speaker_0"), p["id"])
        self.store.remove_windows(MODEL.id, audio_of("r3"), diar_of("r3"), "speaker_0")
        enrol.replay(self.store, MODEL, TH)
        p = self.print_of(DANA_P)
        self.assertEqual(p["negatives"], [])
        self.assertFalse(p["auto"])
        self.rec("r4", {"speaker_0": label(DANA, "r4-dana"), "speaker_1": label(SAM, "r4-sam")})
        self.confirm(conf("r4", "speaker_0", DANA_P, at(4)))
        self.assertTrue(self.print_of(DANA_P)["auto"])


# -- what a print holds -----------------------------------------------------------------------------------------
class PrintShape(StoreCase):
    def test_a_print_holds_no_name_beyond_known_as(self):
        self.build_two_people()
        for p in self.store.prints(MODEL.id, model=MODEL):
            rest = {k: v for k, v in p.items() if k != "known_as"}
            text = json.dumps(rest)
            for name in ("Dana Oren", "Sam Diaz"):
                self.assertNotIn(name, text)
            self.assertEqual(len(p["known_as"]), 1)
            self.assertEqual(set(p["known_as"][0]), {"workspace", "person", "name"})

    def test_the_print_and_source_shapes_are_design_section_8s(self):
        self.build_two_people()
        p = self.print_of(DANA_P)
        for k in ("version", "id", "known_as", "model", "vector", "seconds", "trust", "auto", "sources",
                  "negatives", "created", "updated"):
            self.assertIn(k, p)
        self.assertRegex(p["id"], r"^p-[0-9a-f]{8,}$")
        self.assertEqual(set(p["sources"][0]), {"audio", "diarization", "label", "workspace", "person", "condition",
                                                "seconds", "confirmed", "status", "reason"})
        self.assertEqual(p["sources"][0]["condition"], "device")
        store.parse_instant(p["sources"][0]["confirmed"])

    def test_a_signature_file_is_never_written_by_enrolment(self):
        self.build_two_people()
        path = self.store.signature_path(MODEL.id, audio_of("r1"), diar_of("r1"))
        before = Path(path).read_text(encoding="utf-8")
        enrol.replay(self.store, MODEL, TH)
        self.assertEqual(Path(path).read_text(encoding="utf-8"), before)

    def build_two_people(self):
        self.rec("r1", {"speaker_0": label(DANA, "r1-dana"), "speaker_1": label(SAM, "r1-sam")})
        self.confirm(conf("r1", "speaker_0", DANA_P, at(1)), conf("r1", "speaker_1", SAM_P, at(1)))


if __name__ == "__main__":
    unittest.main()
