"""The developer's calibration tools (cr-modules-019 task 8): `calibration` (the shipped and local
calibration, the active model, the decision rule of design section 13), `label` (the listening session)
and `evaluate` (`plan`, the evaluation with its leave-one-recording-out folds, `--write`).

Standard library only, so a bare python3 runs it (vp-calibration.test.mjs). Every voice is synthetic and
made at run time by vp_synth.py, each voice and each label with its own seed (ruling D13); every store is
a temp directory with a fake `exclude_backup` (ruling D14). No sound is played and no audio is read: the
player and ffmpeg are replaced, and record files are read through an injected reader (no PyYAML here).
"""
from __future__ import annotations

import contextlib
import hashlib
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1] / "skills" / "transcribing-recordings"))

import vp_synth  # noqa: E402
from voiceprints import calibration, evaluate, label, models, naming, store, vec  # noqa: E402

CAMPP = models.DEFAULT_MODEL
ERES = "eres2netv2-zh-cn-16k-common"
PIN_C = store.Model(CAMPP, "c" * 64, 64)
PIN_E = store.Model(ERES, "e" * 64, 64)
WS = "northwind-hq"

DANA, SAM, PRIYA, TOM, GUEST = ("users/dana-oren", "contacts/sam-diaz", "contacts/priya-raman",
                                "users/tom-whitfield", "contacts/guest-01")
NAMES = {DANA: "Dana Oren", SAM: "Sam Diaz", PRIYA: "Priya Raman", TOM: "Tom Whitfield", GUEST: "Guest One"}
VOICE = {p: vp_synth.voice(p) for p in NAMES}

# The acceptance line class Line19 holds (cr-modules-019, line 19), quoted in its docstring.
LINE_19 = ("The developer's evaluation over labelled recordings prints for each speaker model the purity of "
           "each diarised label and the scores of true and false matches and one line saying which model and "
           "thresholds its rule selects or that none qualifies")


def no_exclude(home):
    return None


def audio_of(name):
    return hashlib.sha256(("audio:" + name).encode()).hexdigest()


def diar_of(name):
    return hashlib.sha256(("diar:" + name).encode()).hexdigest()[:12]


class Tmp(unittest.TestCase):
    def setUp(self):
        self._td = tempfile.TemporaryDirectory()
        self.root = self._td.name
        self._env = {k: os.environ.get(k) for k in ("HOME", "VOICE_PRINTS_HOME")}
        os.environ["HOME"] = os.path.join(self.root, "home")
        os.environ["VOICE_PRINTS_HOME"] = os.path.join(self.root, "home", "voice-prints")
        os.makedirs(os.environ["HOME"])
        self.store = store.Store(os.path.join(self.root, "store"), exclude_backup=no_exclude)

    def tearDown(self):
        for k, v in self._env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        self._td.cleanup()


# ---------------------------------------------------------------------------------------------------------
# a synthetic world: 14 recordings to judge, the solo memo, the pilot with its mixed label, one unlabelled
# ---------------------------------------------------------------------------------------------------------
SPEC = [  # id, date, the other people (Dana is speaker_0 of each), location
    ("r01", "2026-01-05", [SAM], None),
    ("r02", "2026-01-12", [SAM], "https://meet.example/abc"),
    ("r03", "2026-01-19", [SAM], None),
    ("r04", "2026-01-26", [PRIYA], None),
    ("r05", "2026-02-02", [PRIYA], None),
    ("r06", "2026-02-09", [PRIYA], None),
    ("r07", "2026-02-16", [TOM], None),
    ("r08", "2026-02-23", [TOM], None),
    ("r09", "2026-03-02", [SAM, PRIYA], None),
    ("r10", "2026-03-09", [TOM, PRIYA], None),
    ("r11", "2026-03-16", [SAM, TOM], None),
    ("r12", "2026-03-23", [PRIYA, GUEST], None),
    ("r13", "2026-03-30", [TOM], "Northwind office, room 4"),
    ("r14", "2026-04-06", [SAM], "Harbor Mutual boardroom"),
]
FOLD_IDS = [s[0] for s in SPEC]


def ref_of(rid):
    return f"meeting-recordings/2026/{rid}"


def label_windows(rid, lab, speaker, n=20):
    return vp_synth.windows(VOICE[speaker], n, noise=0.15, seed=(rid, lab, speaker))


