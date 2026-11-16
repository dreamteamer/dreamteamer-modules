"""The naming algorithm (cr-modules-019 task 6): design section 10, steps 0 to 8, and the predicates
enrolment shares with it (checks 4 and 5, the label centroid, step 3).

Standard library only, so a bare python3 runs it (vp-naming.test.mjs). Every voice is synthetic and
made at run time by vp_synth.py, each voice and each source with its own seed (ruling D13); nothing
is read from or written to disk. The signature, context and print shapes are built by hand to design
section 8 and task 7's context.
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1] / "skills" / "transcribing-recordings"))

import vp_synth  # noqa: E402
from voiceprints import naming, vec  # noqa: E402

TH = {"accept": 0.80, "accept_open": 0.85, "margin": 0.10, "same": 0.75, "split": 0.55, "suggest": 0.65}
CALIB = {"model": "campp-en-voxceleb-lm", "thresholds": TH, "print_closed": "auto", "print_open": "auto",
         "source": "test fixture"}

DANA, SAM, PRIYA, TOM = (vp_synth.voice(s) for s in ("dana-oren", "sam-diaz", "priya-raman", "tom-whitfield"))
DANA_REF, SAM_REF, PRIYA_REF, TOM_REF = "users/dana-oren", "contacts/sam-diaz", "contacts/priya-raman", "users/tom-whitfield"
CAND = {
    DANA_REF: {"person": DANA_REF, "name": "Dana Oren", "kind": "user"},
    SAM_REF: {"person": SAM_REF, "name": "Sam Diaz", "kind": "contact"},
    PRIYA_REF: {"person": PRIYA_REF, "name": "Priya Raman", "kind": "contact"},
    TOM_REF: {"person": TOM_REF, "name": "Tom Whitfield", "kind": "user"},
}


# -- builders ------------------------------------------------------------------------------------------
def wins(vectors, start=0.0, size=6.0):
    return [{"start": start + i * size, "end": start + (i + 1) * size, "vector": v} for i, v in enumerate(vectors)]


def lab(vectors, seconds=120.0, longest=40.0, share=None):
    out = {"seconds": seconds, "longest_turn": longest, "windows": wins(vectors)}
    if share is not None:
        out["share"] = share
    return out


def voice_label(voice, seed, n=40, seconds=120.0, longest=40.0, share=None, noise=0.15):
    return lab(vp_synth.windows(voice, n, noise=noise, seed=seed), seconds=seconds, longest=longest, share=share)


def sig_of(labels, hint=None, fallback=None, removed=()):
    total = sum(l["seconds"] for l in labels.values()) or 1.0
    for l in labels.values():
        l.setdefault("share", l["seconds"] / total)
    return {"version": 1, "audio": "ab" * 32,
            "diarization": {"id": "7c1d09a4e2b1", "labels": len(labels), "speakers_hint": hint, "fallback": fallback},
            "labels": labels, "removed": list(removed)}


def a_print(vector, ref, trust="trusted", auto=True):
    return {"version": 1, "id": "p-" + ref.split("/")[-1], "vector": vector, "trust": trust, "auto": auto,
            "known_as": [{"workspace": "northwind-hq", "person": ref, "name": CAND[ref]["name"]}]}


def ctx_of(refs, meeting=True, certain=True, count=None, workspace="northwind-hq"):
    cands = [dict(CAND[r]) for r in refs]
    return {"workspace": workspace, "candidates": cands,
            "attendee_count": (len(cands) if count is None else count) if meeting else None,
            "attendee_count_certain": certain if meeting else False,
            "meeting": {"id": "meetings/2026/11/2026-11-20--northwind-weekly"} if meeting else None}


def floats_anywhere(obj):
    """True when `obj` holds a list with a float in it: a vector must never leave `decide`."""
    if isinstance(obj, dict):
        return any(floats_anywhere(v) for v in obj.values())
    if isinstance(obj, (list, tuple)):
        return any(isinstance(v, float) for v in obj) or any(floats_anywhere(v) for v in obj)
    return False


def two_person(dana_seed="dana-rec1", sam_seed="sam-rec1", hint=None):
    return sig_of({"speaker_0": voice_label(DANA, dana_seed), "speaker_1": voice_label(SAM, sam_seed)}, hint=hint)


def trusted_both():
    return {DANA_REF: a_print(vp_synth.near(DANA, 0.93, seed="pd"), DANA_REF),
            SAM_REF: a_print(vp_synth.near(SAM, 0.92, seed="ps"), SAM_REF)}


class Base(unittest.TestCase):
    def decide(self, sig, ctx, prints, existing=None, calib=CALIB):
        out = naming.decide(sig, ctx, prints, existing or {}, calib)
        self.assertFalse(floats_anywhere(out), "decide's output carries a vector")
        self.assertEqual(set(out), {"outcome", "names", "proposals", "flags", "reports"})
        return out


# -- the shared predicates (ruling D15) ------------------------------------------------------------------
class LongTurnTest(unittest.TestCase):
    """Check 4: two or more labels and a longest turn over 300 s or a share over 0.90."""

    def sig(self, longest=40.0, share=0.5, labels=2):
        ls = {"speaker_0": voice_label(DANA, "d", longest=longest, share=share)}
        if labels == 2:
            ls["speaker_1"] = voice_label(SAM, "s", share=1.0 - share)
        return sig_of(ls)

    def test_a_turn_over_five_minutes_fires(self):
        self.assertTrue(naming.long_turn("speaker_0", self.sig(longest=300.5)))
        self.assertFalse(naming.long_turn("speaker_0", self.sig(longest=300.0)))

    def test_a_share_over_ninety_percent_fires(self):
        self.assertTrue(naming.long_turn("speaker_0", self.sig(share=0.91)))
        self.assertFalse(naming.long_turn("speaker_0", self.sig(share=0.90)))

    def test_one_label_never_fires(self):
        self.assertFalse(naming.long_turn("speaker_0", self.sig(longest=1900.0, share=1.0, labels=1)))

    def test_no_meeting_is_needed(self):
        # the predicate reads the signature only: there is no context argument at all
        self.assertTrue(naming.long_turn("speaker_0", self.sig(longest=1920.0)))


class TwoVoicesTest(unittest.TestCase):
    """Check 5: 2-means centroids below `split` with the smaller group at least 20% of the windows."""

    def test_a_sixty_forty_mix_is_two_voices(self):
        s = sig_of({"speaker_0": lab(vp_synth.mixed(DANA, SAM, 60, 0.4, seed="mix1")),
                    "speaker_1": voice_label(PRIYA, "p")})
        self.assertTrue(naming.two_voices("speaker_0", s, TH["split"]))
        self.assertFalse(naming.two_voices("speaker_1", s, TH["split"]))

    def test_a_tenth_of_a_second_voice_is_not_enough(self):
        s = sig_of({"speaker_0": lab(vp_synth.mixed(DANA, SAM, 60, 0.1, seed="mix2"))})
        self.assertFalse(naming.two_voices("speaker_0", s, TH["split"]))

    def test_split_is_the_threshold(self):
        # two voices at cosine 0.6: two voices at split 0.65, one at split 0.55
        other = vp_synth.near(DANA, 0.6, seed="n06")
        s = sig_of({"speaker_0": lab(vp_synth.mixed(DANA, other, 60, 0.5, seed="mix3", noise=0.05))})
        self.assertTrue(naming.two_voices("speaker_0", s, 0.65))
        self.assertFalse(naming.two_voices("speaker_0", s, 0.55))

    def test_under_two_windows_is_one_voice(self):
        s = sig_of({"speaker_0": lab(vp_synth.windows(DANA, 1, seed="one"))})
        self.assertFalse(naming.two_voices("speaker_0", s, TH["split"]))


class LabelCentroidTest(unittest.TestCase):
    def test_robust_centroid_of_the_windows(self):
        ws = vp_synth.windows(DANA, 64, seed="c1") + vp_synth.windows(SAM, 16, seed="c2")
        s = sig_of({"speaker_0": lab(ws)})
        c = naming.label_centroid(s, "speaker_0")
        self.assertGreater(vec.cos(c, DANA), 0.97)
        self.assertEqual(c, vec.robust_centroid([w["vector"] for w in s["labels"]["speaker_0"]["windows"]]))

    def test_no_windows_no_centroid(self):
        s = sig_of({"speaker_0": lab([])})
        self.assertIsNone(naming.label_centroid(s, "speaker_0"))
        self.assertIsNone(naming.label_centroid(s, "speaker_9"))


class UsableTest(unittest.TestCase):
    """Step 3 on its own: rows in order, the first that matches wins."""

    def test_collapsed_by_fallback_and_by_one_declared(self):
        one = {"speaker_0": voice_label(DANA, "d")}
        for s in (sig_of(dict(one), fallback="diariser exited -10; one speaker"), sig_of(dict(one), hint=1)):
            u = naming.usable(s, 2, True, TH)
            self.assertEqual(u["outcome"], "collapsed")
            self.assertEqual(u["flags"], {"speaker_0": ["collapsed"]})

    def test_solo_pure_and_mixed(self):
        pure = sig_of({"speaker_0": voice_label(DANA, "d")}, hint=1)
        self.assertEqual(naming.usable(pure, 1, True, TH), {"outcome": "solo", "flags": {}, "reports": []})
        self.assertEqual(naming.usable(pure, None, False, TH)["outcome"], "solo")   # no meeting, --speakers 1
        mixed = sig_of({"speaker_0": lab(vp_synth.mixed(DANA, SAM, 60, 0.4, seed="m"))})
        u = naming.usable(mixed, 1, True, TH)
        self.assertEqual(u["outcome"], "mixed-suspected")
        self.assertEqual(u["flags"], {"speaker_0": ["may-hold-more-than-one-voice"]})

    def alike(self, hint=None, n=2):
        ls = {"speaker_0": voice_label(DANA, "a0"), "speaker_1": voice_label(DANA, "a1")}
        if n == 3:
            ls["speaker_2"] = voice_label(SAM, "a2")
        return sig_of(ls, hint=hint)

    def test_alike_labels_under_a_forced_or_equal_count_are_mixed_suspected(self):
        for s, count in ((self.alike(hint=2), 2), (self.alike(), 2), (self.alike(hint=3, n=3), 2)):
            u = naming.usable(s, count, True, TH)
            self.assertEqual(u["outcome"], "mixed-suspected")
            self.assertEqual(u["flags"]["speaker_0"], ["mixed-suspected"])
            self.assertEqual(u["flags"]["speaker_1"], ["mixed-suspected"])
            self.assertNotIn("speaker_2", u["flags"])

    def test_alike_labels_unconstrained_over_the_count_are_left_to_folding(self):
        u = naming.usable(self.alike(n=3), 2, True, TH)
        self.assertEqual(u, {"outcome": "usable", "flags": {}, "reports": []})

    def test_an_uncertain_count_may_equal_the_labels(self):
        # deviation (report): three distinct people on the invite but a user joined to no contact, so the
        # real count may be two — two alike labels may then be two attendees, not one split
        u = naming.usable(self.alike(), 3, False, TH)
        self.assertEqual(u["outcome"], "mixed-suspected")

    def test_a_long_turn_or_a_mixed_label_is_suspect(self):
        s = sig_of({"speaker_0": voice_label(DANA, "d", longest=1920.0),
                    "speaker_1": lab(vp_synth.mixed(SAM, PRIYA, 60, 0.4, seed="sp")),
                    "speaker_2": voice_label(TOM, "t")})
        u = naming.usable(s, 3, True, TH)
        self.assertEqual(u["outcome"], "usable")
        self.assertEqual(u["flags"], {"speaker_0": ["may-hold-more-than-one-voice"],
                                      "speaker_1": ["may-hold-more-than-one-voice"]})


# -- decide: step 3's rows win before any naming -----------------------------------------------------------
class CollapsedTest(Base):
    """Line 3: one label, two or more attendees — no machine name, no question, a reason."""

    def test_by_fallback_and_by_speakers_one(self):
        prints = trusted_both()
        for s in (sig_of({"speaker_0": voice_label(DANA, "d")}, fallback="diariser exited -10; one speaker"),
                  sig_of({"speaker_0": voice_label(DANA, "d")}, hint=1)):
            out = self.decide(s, ctx_of([DANA_REF, SAM_REF]), prints)
            self.assertEqual(out["outcome"], "collapsed")
            self.assertEqual(out["names"], {})
            self.assertEqual(out["proposals"], {})
            self.assertEqual(out["flags"], {"speaker_0": ["collapsed"]})
            self.assertTrue(any("--speakers 2" in r for r in out["reports"]), out["reports"])


class SoloTest(Base):
    def test_one_label_one_attendee_is_named(self):
        s = sig_of({"speaker_0": voice_label(DANA, "d")}, hint=1)
        out = self.decide(s, ctx_of([DANA_REF]), trusted_both())
        self.assertEqual(out["outcome"], "named")
        self.assertEqual(out["names"]["speaker_0"]["person"], DANA_REF)

    def test_a_mixed_solo_label_is_not_named(self):
        s = sig_of({"speaker_0": lab(vp_synth.mixed(DANA, SAM, 60, 0.4, seed="sm"))}, hint=1)
        out = self.decide(s, ctx_of([DANA_REF]), trusted_both())
        self.assertEqual(out["outcome"], "mixed-suspected")
        self.assertEqual(out["names"], {})
        self.assertEqual(out["flags"], {"speaker_0": ["may-hold-more-than-one-voice"]})


class AlikeLabelsTest(Base):
    """Line 29: two alike labels of a two-attendee recording — neither named, mixed suspected."""

    def test_two_alike_labels_under_a_forced_count(self):
        s = sig_of({"speaker_0": voice_label(DANA, "x0"), "speaker_1": voice_label(DANA, "x1")}, hint=2)
        out = self.decide(s, ctx_of([DANA_REF, SAM_REF]), trusted_both())
        self.assertEqual(out["outcome"], "mixed-suspected")
        self.assertEqual(out["names"], {})
        self.assertIn("mixed-suspected", out["flags"]["speaker_0"])
        self.assertIn("mixed-suspected", out["flags"]["speaker_1"])
        self.assertNotIn(SAM_REF, [p["person"] for p in out["proposals"].values()])


class FoldTest(Base):
    """Step 4 and held-out class 11: over-split labels folded, each label of a group carries the name."""

    def test_three_labels_two_attendees(self):
        s = sig_of({"speaker_0": voice_label(DANA, "f0"), "speaker_1": voice_label(SAM, "f1"),
                    "speaker_2": voice_label(DANA, "f2")})
        out = self.decide(s, ctx_of([DANA_REF, SAM_REF]), trusted_both())
        self.assertEqual(out["outcome"], "named")
        self.assertEqual({l: n["person"] for l, n in out["names"].items()},
                         {"speaker_0": DANA_REF, "speaker_1": SAM_REF, "speaker_2": DANA_REF})
        self.assertEqual(out["flags"], {})

    def test_four_labels_two_attendees_nobody_named_twice_across_groups(self):
        s = sig_of({"speaker_0": voice_label(DANA, "g0"), "speaker_1": voice_label(SAM, "g1"),
                    "speaker_2": voice_label(DANA, "g2"), "speaker_3": voice_label(SAM, "g3")})
        out = self.decide(s, ctx_of([DANA_REF, SAM_REF]), trusted_both())
        self.assertEqual({l: n["person"] for l, n in out["names"].items()},
                         {"speaker_0": DANA_REF, "speaker_1": SAM_REF, "speaker_2": DANA_REF, "speaker_3": SAM_REF})


# -- decide: scoring and assignment ---------------------------------------------------------------------
class TwoTrustedTest(Base):
    """Line 1 (the naming half): two trusted attendees, both right, with score and margin."""

    def test_both_named_right(self):
        out = self.decide(two_person(), ctx_of([DANA_REF, SAM_REF]), trusted_both())
        self.assertEqual(out["outcome"], "named")
        self.assertEqual({l: n["person"] for l, n in out["names"].items()},
                         {"speaker_0": DANA_REF, "speaker_1": SAM_REF})
        for n in out["names"].values():
            self.assertGreaterEqual(n["score"], TH["accept"])
            self.assertGreaterEqual(n["margin"], TH["margin"])
        self.assertEqual(out["proposals"], {})
        self.assertEqual(out["flags"], {})

    def test_deterministic(self):
        a = self.decide(two_person(), ctx_of([DANA_REF, SAM_REF]), trusted_both())
        b = self.decide(two_person(), ctx_of([DANA_REF, SAM_REF]), trusted_both())
        self.assertEqual(a, b)


class UnknownVoiceTest(Base):
    """Line 2: a voice with no print keeps its label, says so, and the nearest attendee is not written."""

    def test_unknown_voice(self):
        s = sig_of({"speaker_0": voice_label(DANA, "u0"), "speaker_1": voice_label(PRIYA, "u1")})
        prints = {DANA_REF: trusted_both()[DANA_REF],
                  SAM_REF: a_print(vp_synth.near(PRIYA, 0.55, seed="far"), SAM_REF)}   # nearest, below suggest
        out = self.decide(s, ctx_of([DANA_REF, SAM_REF], certain=False), prints)
        self.assertEqual(out["names"], {"speaker_0": out["names"]["speaker_0"]})
        self.assertEqual(out["names"]["speaker_0"]["person"], DANA_REF)
        self.assertNotIn("speaker_1", out["proposals"])
        self.assertIn(naming.no_match_line("speaker_1"), out["reports"])
        self.assertEqual(naming.no_match_line("speaker_1"), "Speaker 1: no known voice matched")
        self.assertEqual(out["outcome"], "waiting")

    def test_between_suggest_and_accept_is_a_proposal(self):
        s = sig_of({"speaker_0": voice_label(DANA, "u0"), "speaker_1": voice_label(PRIYA, "u1")})
        prints = {DANA_REF: trusted_both()[DANA_REF],
                  SAM_REF: a_print(vp_synth.near(PRIYA, 0.72, seed="mid"), SAM_REF)}
        out = self.decide(s, ctx_of([DANA_REF, SAM_REF], certain=False), prints)
        self.assertNotIn("speaker_1", out["names"])
        self.assertEqual(out["proposals"]["speaker_1"]["person"], SAM_REF)
        self.assertEqual(out["proposals"]["speaker_1"]["origin"], "print")


class MarginTest(Base):
    def test_a_second_candidate_within_margin(self):
        s = sig_of({"speaker_0": voice_label(DANA, "m0", noise=0.05), "speaker_1": voice_label(PRIYA, "m5")})
        prints = {DANA_REF: a_print(vp_synth.near(DANA, 0.90, seed="m1"), DANA_REF),
                  TOM_REF: a_print(vp_synth.near(DANA, 0.84, seed="m2"), TOM_REF)}
        out = self.decide(s, ctx_of([DANA_REF, TOM_REF], certain=False), prints)
        self.assertEqual(out["names"], {})
        self.assertEqual(out["proposals"]["speaker_0"]["person"], DANA_REF)

    def test_a_second_group_below_accept_but_within_margin_is_mixed(self):
        # review round 1: both labels resemble Dana's print (at `suggest`, 0.86 and 0.78) and lie within
        # `margin` of each other — line 4's contradiction, so neither is named NOR preselected
        a, b = vp_synth.near(DANA, 0.86, seed="sa"), vp_synth.near(DANA, 0.78, seed="sb")
        self.assertLess(vec.cos(a, b), TH["same"])
        s = sig_of({"speaker_0": voice_label(a, "m3", noise=0.05), "speaker_1": voice_label(b, "m4", noise=0.05)})
        prints = {DANA_REF: a_print(DANA, DANA_REF)}
        out = self.decide(s, ctx_of([DANA_REF, SAM_REF], certain=False), prints)
        self.assertEqual(out["outcome"], "mixed-suspected")
        self.assertEqual(out["names"], {})
        self.assertEqual(out["proposals"], {})
        self.assertEqual(out["flags"], {"speaker_0": ["mixed-suspected"], "speaker_1": ["mixed-suspected"]})

    def test_a_second_group_outside_the_margin_does_not_contradict(self):
        a, b = vp_synth.near(DANA, 0.92, seed="sc"), vp_synth.near(DANA, 0.70, seed="sd")
        s = sig_of({"speaker_0": voice_label(a, "m6", noise=0.05), "speaker_1": voice_label(b, "m7", noise=0.05)})
        out = self.decide(s, ctx_of([DANA_REF, SAM_REF], certain=False), {DANA_REF: a_print(DANA, DANA_REF)})
        self.assertEqual(out["names"]["speaker_0"]["person"], DANA_REF)
        self.assertEqual(out["flags"], {})
        self.assertNotEqual(out["outcome"], "mixed-suspected")


class TwoGroupsOnePrintTest(Base):
    """Line 4: two labels both resembling one print, unlike each other — neither named, mixed suspected."""

    def test_neither_named(self):
        p = vp_synth.near(DANA, 1.0)
        a = vp_synth.near(p, 0.84, seed="ga")
        b = vp_synth.near(p, 0.82, seed="gb")
        self.assertLess(vec.cos(a, b), TH["same"])
        s = sig_of({"speaker_0": voice_label(a, "g0", noise=0.05), "speaker_1": voice_label(b, "g1", noise=0.05)})
        out = self.decide(s, ctx_of([DANA_REF, SAM_REF]), {DANA_REF: a_print(p, DANA_REF),
                                                           SAM_REF: trusted_both()[SAM_REF]})
        self.assertEqual(out["outcome"], "mixed-suspected")
        self.assertEqual(out["names"], {})
        self.assertIn("mixed-suspected", out["flags"]["speaker_0"])
        self.assertIn("mixed-suspected", out["flags"]["speaker_1"])
        self.assertEqual(out["proposals"], {})

    def test_neither_named_nor_proposed_whatever_the_print_s_trust(self):
        # review round 1: line 4 carries no trust qualifier — a proposing print (a mixed first source
        # keeps it from ever being trusted) or a corrected one must not preselect one of the two labels
        p = vp_synth.near(DANA, 1.0)
        a = vp_synth.near(p, 0.84, seed="ga")
        b = vp_synth.near(p, 0.82, seed="gb")
        s = sig_of({"speaker_0": voice_label(a, "g0", noise=0.05), "speaker_1": voice_label(b, "g1", noise=0.05)})
        for trust, auto in (("proposing", True), ("trusted", False)):
            out = self.decide(s, ctx_of([DANA_REF, SAM_REF]), {DANA_REF: a_print(p, DANA_REF, trust=trust, auto=auto),
                                                               SAM_REF: trusted_both()[SAM_REF]})
            self.assertEqual(out["outcome"], "mixed-suspected", (trust, auto))
            self.assertEqual(out["names"], {})
            self.assertEqual(out["proposals"], {})
            self.assertEqual(out["flags"], {"speaker_0": ["mixed-suspected"], "speaker_1": ["mixed-suspected"]})
            self.assertTrue(any("both resemble Dana Oren" in r for r in out["reports"]), out["reports"])


class NoMeetingTest(Base):
    """Held-out class 9's shape: no meeting — a contact never written, a user only at accept_open."""

    def sig(self):
        return sig_of({"speaker_0": voice_label(DANA, "n0", noise=0.05), "speaker_1": voice_label(SAM, "n1", noise=0.05)})

    def test_contact_proposed_user_written_at_accept_open(self):
        prints = {DANA_REF: a_print(vp_synth.near(DANA, 0.90, seed="o1"), DANA_REF),
                  SAM_REF: a_print(vp_synth.near(SAM, 0.97, seed="o2"), SAM_REF)}
        out = self.decide(self.sig(), ctx_of([DANA_REF, SAM_REF], meeting=False), prints)
        self.assertEqual(out["names"]["speaker_0"]["person"], DANA_REF)
        self.assertNotIn("speaker_1", out["names"])
        self.assertEqual(out["proposals"]["speaker_1"]["person"], SAM_REF)

    def test_a_user_between_accept_and_accept_open_is_proposed(self):
        prints = {DANA_REF: a_print(vp_synth.near(DANA, 0.82, seed="o3"), DANA_REF)}
        out = self.decide(self.sig(), ctx_of([DANA_REF], meeting=False), prints)
        self.assertEqual(out["names"], {})
        self.assertEqual(out["proposals"]["speaker_0"]["person"], DANA_REF)

    def test_print_open_propose_writes_nothing(self):
        prints = {DANA_REF: a_print(vp_synth.near(DANA, 0.95, seed="o4"), DANA_REF)}
        out = self.decide(self.sig(), ctx_of([DANA_REF], meeting=False), prints,
                          calib=dict(CALIB, print_open="propose"))
        self.assertEqual(out["names"], {})
        self.assertEqual(out["proposals"]["speaker_0"]["person"], DANA_REF)

    def test_one_label_under_a_declared_count_of_two_is_collapsed(self):
        # review round 1: --speakers 2, the diariser fell back to one label holding both voices (the
        # second at 15%, under check 5) — the declared count stands in for the attendee count, as in
        # enrolment's call of `usable`, so naming and admission agree on one signature
        s = sig_of({"speaker_0": lab(vp_synth.mixed(DANA, SAM, 60, 0.15, seed="fb"))},
                   hint=2, fallback="diariser exited -10; one speaker")
        prints = {DANA_REF: a_print(vp_synth.near(DANA, 0.97, seed="fbp"), DANA_REF)}
        out = self.decide(s, ctx_of([DANA_REF], meeting=False), prints)
        self.assertEqual(out["outcome"], "collapsed")
        self.assertEqual(out["outcome"], naming.usable(s, 2, True, TH)["outcome"])
        self.assertEqual(out["names"], {})
        self.assertEqual(out["proposals"], {})
        self.assertEqual(out["flags"], {"speaker_0": ["collapsed"]})
        self.assertTrue(any("--speakers 2" in r for r in out["reports"]), out["reports"])
        # --speakers 1 declared with no meeting is still solo, and named at accept_open
        solo = sig_of({"speaker_0": voice_label(DANA, "fs", noise=0.05)}, hint=1)
        out = self.decide(solo, ctx_of([DANA_REF], meeting=False), prints)
        self.assertEqual(out["names"]["speaker_0"]["person"], DANA_REF)


class ExistingNameTest(Base):
    """Line 15: a typed or confirmed name is never replaced; a disagreement is reported."""

    def test_untouched_of_any_status_and_disagreement_reported(self):
        for status in ("confirmed", "provisional", "unverified"):
            existing = {"speaker_0": {"name": "Tom Whitfield", "status": status}}
            out = self.decide(two_person(), ctx_of([DANA_REF, SAM_REF, TOM_REF], count=3), trusted_both(), existing)
            self.assertNotIn("speaker_0", out["names"])
            self.assertNotIn("speaker_0", out["proposals"])
            self.assertEqual(out["names"]["speaker_1"]["person"], SAM_REF)
            self.assertTrue(any("Speaker 0" in r and "Dana Oren" in r and "Tom Whitfield" in r
                                for r in out["reports"]), out["reports"])

    def test_agreeing_name_reports_nothing(self):
        existing = {"speaker_0": {"name": "Dana Oren", "person": DANA_REF, "status": "confirmed"}}
        out = self.decide(two_person(), ctx_of([DANA_REF, SAM_REF]), trusted_both(), existing)
        self.assertNotIn("speaker_0", out["names"])
        self.assertEqual(out["names"]["speaker_1"]["person"], SAM_REF)
        self.assertEqual(out["reports"], [])
        self.assertEqual(out["outcome"], "named")