class World:
    """The recordings, record frontmatter, signature files and labelling answers of one synthetic
    calibration session, written into `st` (a temp store). Nothing here touches audio."""

    def __init__(self, st, root, models_with_signatures=(PIN_C,), silver=True):
        self.st, self.root = st, root
        self.records, self.fms, self.truth, self.sig_labels = [], {}, {}, {}
        self.computed = []
        for rid, date, others, loc in SPEC:
            people = [DANA] + list(others)
            labels = {f"speaker_{i}": p for i, p in enumerate(people)}
            self.add(rid, date, people, labels, loc=loc)
        # the solo memo: one label, --speakers 1, no meeting
        self.add("m01", "2026-04-10", [DANA], {"speaker_0": DANA}, meeting=False, hint=1)
        # the pilot: Dana's label holds Tom too (heard 4 to 2), and a 40-minute turn
        self.add("p01", "2025-12-01", [DANA, TOM], {"speaker_0": (DANA, TOM), "speaker_1": TOM},
                 answers={"speaker_0": [DANA] * 4 + [TOM] * 2}, longest={"speaker_0": 2400.0})
        # diarised and never labelled: not part of the evaluation
        self.add("u01", "2026-04-12", [DANA, SAM], {"speaker_0": DANA, "speaker_1": SAM}, label_it=False)
        if silver:
            # r12's guest label was never heard; its hand map says Sam — a silver disagreement
            fm = self.fms[self.path("r12")]
            fm["transcription"]["previous_speakers"] = {"diarization_id": "0123456789ab", "labels": {
                "speaker_9": {"name": "Sam Diaz", "new_label": "speaker_2", "share": 0.9, "offered": True}}}
            ans = self.answers_path("r12")
            data = json.loads(Path(ans).read_text())
            del data["labels"]["speaker_2"]
            self.st.write_json(ans, data)
        for pin in models_with_signatures:
            for r in self.records:
                self.st.write_signature(pin.id, self.signature(r["_rid"], pin),
                                        record={"workspace": WS, "record": r["record"]})

    def path(self, rid):
        return os.path.join(self.root, "records", f"{rid}.meeting-recording.md")

    def add(self, rid, date, people, labels, loc=None, meeting=True, hint=None, answers=None, longest=None,
            label_it=True):
        audio, diar = audio_of(rid), diar_of(rid)
        cands = [{"person": p, "name": NAMES[p], "kind": "user" if p.startswith("users/") else "contact"}
                 for p in people]
        cands[0]["you"] = True
        ctx = {"workspace": WS, "record": ref_of(rid), "record_path": self.path(rid), "audio": f"/nonexistent/{rid}.m4a",
               "fingerprint": "sha256:" + audio, "diarization_id": diar,
               "meeting": ({"ref": f"meetings/2026/{rid}", "name": f"Northwind call {rid}", "date": date,
                            "location": loc} if meeting else None),
               "candidates": cands if meeting else [{"person": DANA, "name": NAMES[DANA], "kind": "user"}],
               "attendee_count": len(people) if meeting else None, "attendee_count_certain": bool(meeting),
               "known": dict(NAMES), "guard": {}, "_rid": rid}
        self.records.append(ctx)
        self.fms[self.path(rid)] = {"date": date, "transcription": {
            "diarization_id": diar, **({"speakers_hint": hint} if hint else {"speakers_hint": len(people)})}}
        self.sig_labels[rid] = {}
        for lab, who in labels.items():
            if isinstance(who, tuple):
                ws = vp_synth.mixed(VOICE[who[0]], VOICE[who[1]], 20, 0.35, seed=(rid, lab))
            else:
                ws = label_windows(rid, lab, who)
            self.sig_labels[rid][lab] = {"windows": ws, "longest": (longest or {}).get(lab, 60.0)}
            self.truth[(rid, lab)] = who
        if label_it:
            data = {"version": 1, "audio": audio, "diarization": diar, "record": {"workspace": WS, "record": ref_of(rid)},
                    "candidates": people, "labels": {}, "complete": True}
            for lab, who in labels.items():
                said = (answers or {}).get(lab) or [who] * 6
                data["labels"][lab] = {"windows": [{"start": 10.0 * i, "end": 10.0 * i + 6.0, "answer": a}
                                                   for i, a in enumerate(said)]}
            self.st.write_json(self.answers_path(rid), data)

    def answers_path(self, rid):
        return label.labels_path(self.st, audio_of(rid), diar_of(rid))

    def signature(self, rid, pin, noise_seed=""):
        labs = self.sig_labels[rid]
        out = {}
        for lab, d in labs.items():
            vs = d["windows"] if not noise_seed else [vp_synth.near(v, 0.995, seed=(noise_seed, rid, lab, i))
                                                       for i, v in enumerate(d["windows"])]
            out[lab] = {"seconds": 300.0, "share": round(1.0 / len(labs), 4), "longest_turn": d["longest"],
                        "windows": [{"start": 6.0 * i, "end": 6.0 * i + 6.0, "vector": v} for i, v in enumerate(vs)]}
        hint = self.fms[self.path(rid)]["transcription"].get("speakers_hint")
        return {"version": 1, "audio": audio_of(rid),
                "diarization": {"id": diar_of(rid), "labels": len(out), "speakers_hint": hint, "fallback": None},
                "model": {"id": pin.id, "sha256": pin.sha256, "dim": pin.dim}, "labels": out, "removed": []}

    def ctx_all(self):
        return {"workspace": WS, "guard": {}, "known": dict(NAMES),
                "records": [{k: v for k, v in r.items() if k != "_rid"} for r in self.records]}

    def read(self, path):
        return self.fms[path], ""

    @staticmethod
    def audio_key(ctx, audio):
        return ctx["fingerprint"].split(":", 1)[1]

    def compute(self, model_id, rctx, audio, removed=()):
        """The stand-in for embedding a recording with a model that has no signature file yet."""
        rid = next(r["_rid"] for r in self.records if r["record"] == rctx["record"])
        self.computed.append((model_id, rid))
        pin = {CAMPP: PIN_C, ERES: PIN_E}[model_id]
        return self.signature(rid, pin, noise_seed=model_id)


def run_world(world, only=None, pins=None, pilot=ref_of("p01")):
    lines = []
    result = evaluate.run(world.ctx_all(), world.st, pins or {CAMPP: PIN_C}, read=world.read,
                          audio_key=world.audio_key, compute=world.compute, pilot=pilot, out=lines.append)
    return result, lines + evaluate.render(result)


def walk(obj):
    if isinstance(obj, dict):
        for v in obj.values():
            yield from walk(v)
    elif isinstance(obj, list):
        yield obj
        for v in obj:
            yield from walk(v)
    else:
        yield obj


# ---------------------------------------------------------------------------------------------------------
# calibration: fit (rule 2)
# ---------------------------------------------------------------------------------------------------------
GEN = [0.80, 0.82, 0.84, 0.85, 0.86, 0.88, 0.90, 0.91, 0.92, 0.93, 0.94, 0.95]
IMP_C = [0.10, 0.15, 0.20, 0.30]
IMP_O = IMP_C + [0.05, 0.12, 0.18, 0.25, 0.28, 0.33]


class Fit(unittest.TestCase):
    def test_rule_2_exactly(self):
        f = calibration.fit(GEN, IMP_C, IMP_O, cross_label=[0.1, 0.2, 0.3, 0.4], pure_split=[0.9, 0.92, 0.95, 0.97],
                            mixed_split=[0.2, 0.3, 0.4, 0.5, 0.6])
        sd = calibration.stdev(IMP_O)
        self.assertAlmostEqual(f["accept"], round(max(IMP_C) + sd, 4))
        self.assertAlmostEqual(f["accept_open"], round(max(IMP_O) + sd, 4))
        p95 = calibration.percentile(IMP_O, 95)
        self.assertAlmostEqual(f["suggest"], round(p95, 4))
        self.assertAlmostEqual(f["margin"], round(max(0.05, (calibration.percentile(GEN, 50) - p95) / 2), 4))
        self.assertAlmostEqual(f["same"], round(calibration.percentile([0.1, 0.2, 0.3, 0.4], 95), 4))
        self.assertAlmostEqual(f["split"], round(calibration.percentile([0.9, 0.92, 0.95, 0.97], 5), 4))
        self.assertFalse(f["split_weak"])
        self.assertEqual(f["mixed"], {"pass": 0, "sets": 5})

    def test_margin_never_below_0_05(self):
        f = calibration.fit([0.70] * 12, [0.30], [0.30, 0.65, 0.66, 0.67], [0.1], [0.9], [0.1])
        self.assertNotIn("fails", f)
        self.assertEqual(f["margin"], 0.05)

    def test_a_model_fails_when_impostors_overlap_genuine(self):
        f = calibration.fit([0.40, 0.50, 0.60, 0.70, 0.80], [0.55, 0.60], [0.30, 0.55, 0.60], [0.1], [0.9], [0.1])
        self.assertIn("fails", f)
        self.assertIn("10th percentile", f["fails"])

    def test_split_weak_when_two_of_five_mixed_sets_pass(self):
        f = calibration.fit(GEN, IMP_C, IMP_O, [0.1], [0.80, 0.85, 0.90], [0.90, 0.95, 0.30, 0.40, 0.50])
        self.assertEqual(f["mixed"], {"pass": 2, "sets": 5})
        self.assertTrue(f["split_weak"])
        f = calibration.fit(GEN, IMP_C, IMP_O, [0.1], [0.80, 0.85, 0.90], [0.95, 0.30, 0.40, 0.50, 0.20])
        self.assertEqual(f["mixed"], {"pass": 1, "sets": 5})
        self.assertFalse(f["split_weak"])

    def test_split_weak_is_decided_on_the_fifth_and_the_thirty_percent_sets_are_a_second_look(self):
        # review finding mixed-sets-at-thirty-percent-not-the-fifth-line-8-names: at 30% every set separates,
        # at a fifth two of five pass `split` — the check is weak, whatever the 30% sets say
        f = calibration.fit(GEN, IMP_C, IMP_O, [0.1], [0.80, 0.85, 0.90], mixed_split=[0.90, 0.95, 0.30, 0.40, 0.50],
                            mixed_second=[0.10, 0.20, 0.30, 0.40, 0.50])
        self.assertTrue(f["split_weak"])
        self.assertEqual(f["mixed"], {"pass": 2, "sets": 5})
        self.assertEqual(f["mixed_second"], {"pass": 0, "sets": 5})
        f = calibration.fit(GEN, IMP_C, IMP_O, [0.1], [0.80, 0.85, 0.90], mixed_split=[0.10, 0.20, 0.30, 0.40, 0.50],
                            mixed_second=[0.90, 0.95, 0.96, 0.97, 0.98])
        self.assertFalse(f["split_weak"], "the 30% sets never decide")
        self.assertEqual(f["mixed_second"], {"pass": 5, "sets": 5})