class ConflictTest(Base):
    """Line 38: a person named on one label is not written on another; that label is flagged and asked."""

    def test_conflicts_with(self):
        s = sig_of({"speaker_0": voice_label(SAM, "c0"), "speaker_1": voice_label(DANA, "c1")})
        for existing in ({"speaker_0": {"name": "Dana Oren", "person": DANA_REF, "status": "confirmed"}},
                         {"speaker_0": {"name": "Dana Oren", "status": "unverified"}}):   # by the name string
            out = self.decide(s, ctx_of([DANA_REF, SAM_REF]), trusted_both(), existing)
            self.assertNotIn("speaker_1", out["names"])
            self.assertNotIn("speaker_1", out["proposals"])
            self.assertEqual(out["flags"]["speaker_1"], ["conflicts-with:speaker_0"])
            self.assertTrue(any("Speaker 1" in r and "Dana Oren" in r and "Speaker 0" in r
                                for r in out["reports"]), out["reports"])
            self.assertNotIn(DANA_REF, [n["person"] for n in out["names"].values()])


class EliminationTest(Base):
    """Line 10: one voice and one attendee left — a proposal, never a name."""

    def sig(self):
        return sig_of({"speaker_0": voice_label(DANA, "e0"), "speaker_1": voice_label(PRIYA, "e1")})

    def test_proposes_only(self):
        prints = {DANA_REF: trusted_both()[DANA_REF]}
        out = self.decide(self.sig(), ctx_of([DANA_REF, SAM_REF]), prints)
        self.assertEqual(out["names"]["speaker_0"]["person"], DANA_REF)
        self.assertNotIn("speaker_1", out["names"])
        self.assertEqual(out["proposals"]["speaker_1"],
                         {"person": SAM_REF, "origin": "attendees", "why": "the only attendee left"})

    def test_off_when_the_count_is_uncertain(self):
        out = self.decide(self.sig(), ctx_of([DANA_REF, SAM_REF], certain=False), {DANA_REF: trusted_both()[DANA_REF]})
        self.assertEqual(out["proposals"], {})

    def test_off_when_groups_differ_from_the_count(self):
        out = self.decide(self.sig(), ctx_of([DANA_REF, SAM_REF, TOM_REF]), {DANA_REF: trusted_both()[DANA_REF]})
        self.assertEqual(out["proposals"], {})

    def test_not_against_the_left_attendee_s_own_trusted_print(self):
        # deviation (report): Sam has a trusted print that says the voice is not Sam's
        out = self.decide(self.sig(), ctx_of([DANA_REF, SAM_REF]), trusted_both())
        self.assertEqual(out["proposals"], {})
        self.assertIn(naming.no_match_line("speaker_1"), out["reports"])

    def test_not_onto_a_label_that_may_hold_more_than_one_voice(self):
        # review round 1: the only label left has a 31-minute turn (check 4) — it is asked about with
        # no attendee preselected
        s = sig_of({"speaker_0": voice_label(DANA, "e0"),
                    "speaker_1": voice_label(PRIYA, "e1", seconds=1900.0, longest=1900.0)})
        out = self.decide(s, ctx_of([DANA_REF, SAM_REF]), {DANA_REF: trusted_both()[DANA_REF]})
        self.assertEqual(out["names"]["speaker_0"]["person"], DANA_REF)
        self.assertEqual(out["flags"], {"speaker_1": ["may-hold-more-than-one-voice"]})
        self.assertEqual(out["proposals"], {})
        self.assertEqual(out["outcome"], "waiting")


class LongTurnLabelTest(Base):
    """Line 26: a label with a turn over five minutes is not named from a print, and is flagged."""

    def test_not_named_and_flagged(self):
        s = sig_of({"speaker_0": voice_label(DANA, "l0", seconds=1920.0, longest=1920.0),
                    "speaker_1": voice_label(SAM, "l1", seconds=300.0)})
        out = self.decide(s, ctx_of([DANA_REF, SAM_REF]), trusted_both())
        self.assertNotIn("speaker_0", out["names"])
        self.assertEqual(out["flags"]["speaker_0"], ["may-hold-more-than-one-voice"])
        self.assertEqual(out["names"]["speaker_1"]["person"], SAM_REF)
        self.assertEqual(out["outcome"], "waiting")

    def test_a_flag_on_a_label_that_already_has_a_name_is_not_a_question(self):
        # review round 1 (section 11): a label with a name of any status is never rewritten and is not
        # re-asked, so a step-3 flag on it stays out of decide's flags and the outcome is `named`;
        # `usable` itself still flags it, which is what enrolment's admission reads
        s = sig_of({"speaker_0": voice_label(DANA, "l0", seconds=1920.0, longest=1920.0),
                    "speaker_1": voice_label(SAM, "l1", seconds=300.0)})
        existing = {"speaker_0": {"name": "Dana Oren", "person": DANA_REF, "status": "confirmed"}}
        out = self.decide(s, ctx_of([DANA_REF, SAM_REF]), trusted_both(), existing)
        self.assertEqual(out["outcome"], "named")
        self.assertEqual(out["flags"], {})
        self.assertEqual(out["names"], {"speaker_1": out["names"]["speaker_1"]})
        self.assertEqual(out["names"]["speaker_1"]["person"], SAM_REF)
        self.assertEqual(naming.usable(s, 2, True, TH)["flags"], {"speaker_0": ["may-hold-more-than-one-voice"]})
        # two alike labels under a forced count, both already named by a person: nothing left to ask
        alike = sig_of({"speaker_0": voice_label(DANA, "x0"), "speaker_1": voice_label(DANA, "x1")}, hint=2)
        named = {"speaker_0": {"name": "Dana Oren", "person": DANA_REF, "status": "confirmed"},
                 "speaker_1": {"name": "Sam Diaz", "person": SAM_REF, "status": "confirmed"}}
        out = self.decide(alike, ctx_of([DANA_REF, SAM_REF]), trusted_both(), named)
        self.assertEqual((out["outcome"], out["flags"], out["names"], out["proposals"]), ("named", {}, {}, {}))