# ---------------------------------------------------------------------------------------------------------
# calibration: the decision rule (rules 1, 3, 4, 5) and the verdict line
# ---------------------------------------------------------------------------------------------------------
def result(model=CAMPP, written=13, wrong=0, judged=28, eligible=20, named=13, thin=0, mixed=0, open_wrong=0,
           genuine=20, impostor=110, recordings=14, people=4, fails=None, folds=14):
    fit = {"fails": fails} if fails else {"accept": 0.61, "accept_open": 0.66, "margin": 0.12, "same": 0.55,
                                          "split": 0.48, "suggest": 0.42, "split_weak": False,
                                          "mixed": {"pass": 0, "sets": 5}}
    fold_rows = [{"record": f"meeting-recordings/2026/r{i:02d}", "recordings": 13, "genuine": 18 + i % 2,
                  "impostor": 100 + i, "closed": 22, "thin": i < thin} for i in range(folds)]
    return {"model": {"id": model, "sha256": "c" * 64, "dim": 64},
            "evidence": {"genuine": genuine, "impostor": impostor, "recordings": recordings, "people": people},
            "fit": fit, "folds": fold_rows, "written": written, "wrong": wrong, "judged": judged,
            "eligible": eligible, "named_eligible": named, "open_written": written, "open_wrong": open_wrong,
            "enrolled_mixed": mixed, "thin": thin}


class Verdict(unittest.TestCase):
    def test_insufficient_label_more(self):
        v = calibration.verdict({CAMPP: result(genuine=10), ERES: result(ERES, genuine=10)})
        self.assertIn("insufficient, label more", v.splitlines()[0])
        self.assertEqual(calibration.choose({CAMPP: result(genuine=10)})["kind"], "insufficient")
        for low in (dict(impostor=39), dict(recordings=11), dict(people=3)):
            self.assertEqual(calibration.choose({CAMPP: result(**low)})["kind"], "insufficient", low)

    def test_campp_kept_when_both_qualify_and_the_other_is_not_clearly_better(self):
        c = calibration.choose({CAMPP: result(written=13), ERES: result(ERES, written=15)})
        self.assertEqual((c["kind"], c["model"]), ("chosen", CAMPP))
        # three labels more but under ten points (13/40 against 16/40 is 7.5 points)
        c = calibration.choose({CAMPP: result(written=13, judged=40), ERES: result(ERES, written=16, judged=40)})
        self.assertEqual(c["model"], CAMPP)
        line = calibration.verdict({CAMPP: result(written=13), ERES: result(ERES, written=15)}).splitlines()[0]
        self.assertTrue(line.startswith(f"verdict: {CAMPP}"), line)
        self.assertIn("accept 0.61", line)

    def test_the_other_model_chosen_with_ten_points_and_three_labels_more(self):
        c = calibration.choose({CAMPP: result(written=13), ERES: result(ERES, written=17, named=17)})
        self.assertEqual((c["kind"], c["model"]), ("chosen", ERES))
        self.assertTrue(calibration.verdict({CAMPP: result(written=13), ERES: result(ERES, written=17, named=17)})
                        .startswith(f"verdict: {ERES}"))

    def test_one_qualifies_that_one(self):
        c = calibration.choose({CAMPP: result(wrong=1), ERES: result(ERES)})
        self.assertEqual(c["model"], ERES)

    def test_none_qualifies(self):
        v = calibration.verdict({CAMPP: result(written=10), ERES: result(ERES, wrong=1)})
        self.assertIn("none qualifies", v.splitlines()[0])
        self.assertIn("propose", v.splitlines()[0])

    def test_a_model_failing_because_impostors_overlap_genuine(self):
        bad = result(fails="accept 0.71 is above the 10th percentile of genuine scores 0.66")
        self.assertFalse(calibration.qualifies(bad)[0])
        c = calibration.choose({CAMPP: bad, ERES: result(ERES)})
        self.assertEqual(c["model"], ERES)
        v = calibration.verdict({CAMPP: bad, ERES: result(ERES, fails="no closed-set impostor trial")})
        self.assertIn("none qualifies", v.splitlines()[0])
        self.assertIn("10th percentile", v)

    def test_ten_names_do_not_qualify_eleven_with_none_wrong_do(self):
        self.assertFalse(calibration.qualifies(result(written=10, named=10))[0])
        self.assertTrue(calibration.qualifies(result(written=11, named=11))[0])
        self.assertFalse(calibration.qualifies(result(written=11, named=11, wrong=1))[0])

    def test_the_other_qualifying_conditions(self):
        self.assertFalse(calibration.qualifies(result(thin=3))[0])
        self.assertTrue(calibration.qualifies(result(thin=2))[0])
        self.assertFalse(calibration.qualifies(result(eligible=30, named=14))[0])
        self.assertFalse(calibration.qualifies(result(mixed=1))[0])

    def test_open_set_is_auto_only_without_a_wrong_open_name(self):
        f = calibration.build_file(result(), chosen=True, generated="2026-11-16")
        self.assertEqual((f["print_closed"], f["print_open"]), ("auto", "auto"))
        f = calibration.build_file(result(open_wrong=1), chosen=True, generated="2026-11-16")
        self.assertEqual((f["print_closed"], f["print_open"]), ("auto", "propose"))
        f = calibration.build_file(result(), chosen=False, generated="2026-11-16")
        self.assertEqual((f["print_closed"], f["print_open"]), ("propose", "propose"))

    def test_beside_the_line_n_the_bound_the_fit_counts_and_held_out(self):
        v = calibration.verdict({CAMPP: result(written=12)})
        self.assertIn("n = 12 names written, 0 wrong", v)
        self.assertIn("3/n = 0.250", v)
        self.assertIn("13 labelled recordings", v)
        self.assertIn("18–19 genuine", v)
        self.assertIn("the judged recording was in none of them", v)

    def test_beside_n_the_names_on_labels_nobody_heard_counted_apart(self):
        # review finding names-on-unheard-labels-neither-counted-nor-listed: not in n, but printed beside it
        r = dict(result(written=12), unheard=[{"fold": 3, "record": "meeting-recordings/2026/r03", "label": "speaker_1",
                                               "person": SAM, "set": "closed", "why": "heard mostly as unsure"}] * 2)
        v = calibration.verdict({CAMPP: r})
        self.assertIn("n = 12 names written, 0 wrong", v)
        self.assertIn("2 more names written on labels nobody heard, not in n", v)
        self.assertTrue(calibration.qualifies(r)[0], "a name nobody heard is neither right nor wrong")
        self.assertNotIn("nobody heard", calibration.verdict({CAMPP: result(written=12)}))

    def test_the_file_holds_numbers_and_counts_only(self):
        f = calibration.build_file(result(), chosen=True, generated="2026-11-16")
        self.assertEqual(set(f["thresholds"]), set(calibration.THRESHOLDS))
        self.assertEqual(f["counts"], {"recordings": 14, "people": 4, "genuine": 20, "impostor": 110,
                                       "written": 13, "wrong": 0})
        self.assertEqual(f["elimination"], "propose")
        self.assertAlmostEqual(f["bound"], round(3 / 13, 4))
        calibration.check_numbers_only(f)
        with self.assertRaises(ValueError):
            calibration.check_numbers_only(dict(f, note="users/dana-oren"))
        with self.assertRaises(ValueError):
            calibration.check_numbers_only(dict(f, vector=[0.1] * 17))


# ---------------------------------------------------------------------------------------------------------
# calibration.active
# ---------------------------------------------------------------------------------------------------------
def a_file(model=ERES, accept=0.7):
    return {"version": 1, "model": {"id": model, "sha256": "e" * 64, "dim": 192},
            "thresholds": {"accept": accept, "accept_open": 0.75, "margin": 0.1, "same": 0.6, "split": 0.5,
                           "suggest": 0.45},
            "print_closed": "auto", "print_open": "propose", "elimination": "propose", "split_weak": False,
            "counts": {"recordings": 14, "people": 4, "genuine": 20, "impostor": 110, "written": 13, "wrong": 0},
            "bound": 0.2308, "generated": "2026-11-16"}


class Active(Tmp):
    def skill(self, files=()):
        d = os.path.join(self.root, "skill")
        os.makedirs(os.path.join(d, "calibration"), exist_ok=True)
        for name, body in files:
            Path(d, "calibration", name).write_text(json.dumps(body))
        return d

    def test_no_file_the_default_model_and_no_calibration(self):
        a = calibration.active(self.skill(), self.store)
        self.assertEqual(a, {"model": CAMPP, "calib": None, "source": None})

    def test_one_shipped_file_names_the_model_and_carries_its_thresholds(self):
        a = calibration.active(self.skill([(f"{ERES}.json", a_file())]), self.store)
        self.assertEqual((a["model"], a["source"]), (ERES, "shipped"))
        self.assertEqual(a["calib"]["thresholds"]["accept"], 0.7)
        self.assertEqual((a["calib"]["print_closed"], a["calib"]["print_open"]), ("auto", "propose"))

    def test_a_local_override_for_that_model_only(self):
        skill = self.skill([(f"{ERES}.json", a_file())])
        self.store.write_json(os.path.join(self.store.model_dir(CAMPP), "calibration.json"), a_file(CAMPP, 0.5))
        self.assertEqual(calibration.active(skill, self.store)["source"], "shipped")
        self.store.write_json(os.path.join(self.store.model_dir(ERES), "calibration.json"), a_file(ERES, 0.66))
        a = calibration.active(skill, self.store)
        self.assertEqual((a["model"], a["source"]), (ERES, "local"))
        self.assertEqual(a["calib"]["thresholds"]["accept"], 0.66)

    def test_a_local_override_with_nothing_shipped(self):
        self.store.write_json(os.path.join(self.store.model_dir(CAMPP), "calibration.json"), a_file(CAMPP, 0.5))
        a = calibration.active(self.skill(), self.store)
        self.assertEqual((a["model"], a["source"], a["calib"]["thresholds"]["accept"]), (CAMPP, "local", 0.5))

    def test_two_files_is_an_error_naming_both(self):
        skill = self.skill([(f"{ERES}.json", a_file()), (f"{CAMPP}.json", a_file(CAMPP))])
        with self.assertRaises(models.CalibrationAmbiguous) as e:
            calibration.active(skill, self.store)
        self.assertIn(f"{ERES}.json", str(e.exception))
        self.assertIn(f"{CAMPP}.json", str(e.exception))

    def test_the_active_model_is_the_resolvers(self):
        skill = self.skill([(f"calibration-{ERES}.json", a_file())])
        self.assertEqual(calibration.active(skill, None)["model"], models.active_model(skill))


# ---------------------------------------------------------------------------------------------------------
# label: the windows, the player, the session
# ---------------------------------------------------------------------------------------------------------
def segs_32_minute_turn():
    out = [{"speaker": "speaker_1", "start": 0.0, "end": 30.0}]
    t = 30.0
    while t < 1950.0 - 1e-9:
        out.append({"speaker": "speaker_0", "start": t, "end": min(1950.0, t + 10.0)})
        t += 10.0
    out.append({"speaker": "speaker_1", "start": 1950.0, "end": 1980.0})
    return out


class LabelWindows(unittest.TestCase):
    def test_a_32_minute_turn_gets_a_window_in_each_third(self):
        ws = label.choose_windows(segs_32_minute_turn(), "speaker_0")
        self.assertEqual(len(ws), 6)
        for a, b in ws:
            self.assertTrue(4.0 - 1e-9 <= b - a <= 8.0 + 1e-9, (a, b))
        third = 1920.0 / 3
        for i in range(3):
            lo, hi = 30.0 + i * third, 30.0 + (i + 1) * third
            self.assertTrue(any(lo <= (a + b) / 2 <= hi for a, b in ws), f"no window in third {i + 1}: {ws}")

    def test_six_windows_spread_over_short_turns(self):
        ws = label.choose_windows(segs_32_minute_turn(), "speaker_1")
        self.assertEqual(len(ws), 6)
        self.assertTrue(any(a < 30.0 for a, _ in ws) and any(a >= 1950.0 for a, _ in ws), ws)
        for a, b in ws:
            self.assertTrue(4.0 - 1e-9 <= b - a <= 8.0 + 1e-9, (a, b))

    def test_two_long_turns_keep_every_third(self):
        segs = [{"speaker": "speaker_0", "start": 0.0, "end": 400.0}, {"speaker": "speaker_1", "start": 400.0, "end": 410.0},
                {"speaker": "speaker_0", "start": 410.0, "end": 810.0}]
        ws = label.choose_windows(segs, "speaker_0")
        for start in (0.0, 410.0):
            for i in range(3):
                lo, hi = start + i * 400.0 / 3, start + (i + 1) * 400.0 / 3
                self.assertTrue(any(lo <= (a + b) / 2 <= hi for a, b in ws), (start, i, ws))


class Player(unittest.TestCase):
    def test_afplay_on_macos(self):
        which = lambda n: f"/usr/bin/{n}" if n == "afplay" else None
        self.assertEqual(label.find_player(which=which, platform="darwin"), ["afplay"])

    def test_ffplay_elsewhere(self):
        which = lambda n: f"/usr/bin/{n}" if n == "ffplay" else None
        self.assertEqual(label.find_player(which=which, platform="linux"), ["ffplay", "-nodisp", "-autoexit", "-loglevel", "error"])

    def test_neither_stops_and_names_both(self):
        with self.assertRaises(label.NoPlayer) as e:
            label.find_player(which=lambda n: None, platform="linux")
        self.assertIn("afplay", str(e.exception))
        self.assertIn("ffplay", str(e.exception))