class TrustAndSwitchTest(Base):
    def test_a_proposing_print_or_auto_false_only_proposes(self):
        for trust, auto in (("proposing", True), ("trusted", False)):
            prints = trusted_both()
            prints[DANA_REF] = dict(prints[DANA_REF], trust=trust, auto=auto)
            out = self.decide(two_person(), ctx_of([DANA_REF, SAM_REF]), prints)
            self.assertNotIn("speaker_0", out["names"])
            self.assertEqual(out["proposals"]["speaker_0"]["person"], DANA_REF)
            self.assertEqual(out["names"]["speaker_1"]["person"], SAM_REF)

    def test_print_closed_propose(self):
        out = self.decide(two_person(), ctx_of([DANA_REF, SAM_REF]), trusted_both(),
                          calib=dict(CALIB, print_closed="propose"))
        self.assertEqual(out["names"], {})
        self.assertEqual({l: p["person"] for l, p in out["proposals"].items()},
                         {"speaker_0": DANA_REF, "speaker_1": SAM_REF})

    def test_a_label_under_twenty_seconds_is_proposed(self):
        s = sig_of({"speaker_0": voice_label(DANA, "t0", n=4, seconds=15.0), "speaker_1": voice_label(SAM, "t1")})
        out = self.decide(s, ctx_of([DANA_REF, SAM_REF]), trusted_both())
        self.assertNotIn("speaker_0", out["names"])
        self.assertEqual(out["proposals"]["speaker_0"]["person"], DANA_REF)
        self.assertEqual(out["names"]["speaker_1"]["person"], SAM_REF)