class LabelSession(Tmp):
    def ctx(self):
        return {"workspace": WS, "record": ref_of("r21"), "record_path": "/nonexistent/r21.meeting-recording.md",
                "audio": os.path.join(self.root, "r21.m4a"), "diarization_id": diar_of("r21"),
                "candidates": [{"person": DANA, "name": "Dana Oren", "kind": "user"},
                               {"person": SAM, "name": "Sam Diaz", "kind": "contact"}]}

    def segs(self):
        return vp_synth.segments_two([20.0] * 6, [20.0] * 6, seg_max=10.0)

    def go(self, answers, only=None):
        asked, played, cut, shown = [], [], [], []
        answers = list(answers)

        def ask(prompt):
            asked.append(prompt)
            return answers.pop(0)

        def play(path):
            self.assertTrue(os.path.isfile(path))
            played.append(path)

        def do_cut(audio, a, b, dst):
            cut.append((audio, a, b))
            Path(dst).write_bytes(b"RIFF")

        path = label.session(self.ctx(), self.store, audio_sha=audio_of("r21"), segments=self.segs(), ask=ask,
                             play=play, cut=do_cut, out=shown.append, only=only)
        return path, asked, played, cut, shown

    def test_windows_are_played_shuffled_without_the_label_and_answers_written(self):
        n = 12
        answers = ["r"] + ["1", "x", "2", "?"] + ["2"] * (n - 3)
        path, asked, played, cut, shown = self.go(answers)
        self.assertEqual(path, label.labels_path(self.store, audio_of("r21"), diar_of("r21")))
        self.assertEqual(len(cut), n)
        self.assertEqual(len(played), n + 1, "r replays the window once more")
        for p in played:
            self.assertFalse(os.path.exists(p), "every cut window is removed after")
        for text in asked + shown:
            self.assertNotIn("speaker_", text)
            self.assertNotRegex(text, r"Speaker \d")
        starts = [a for _, a, _ in cut]
        self.assertNotEqual(starts, sorted(starts), "the windows are played shuffled")
        data = json.loads(Path(path).read_text())
        got = [w["answer"] for lab in data["labels"].values() for w in lab["windows"]]
        self.assertEqual(len(got), n)
        self.assertEqual(sorted(set(got)), sorted({DANA, SAM, "x"}))
        self.assertTrue(data["complete"])
        self.assertEqual(oct(os.stat(path).st_mode & 0o777), oct(0o600))

    # whole-branch review, `time-machine-exclusion-only-when-the-store-is-made`: a labelling session whose
    # store cannot be excluded from Time Machine says so, once
    def test_a_store_that_cannot_be_excluded_is_said_so(self):
        tried = []

        def boom(home):
            tried.append(home)
            raise OSError("tmutil: not permitted")
        self.store = store.Store(os.path.join(self.root, "store-notice"), exclude_backup=boom)
        path, asked, played, cut, shown = self.go(["1"] * 12)
        said = [s for s in shown if "Time Machine" in s]
        self.assertEqual(len(said), 1, shown)
        self.assertIn(self.store.home, said[0])
        self.assertEqual(len(tried), 1)

    def test_only_one_label_keeps_the_others(self):
        self.go(["1"] * 12)
        path, asked, *_ = self.go(["2"] * 6, only="speaker_1")
        self.assertEqual(len(asked), 6)
        data = json.loads(Path(path).read_text())
        self.assertEqual({w["answer"] for w in data["labels"]["speaker_0"]["windows"]}, {DANA})
        self.assertEqual({w["answer"] for w in data["labels"]["speaker_1"]["windows"]}, {SAM})

    def interrupted(self, after, only=None):
        """A sitting stopped (Ctrl-C) after `after` answers, all `1`."""
        answers = ["1"] * after

        def ask(prompt):
            if not answers:
                raise KeyboardInterrupt
            return answers.pop(0)

        with self.assertRaises(KeyboardInterrupt):
            label.session(self.ctx(), self.store, audio_sha=audio_of("r21"), segments=self.segs(), ask=ask,
                          play=lambda p: None, cut=lambda a, s, e, d: Path(d).write_bytes(b"RIFF"), out=lambda s: None,
                          only=only)
        return json.loads(Path(label.labels_path(self.store, audio_of("r21"), diar_of("r21"))).read_text())

    def test_an_interrupted_sitting_marks_only_the_labels_it_finished(self):
        # review finding interrupted-label-file-counts-as-gold
        data = self.interrupted(4)
        self.assertFalse(data["complete"])
        self.assertEqual(sum(len(e["windows"]) for e in data["labels"].values()), 4)
        for lab, e in data["labels"].items():
            self.assertEqual(e["complete"], len(e["windows"]) == 6, lab)
        self.assertFalse(any(e["complete"] for e in data["labels"].values()))

    def test_label_again_resumes_an_interrupted_recording_where_it_stopped(self):
        first = self.interrupted(4)
        kept = {(lab, w["start"], w["end"], w["answer"]) for lab, e in first["labels"].items() for w in e["windows"]}
        path, asked, played, cut, shown = self.go(["2"] * 8)
        self.assertEqual(len(asked), 8, "only the 8 windows not answered yet are played")
        self.assertTrue(any("resum" in s for s in shown), shown)
        data = json.loads(Path(path).read_text())
        self.assertTrue(data["complete"])
        self.assertTrue(all(e["complete"] for e in data["labels"].values()))
        now = {(lab, w["start"], w["end"], w["answer"]) for lab, e in data["labels"].items() for w in e["windows"]}
        self.assertTrue(kept <= now, "the first sitting's answers are kept")
        self.assertEqual(len(now), 12)
        self.assertEqual(sorted(len(e["windows"]) for e in data["labels"].values()), [6, 6])
        self.assertTrue(set((a, b) for _, a, b in cut).isdisjoint({(k[1], k[2]) for k in kept}))

    def test_label_again_on_a_finished_recording_starts_it_over(self):
        self.go(["1"] * 12)
        path, asked, _, _, shown = self.go(["2"] * 12)
        self.assertEqual(len(asked), 12)
        self.assertTrue(any("start" in s and "over" in s for s in shown), shown)
        data = json.loads(Path(path).read_text())
        self.assertEqual({w["answer"] for e in data["labels"].values() for w in e["windows"]}, {SAM})

    def test_only_one_label_of_an_unfinished_recording_leaves_it_unfinished(self):
        self.interrupted(4)
        path, asked, *_ = self.go(["2"] * 6, only="speaker_1")
        data = json.loads(Path(path).read_text())
        self.assertTrue(data["labels"]["speaker_1"]["complete"])
        self.assertFalse(data["labels"]["speaker_0"]["complete"])
        self.assertFalse(data["complete"], "the other label is still unfinished")
        k = len(data["labels"]["speaker_0"]["windows"])
        path, asked, *_ = self.go(["1"] * 6)
        self.assertEqual(len(asked), 6 - k, "label without --only resumes the label left unfinished")
        self.assertTrue(json.loads(Path(path).read_text())["complete"])

    def test_no_player_stops_before_anything_is_written(self):
        shown = []
        code = label.main(["label", "/nonexistent/r21.meeting-recording.md"], ctx=self.ctx(), store=self.store,
                          which=lambda n: None, platform="linux", out=shown.append)
        self.assertNotEqual(code, 0)
        self.assertTrue(any("afplay" in s and "ffplay" in s for s in shown), shown)
        self.assertFalse(os.path.exists(self.store.calibration_labels_dir()))


# ---------------------------------------------------------------------------------------------------------
# evaluate: gold, plan, the run
# ---------------------------------------------------------------------------------------------------------
class Gold(unittest.TestCase):
    def test_majority_purity_and_what_is_no_trial(self):
        win = lambda said: {"windows": [{"start": 0.0, "end": 6.0, "answer": a} for a in said]}
        g = evaluate.gold({"complete": True, "labels": {"speaker_0": win([DANA] * 5 + ["x"]), "speaker_1": win([SAM] * 4 + [DANA] * 2),
                                      "speaker_2": win(["x"] * 4 + [SAM] * 2), "speaker_3": win([SAM] * 5 + [TOM])}})
        self.assertEqual((g["speaker_0"]["kind"], g["speaker_0"]["purity"], g["speaker_0"]["speaker"]), ("pure", 1.0, DANA))
        self.assertEqual((g["speaker_1"]["kind"], round(g["speaker_1"]["purity"], 2)), ("mixed", 0.67))
        self.assertEqual(g["speaker_2"]["kind"], "unheard")
        self.assertEqual(g["speaker_3"]["kind"], "pure")

    def test_an_unfinished_labelling_gives_nothing_for_the_labels_it_did_not_finish(self):
        # review finding interrupted-label-file-counts-as-gold: one heard window of an interrupted sitting is
        # not a pure label
        win = lambda said, done: {"windows": [{"start": 0.0, "end": 6.0, "answer": a} for a in said], "complete": done}
        g = evaluate.gold({"complete": False, "labels": {"speaker_0": win([DANA], False), "speaker_1": win([], False),
                                                          "speaker_2": win([SAM] * 6, True)}})
        self.assertEqual((g["speaker_0"]["kind"], g["speaker_0"]["purity"]), ("unfinished", None))
        self.assertEqual(g["speaker_1"]["kind"], "unfinished")
        self.assertEqual((g["speaker_2"]["kind"], g["speaker_2"]["speaker"]), ("pure", SAM))
        # no flag at all is not finished either; a finished file counts every label in it
        self.assertEqual(evaluate.gold({"labels": {"speaker_0": win([DANA] * 6, None)}})["speaker_0"]["kind"], "unfinished")
        self.assertEqual(evaluate.gold({"complete": True, "labels": {"speaker_0": {"windows": [
            {"start": 0.0, "end": 6.0, "answer": DANA}] * 6}}})["speaker_0"]["kind"], "pure")


class Plan(Tmp):
    def test_fourteen_with_the_mix_the_session_needs_and_the_two_extras_apart(self):
        w = World(self.store, self.root)
        extra = []
        for k in range(6):  # more 1:1 recordings with Sam than the plan needs
            extra.append(("x%02d" % k, "2026-05-%02d" % (k + 1), [SAM], None))
        for rid, date, others, loc in extra:
            people = [DANA] + others
            w.add(rid, date, people, {f"speaker_{i}": p for i, p in enumerate(people)}, loc=loc, label_it=False)
        # an older solo memo: the plan takes the newest (by the record's own date — a memo has no meeting)
        w.add("m00", "2026-01-01", [DANA], {"speaker_0": DANA}, meeting=False, hint=1, label_it=False)
        rows = evaluate.plan(w.ctx_all(), DANA, pilot=ref_of("p01"), read=w.read)
        folds = [r for r in rows if r["role"] == "fold"]
        self.assertEqual(len(folds), 14)
        kinds = [r["kind"] for r in folds]
        self.assertEqual((kinds.count("1:1"), kinds.count("three or more"), kinds.count("room")), (8, 4, 2))
        self.assertEqual({r["record"] for r in folds if r["kind"] == "room"}, {ref_of("r13"), ref_of("r14")})
        others = {}
        for r in folds:
            for p in r["people"]:
                others[p] = others.get(p, 0) + 1
        self.assertGreaterEqual(sum(1 for n in others.values() if n >= 2), 3)
        self.assertEqual([r["record"] for r in rows if r["role"] == "memo"], [ref_of("m01")])
        self.assertEqual([r["record"] for r in rows if r["role"] == "pilot"], [ref_of("p01")])
        self.assertNotIn(ref_of("p01"), {r["record"] for r in folds})
        lines = evaluate.plan_lines(rows)
        self.assertTrue(any("label" in l and ref_of("m01") in l for l in lines), lines)

    def test_room_named_by_hand(self):
        w = World(self.store, self.root)
        ctx = w.ctx_all()
        for r in ctx["records"]:
            if r["record"] == ref_of("r14"):
                r["meeting"]["location"] = None       # r14 is no room now; r13 and the hand-named r01 are
        rows = evaluate.plan(ctx, DANA, read=w.read)
        self.assertNotIn(ref_of("r01"), {r["record"] for r in rows if r["kind"] == "room"})
        rows = evaluate.plan(ctx, DANA, rooms=["2026/r01"], read=w.read)
        self.assertEqual({r["record"] for r in rows if r["kind"] == "room"}, {ref_of("r01"), ref_of("r13")})