class NoCalibrationTest(Base):
    """Line 18: no calibration for the active model — no name; proposals stay."""

    def test_writes_nothing(self):
        out = self.decide(two_person(), ctx_of([DANA_REF, SAM_REF]), trusted_both(), calib=None)
        self.assertEqual(out["names"], {})
        self.assertEqual({l: p["person"] for l, p in out["proposals"].items()},
                         {"speaker_0": DANA_REF, "speaker_1": SAM_REF})
        self.assertTrue(any("calibration" in r for r in out["reports"]), out["reports"])


class ReportsTest(Base):
    def test_an_uninvited_user_is_reported_never_named(self):
        s = sig_of({"speaker_0": voice_label(DANA, "r0"), "speaker_1": voice_label(TOM, "r1")})
        prints = dict(trusted_both(), **{TOM_REF: a_print(vp_synth.near(TOM, 0.93, seed="pt"), TOM_REF)})
        out = self.decide(s, ctx_of([DANA_REF, SAM_REF], certain=False), prints)
        self.assertNotIn("speaker_1", out["names"])
        self.assertNotIn(TOM_REF, [p["person"] for p in out["proposals"].values()])
        self.assertIn("Speaker 1 sounds like Tom Whitfield, who was not invited", out["reports"])

    def test_an_uninvited_print_known_only_in_another_workspace_is_never_named(self):
        # review round 1 (acceptance line 31): run in northwind-hq, Tom's print is known only in another
        # workspace — the report says a print from elsewhere resembles the voice, and gives no name
        s = sig_of({"speaker_0": voice_label(DANA, "r0"), "speaker_1": voice_label(TOM, "r1")})
        tom = a_print(vp_synth.near(TOM, 0.93, seed="pt"), TOM_REF)
        tom["known_as"] = [{"workspace": "harbor-mutual-hq", "person": TOM_REF, "name": "Tom Whitfield"}]
        out = self.decide(s, ctx_of([DANA_REF, SAM_REF], certain=False), dict(trusted_both(), **{TOM_REF: tom}))
        self.assertNotIn("speaker_1", out["names"])
        self.assertNotIn("speaker_1", out["proposals"])
        self.assertFalse(any("Tom Whitfield" in r for r in out["reports"]), out["reports"])
        self.assertIn("Speaker 1 resembles a voice print from another workspace", out["reports"])

    def test_a_removed_label_is_never_scored_or_proposed(self):
        s = sig_of({"speaker_0": voice_label(DANA, "x0"), "speaker_1": lab([], seconds=200.0)}, removed=["speaker_1"])
        out = self.decide(s, ctx_of([DANA_REF, SAM_REF]), trusted_both())
        self.assertEqual(out["names"]["speaker_0"]["person"], DANA_REF)
        self.assertNotIn("speaker_1", out["names"])
        self.assertNotIn("speaker_1", out["proposals"])
        self.assertNotIn("speaker_1", out["flags"])

    def test_no_print_at_all_is_none(self):
        out = self.decide(two_person(), ctx_of([DANA_REF, SAM_REF], certain=False), {})
        self.assertEqual(out["outcome"], "none")
        self.assertEqual(out["names"], {})
        self.assertEqual(out["proposals"], {})


if __name__ == "__main__":
    unittest.main()