class Evaluation(Tmp):
    def test_each_fold_rebuilds_prints_without_the_judged_recording(self):
        w = World(self.store, self.root)
        res, lines = run_world(w)
        m = res["per_model"][CAMPP]
        self.assertEqual([f["record"] for f in m["folds"]], [ref_of(r) for r in FOLD_IDS])
        for f in m["folds"]:
            judged = audio_of(f["record"].rsplit("/", 1)[1])
            self.assertNotIn(judged, f["trial_audios"], f["record"])
            self.assertNotIn(judged, f["naming_audios"], f["record"])
            self.assertTrue(f["trial_audios"] and f["naming_audios"])
            self.assertEqual(f["recordings"], 15, f)   # the other 13, the memo and the pilot
            text = "\n".join(lines)
            self.assertIn(f"{f['record']}: fitted on 15 labelled recordings, {f['genuine']} genuine and "
                          f"{f['impostor']} impostor trials", text)
        self.assertEqual(m["wrong"], 0)
        self.assertGreaterEqual(m["written"], 11)
        self.assertEqual(m["enrolled_mixed"], 0, "the pilot's mixed label taught no print")
        self.assertTrue(calibration.qualifies(m)[0], calibration.qualifies(m)[1])

    def test_nothing_but_missing_signatures_is_written_to_the_real_store(self):
        w = World(self.store, self.root)
        before = sorted(str(p.relative_to(self.store.home)) for p in Path(self.store.home).rglob("*") if p.is_file())
        res, lines = run_world(w, pins={CAMPP: PIN_C, ERES: PIN_E})
        after = sorted(str(p.relative_to(self.store.home)) for p in Path(self.store.home).rglob("*") if p.is_file())
        new = [p for p in after if p not in before]
        self.assertTrue(new)
        for p in new:
            self.assertTrue(p.startswith(f"{ERES}/signatures/") or p.endswith(".lock"), p)
        self.assertFalse(Path(self.store.model_dir(CAMPP), "prints").exists())
        self.assertFalse(Path(self.store.model_dir(ERES), "prints").exists())
        self.assertEqual(len(w.computed), 16, "every labelled recording embedded once with the other model")
        sig = self.store.read_signature(ERES, audio_of("r01"), diar_of("r01"))
        self.assertEqual(sig["records"], [{"workspace": WS, "record": ref_of("r01")}])
        self.assertEqual(set(res["per_model"]), {CAMPP, ERES})
        w.computed.clear()
        run_world(w, pins={CAMPP: PIN_C, ERES: PIN_E})
        self.assertEqual(w.computed, [], "a signature written once is read the next time")

    def test_silver_disagreements_are_printed_apart_with_the_label_command(self):
        w = World(self.store, self.root)
        res, lines = run_world(w)
        text = "\n".join(lines)
        self.assertIn("silver", text)
        self.assertIn(f"label {ref_of('r12')} --only speaker_2", text)
        m = res["per_model"][CAMPP]
        self.assertEqual(len(m["silver"]), 1)
        self.assertTrue(m["silver"][0]["disagrees"])
        # silver never counts: the guest's unheard label is no gold trial
        self.assertNotIn((ref_of("r12"), "speaker_2"), {(t[0], t[1]) for t in m["gold_labels"]})

    def test_the_deliberately_mixed_sets_give_the_second_voice_a_fifth(self):
        # review finding mixed-sets-at-thirty-percent-not-the-fifth-line-8-names
        a, b = label_windows("z", "speaker_0", DANA), label_windows("z", "speaker_1", SAM)
        for wa, wb in ((a, b), (a[:9], b), (a[:4], b[:1]), (a, b[:3])):
            s = evaluate.mixed_set(wa, wb, evaluate.MIXED_SHARE)
            nb = sum(1 for v in s if v in wb)
            self.assertEqual(5 * nb, len(s), (len(wa), len(wb)))
        self.assertIsNone(evaluate.mixed_set(a[:3], b, evaluate.MIXED_SHARE), "under four windows no set is a fifth")
        s = evaluate.mixed_set(a, b, evaluate.SECOND_LOOK_SHARE)
        self.assertEqual(10 * sum(1 for v in s if v in b), 3 * len(s))
        made = []
        real = evaluate.mixed_set

        def spy(wa, wb, share):
            s = real(wa, wb, share)
            if s is not None:
                made.append((share, sum(1 for v in s if v in wb), len(s)))
            return s

        w = World(self.store, self.root)
        evaluate.mixed_set = spy
        try:
            res, lines = run_world(w)
        finally:
            evaluate.mixed_set = real
        self.assertTrue(made)
        fifth = [(nb, n) for share, nb, n in made if share == evaluate.MIXED_SHARE]
        self.assertTrue(fifth and all(5 * nb == n for nb, n in fifth), fifth)
        f = res["per_model"][CAMPP]["fit"]
        self.assertEqual(f["mixed"]["sets"], len(fifth), "split_weak is decided on the sets at a fifth")
        self.assertIn("mixed_second", f)
        text = "\n".join(lines)
        self.assertIn(f"mixed sets passing split: {f['mixed']['pass']} of {f['mixed']['sets']} with the second voice "
                      f"at a fifth of the windows", text)
        self.assertIn(f"at 30%, a second look: {f['mixed_second']['pass']} of {f['mixed_second']['sets']}", text)

    def test_an_interrupted_labelling_gives_no_trial_and_is_named(self):
        # review finding interrupted-label-file-counts-as-gold
        other = store.Store(os.path.join(self.root, "store-base"), exclude_backup=no_exclude)
        base, _ = run_world(World(other, os.path.join(self.root, "base")))
        w = World(self.store, self.root)
        path = w.answers_path("r05")
        data = json.loads(Path(path).read_text())
        data["complete"] = False
        data["labels"]["speaker_0"]["complete"] = True
        data["labels"]["speaker_1"] = {"windows": data["labels"]["speaker_1"]["windows"][:1], "complete": False}
        self.store.write_json(path, data)
        res, lines = run_world(w)
        m, m0 = res["per_model"][CAMPP], base["per_model"][CAMPP]
        self.assertIn((ref_of("r05"), "speaker_1", "unfinished"), m["gold_labels"])
        self.assertIn((ref_of("r05"), "speaker_0", "pure"), m["gold_labels"])
        self.assertLess(m["evidence"]["genuine"], m0["evidence"]["genuine"], "the one heard window is no trial")
        self.assertEqual(res["unfinished"], [(ref_of("r05"), ["speaker_1"])])
        text = "\n".join(lines)
        self.assertNotIn(f"{ref_of('r05')} Speaker 1: purity", text, "no purity for a label not labelled to the end")
        self.assertIn(f"{ref_of('r05')} Speaker 1: labelling unfinished", text)
        self.assertIn(f"`label {ref_of('r05')}` resumes it", text)

    def test_names_written_on_labels_nobody_heard_are_listed_and_left_out_of_n(self):
        # review finding names-on-unheard-labels-neither-counted-nor-listed
        w = World(self.store, self.root)
        path = w.answers_path("r03")
        data = json.loads(Path(path).read_text())
        for i, win in enumerate(data["labels"]["speaker_1"]["windows"]):
            win["answer"] = "x" if i < 4 else SAM          # mostly x: not a trial, not judgeable
        self.store.write_json(path, data)
        res, lines = run_world(w)
        m = res["per_model"][CAMPP]
        hits = [u for u in m["unheard"] if u["record"] == ref_of("r03") and u["label"] == "speaker_1"]
        self.assertTrue(hits, m["unheard"])
        self.assertEqual(hits[0]["why"], "heard mostly as unsure")
        closed = [u for u in m["unheard"] if u["set"] == "closed"]
        self.assertEqual(m["written"], sum(f["written"] for f in m["folds"]))
        fold3 = next(f for f in m["folds"] if f["record"] == ref_of("r03"))
        self.assertEqual(fold3["unheard"], sum(1 for u in closed if u["record"] == ref_of("r03")))
        text = "\n".join(lines)
        self.assertIn(f"{ref_of('r03')} Speaker 1 (heard mostly as unsure): named {hits[0]['person']}", text)
        self.assertIn(f"`label {ref_of('r03')} --only speaker_1`", text)
        i = next(i for i, l in enumerate(lines) if l.startswith("verdict:"))
        self.assertIn(f"{len(closed)} more name{'' if len(closed) == 1 else 's'} written on labels nobody heard, not in n",
                      "\n".join(lines[i + 1:]))

    def test_only_one_model(self):
        w = World(self.store, self.root)
        res = evaluate.run(w.ctx_all(), self.store, {CAMPP: PIN_C, ERES: PIN_E}, read=w.read, audio_key=w.audio_key,
                           compute=w.compute, pilot=ref_of("p01"), only=ERES, out=lambda s: None)
        self.assertEqual(list(res["per_model"]), [ERES])


class Write(Tmp):
    def main(self, w, *args):
        out = []
        ctx_file = os.path.join(self.root, "context.json")
        Path(ctx_file).write_text(json.dumps(w.ctx_all()))
        code = evaluate.main(["evaluate-speakers", *args, "--pilot", ref_of("p01"), "--context", ctx_file],
                             store=self.store, pins={CAMPP: PIN_C}, read=w.read, audio_key=w.audio_key,
                             compute=w.compute, out=out.append, today="2026-11-16")
        return code, out

    def test_write_puts_the_file_beside_the_labels_and_prints_the_path(self):
        w = World(self.store, self.root)
        code, out = self.main(w, "--write")
        self.assertEqual(code, 0, "\n".join(out))
        path = os.path.join(self.store.calibration_labels_dir(), f"calibration-{CAMPP}.json")
        self.assertTrue(any(path in line for line in out), out)
        body = json.loads(Path(path).read_text())
        calibration.check_numbers_only(body)
        for v in walk(body):
            if isinstance(v, list):
                self.assertFalse(len(v) > 16 and all(isinstance(x, float) for x in v))
            if isinstance(v, str):
                self.assertNotIn("/", v)
        self.assertEqual(body["model"]["id"], CAMPP)
        self.assertEqual(body["print_closed"], "auto")
        self.assertEqual(body["counts"]["recordings"], 14)
        self.assertFalse(Path(self.store.model_dir(CAMPP), "calibration.json").exists())
        self.assertEqual(models.active_model(self._skill_with(path)), CAMPP)

    def _skill_with(self, path):
        d = os.path.join(self.root, "skill")
        os.makedirs(os.path.join(d, "calibration"))
        Path(d, "calibration", os.path.basename(path)).write_text(Path(path).read_text())
        return d

    def test_install_local_also_writes_the_override(self):
        w = World(self.store, self.root)
        code, out = self.main(w, "--write", "--install-local")
        self.assertEqual(code, 0, "\n".join(out))
        local = os.path.join(self.store.model_dir(CAMPP), "calibration.json")
        self.assertTrue(Path(local).exists())
        self.assertTrue(any(local in line for line in out))
        a = calibration.active(os.path.join(self.root, "noskill"), self.store)
        self.assertEqual((a["model"], a["source"]), (CAMPP, "local"))

    def test_insufficient_writes_nothing(self):
        w = World(self.store, self.root)
        for rid in FOLD_IDS[:6]:
            os.remove(w.answers_path(rid))
        code, out = self.main(w, "--write")
        self.assertNotEqual(code, 0)
        self.assertTrue(any("insufficient, label more" in l for l in out), out)
        self.assertFalse(Path(self.store.calibration_labels_dir(), f"calibration-{CAMPP}.json").exists())

    # whole-branch review, `time-machine-exclusion-only-when-the-store-is-made`
    def test_a_store_that_cannot_be_excluded_is_said_so(self):
        def boom(home):
            raise OSError("tmutil: not permitted")
        self.store = store.Store(os.path.join(self.root, "store-notice"), exclude_backup=boom)
        w = World(self.store, self.root)
        code, out = self.main(w, "--write")
        self.assertEqual(code, 0, "\n".join(out))
        said = [s for s in out if "Time Machine" in s]
        self.assertEqual(len(said), 1, out)
        self.assertIn(self.store.home, said[0])

    def test_plan_prints_and_writes_nothing(self):
        w = World(self.store, self.root)
        before = sorted(str(p) for p in Path(self.store.home).rglob("*"))
        code, out = self.main(w, "plan")
        self.assertEqual(code, 0, "\n".join(out))
        self.assertTrue(any(ref_of("m01") in l for l in out))
        self.assertEqual(sorted(str(p) for p in Path(self.store.home).rglob("*")), before)


class Line19(Tmp):
    """The developer's evaluation over labelled recordings prints for each speaker model the purity of each
    diarised label and the scores of true and false matches and one line saying which model and thresholds
    its rule selects or that none qualifies — and, beside that line, the number of names written and the
    error bound they support, how many labelled recordings and trials each threshold was fitted on, and
    that the recording it was judged on was in none of them (acceptance line 19)."""

    def setUp(self):
        super().setUp()
        self.assertTrue(" ".join(self.__doc__.split()).startswith(LINE_19))   # 3.13+ dedents docstrings
        w = World(self.store, self.root)
        self.res, self.lines = run_world(w, pins={CAMPP: PIN_C, ERES: PIN_E})
        self.text = "\n".join(self.lines)

    def section(self, model):
        start = self.lines.index(f"model {model}")
        end = next((i for i in range(start + 1, len(self.lines)) if self.lines[i].startswith(("model ", "verdict:"))),
                   len(self.lines))
        return self.lines[start:end]

    def test_purity_per_label_for_each_model(self):
        for model in (CAMPP, ERES):
            sec = self.section(model)
            self.assertTrue(any(l.strip().startswith("purity per label") for l in sec), model)
            for rid in FOLD_IDS:
                self.assertTrue(any(ref_of(rid) in l and "Speaker 0" in l and "purity 1.00" in l for l in sec), rid)
            self.assertTrue(any(ref_of("p01") in l and "Speaker 0" in l and "purity 0.67" in l and "mixed" in l
                                for l in sec))
            self.assertTrue(any(l.strip().startswith("check 4") and "1 heard as mixed" in l for l in sec), sec)

    def test_true_and_false_match_scores_for_each_model(self):
        for model in (CAMPP, ERES):
            sec = "\n".join(self.section(model))
            self.assertRegex(sec, r"genuine \(true match\) scores: \d+ trials")
            self.assertRegex(sec, r"impostor \(false match\) scores, closed set: \d+ trials")
            self.assertRegex(sec, r"impostor \(false match\) scores, open set: \d+ trials")

    def test_one_verdict_line_with_the_model_and_its_thresholds(self):
        verdicts = [l for l in self.lines if l.startswith("verdict:")]
        self.assertEqual(len(verdicts), 1)
        self.assertTrue(verdicts[0].startswith(f"verdict: {CAMPP}"), verdicts[0])
        for k in calibration.THRESHOLDS:
            self.assertRegex(verdicts[0], rf"\b{k} \d\.\d+")

    def test_beside_it_n_the_bound_the_fit_counts_and_the_held_out_statement(self):
        i = next(i for i, l in enumerate(self.lines) if l.startswith("verdict:"))
        beside = "\n".join(self.lines[i + 1:])
        m = self.res["per_model"][CAMPP]
        n = m["written"]
        self.assertIn(f"{CAMPP}: n = {n} names written, 0 wrong", beside)
        self.assertIn(f"3/n = {3 / n:.3f}", beside)
        self.assertIn("15 labelled recordings", beside)
        g = sorted(f["genuine"] for f in m["folds"])
        imp = sorted(f["impostor"] for f in m["folds"])
        self.assertIn(f"{g[0]}–{g[-1]} genuine" if g[0] != g[-1] else f"{g[0]} genuine", beside)
        self.assertIn(f"{imp[0]}–{imp[-1]} impostor" if imp[0] != imp[-1] else f"{imp[0]} impostor", beside)
        self.assertIn("the judged recording was in none of them", beside)

    def test_the_fold_table_says_each_judged_recording_was_in_none_of_them(self):
        folds = [l for l in self.lines if l.strip().startswith("fold ")]
        self.assertEqual(len(folds), 2 * 14)
        for l in folds:
            self.assertIn("the judged recording was in none of them", l)


class UsageLine(unittest.TestCase):
    def test_the_usage_line_lists_label_and_evaluate_speakers(self):
        import subprocess
        skill = HERE.parents[1] / "skills" / "transcribing-recordings"
        r = subprocess.run([sys.executable, "-B", "transcribe_meeting.py"], cwd=str(skill), capture_output=True,
                           text=True, env=dict(os.environ, HOME=tempfile.gettempdir()))
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("label <record.md> [--only <label>]", r.stderr)
        self.assertIn("evaluate-speakers [plan]", r.stderr)


if __name__ == "__main__":
    unittest.main()
