"""The seams `run` leaves (cr-modules-019 task 4, design section 7): what was forced and what fell back
is on the record, the diarisation has an id, voice signatures go to the user's store, the embedding is
its own step with its own pinned model, and a re-run moves earlier names aside without writing any.

Standard library only, so a bare python3 runs it (vp-run-seams.test.mjs), the `test_run_cleanup.py`
way: decoding, diarisation, recognition, the embedder and the record I/O are replaced. The embedder is
a stand-in whose windows are synthetic voices (vp_synth, a distinct seed per voice and window); the
real `voiceprints.embed` (numpy) is never imported. Every file is written under a temp folder: HOME and
VOICE_PRINTS_HOME point inside it, and the store's backup exclusion is a recording fake.
"""
from __future__ import annotations

import contextlib
import copy
import errno
import hashlib
import io
import json
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

import meeting_io  # noqa: E402
import transcribe_meeting as tm  # noqa: E402
import vp_synth  # noqa: E402
from voiceprints import carry, signatures  # noqa: E402
from voiceprints import models as vp_models  # noqa: E402
from voiceprints import segments as vp_segments  # noqa: E402
from voiceprints import store as vp_store  # noqa: E402

CAMPP = vp_models.DEFAULT_MODEL
WORKSPACE = "northwind-hq"
RECORD = "meeting-recordings/2026/08/2026-08-30--northwind-weekly"
FAKE_SHA = "f" * 64
DIM = 64
VOICE_SEEDS = {"speaker_0": 101, "speaker_1": 202, "speaker_2": 303}


def seg(label, start, end):
    return {"speaker": label, "start": float(start), "end": float(end)}


def words_every_second(duration):
    return [{"start": float(i), "end": i + 0.8, "text": " hello"} for i in range(int(duration))]


class FakeEmbedder:
    """Stands in for `embed.Embedder`: a window shorter than 2.0 s holds too little speech and is left
    out; any other window is one synthetic window of the voice of the label speaking at its middle."""

    def __init__(self, model_id, harness):
        self.model = vp_store.Model(model_id, FAKE_SHA, DIM)
        self.h = harness
        harness.embedder_models.append(model_id)

    def embed(self, samples, sr, windows):
        out = []
        for start, end in windows:
            self.h.embedded.append((start, end))
            if self.h.on_embed:
                hook, self.h.on_embed = self.h.on_embed, None
                hook()
            if end - start < 2.0:
                continue
            label = self.h.label_at((start + end) / 2)
            v = vp_synth.windows(vp_synth.voice(VOICE_SEEDS[label], DIM), 1,
                                 seed=(VOICE_SEEDS[label], round(start, 3)))[0]
            out.append({"start": start, "end": end, "vector": v})
        return out


class Harness(unittest.TestCase):
    """A temp root holding HOME, the store, a workspace, its files and inbox folders, a skill folder (for
    the calibration the active model is read from), a recording and the ASR cache."""

    def setUp(self):
        self._td = tempfile.TemporaryDirectory(prefix="vp-run-seams-")
        self.addCleanup(self._td.cleanup)
        root = Path(self._td.name).resolve()
        self.root = root
        self.home = root / "home"
        self.ws = root / "ws"
        self.files = root / "files"
        self.inbox = root / "inbox"
        self.skill = root / "skill"
        for d in (self.home, self.ws, self.files, self.inbox, self.skill):
            d.mkdir()
        self.vp_home = self.home / "vp"
        env = mock.patch.dict(os.environ, {"HOME": str(self.home), "USERPROFILE": str(self.home),
                                           "VOICE_PRINTS_HOME": str(self.vp_home)})
        env.start()
        self.addCleanup(env.stop)

        self.excluded = []
        fake_exclude = self.excluded.append
        p = mock.patch.object(vp_store, "default_exclude_backup", lambda *a, **k: fake_exclude)
        p.start()
        self.addCleanup(p.stop)

        self.record = str(self.ws / "data" / "meeting-recordings" / "2026-08-30--northwind-weekly.meeting-recording.md")
        self.audio = str(self.files / "clip.m4a")
        Path(self.audio).write_bytes(b"synthetic audio bytes, never a real voice")
        self.audio_sha = hashlib.sha256(Path(self.audio).read_bytes()).hexdigest()
        self.cache_path = str(root / "cache" / "northwind-weekly.asr.json")
        os.makedirs(os.path.dirname(self.cache_path))

        self.fm = {"name": "Northwind weekly"}
        self.body = ""
        self.segments = [seg("speaker_0", 0, 30), seg("speaker_1", 30, 60),
                         seg("speaker_0", 60, 90), seg("speaker_1", 90, 120)]
        self.fallback = None
        self.duration = 120.0
        self.words = None
        self.embedded = []
        self.embedder_models = []
        self.on_embed = None
        self.events = []
        self.written = None
        self.written_body = None
        self.context = {
            "workspace": WORKSPACE,
            "guard": {"workspace": str(self.ws), "files_folder": str(self.files), "inbox_folders": [str(self.inbox)]},
            "known": {"users/dana-oren": "Dana Oren", "contacts/sam-diaz": "Sam Diaz"},
            "workspace_users": [{"person": "users/dana-oren", "name": "Dana Oren"}],
            "record": RECORD,
            "record_path": self.record,
            "audio": self.audio,
            "fingerprint": None,
            "diarization_id": None,
            "meeting": None,
            "candidates": [{"person": "users/dana-oren", "name": "Dana Oren", "kind": "user"},
                           {"person": "contacts/sam-diaz", "name": "Sam Diaz", "kind": "contact"}],
            "attendee_count": 2,
            "attendee_count_certain": True,
            "documents": [],
        }

        def decode(src, dst):
            Path(dst).write_bytes(b"RIFF")

        for name, value in {
            "choose_engine": lambda requested: ("cpu", None),
            "missing_models": lambda engine, num_speakers: [],
            "read_meeting": lambda p: (copy.deepcopy(self.fm), self.body),
            "write_meeting": self.capture_record,
            "decode_audio": decode,
            "diarize_safe": lambda wav, num_speakers=None: (copy.deepcopy(self.segments), self.fallback),
            "transcribe": self.fake_transcribe,
            "asr_cache_path_for": lambda p: self.cache_path,
            "read_samples": lambda wav: ([], 16000),
            "load_embedder": lambda model_id: FakeEmbedder(model_id, self),
            "HERE": str(self.skill),
        }.items():
            p = mock.patch.object(tm, name, value)
            p.start()
            self.addCleanup(p.stop)

    # -- stand-ins ------------------------------------------------------------------------------------
    def capture_record(self, path, fm, body):
        self.events.append("record")
        self.written = copy.deepcopy(fm)
        self.written_body = body

    def fake_transcribe(self, wav, language=None, engine="cpu"):
        return {"words": self.words if self.words is not None else words_every_second(self.duration),
                "language": ["en"], "duration": self.duration, "language_forced": language}

    def label_at(self, t):
        for s in self.segments:
            if s["start"] <= t < s["end"]:
                return s["speaker"]
        return "speaker_0"

    # -- helpers --------------------------------------------------------------------------------------
    def store(self):
        return vp_store.Store(str(self.vp_home), exclude_backup=self.excluded.append)

    def run_it(self, num_speakers=2, context="default"):
        ctx = self.context if context == "default" else context
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            summary = tm.run(self.record, self.audio, "2026-08-30", num_speakers=num_speakers, language="en",
                             engine="cpu", context=ctx)
        self.stderr = err.getvalue()
        self.stdout = out.getvalue()
        return summary

    @property
    def t(self):
        return self.written["transcription"]

    def sig_files(self, base=None):
        base = Path(base or self.vp_home)
        return sorted(p for p in base.rglob("*.json") if "signatures" in p.parts)

    def only_signature(self):
        files = self.sig_files()
        self.assertEqual(len(files), 1, files)
        return json.loads(files[0].read_text(encoding="utf-8"))

    def named_record(self, body):
        self.fm = {
            "name": "Northwind weekly",
            "speaker_naming": "waiting",
            "transcription": {
                "generated": "2026-08-01",
                "diarization_id": "0123456789ab",
                "speakers": {"speaker_0": "Dana Oren", "speaker_1": "Sam Diaz"},
                "speaker_sources": {"speaker_0": {"name": "Dana Oren", "person": "users/dana-oren", "origin": "hand",
                                                  "status": "confirmed", "named": "2026-08-01T10:00:00+02:00"}},
                "speaker_questions": {"speaker_1": {"quotes": [{"at": "00:40", "text": "hi"}]}},
                "identification": {"generated": "2026-08-01", "outcome": "waiting"},
            },
        }
        self.body = body

    def write_cache(self, segments, record=RECORD, audio_sha=None, diar_id="0123456789ab"):
        cache = {"asr": {"words": [], "language": ["en"], "duration": self.duration}, "segments": segments,
                 "diarization_id": diar_id, "audio_sha256": audio_sha or self.audio_sha, "record": record}
        Path(self.cache_path).write_text(json.dumps(cache), encoding="utf-8")


BODY_TWO = "# Northwind weekly\n\n## Transcript\n\n[00:00] Speaker 0: good morning everyone\n\n[01:00] Speaker 1: thanks for having me\n"


# ------------------------------------------------------------------------------------------------------
# Seam 1 and 2: the four transcription keys, the diarisation id

class TranscriptionKeys(Harness):
    def test_a_constrained_run_records_its_hint_its_id_and_an_empty_map(self):
        summary = self.run_it(num_speakers=2)
        self.assertEqual(self.t["speakers_hint"], 2)
        self.assertNotIn("diarization_fallback", self.t)
        self.assertEqual(self.t["diarization"], tm.DIARIZATION)
        self.assertEqual(self.t["diarization_id"], vp_segments.diarization_id(self.segments))
        self.assertEqual(self.t["speakers"], {})
        self.assertEqual(summary["diarization_id"], self.t["diarization_id"])

    def test_an_unconstrained_run_has_no_hint(self):
        summary = self.run_it(num_speakers=None)
        self.assertNotIn("speakers_hint", self.t)
        self.assertIsNone(summary["speakers_hint"])
        self.assertNotIn("diarization_fallback", self.t)
        self.assertEqual(self.t["speakers"], {})

    def test_a_fallback_is_on_the_record_with_its_reason(self):
        self.segments, self.fallback = [], "diariser exited -10; one speaker"
        self.run_it(num_speakers=2)
        self.assertEqual(self.t["diarization_fallback"], "diariser exited -10; one speaker")
        self.assertEqual(self.t["diarization"], tm.DIARIZATION)
        self.assertEqual(self.t["speakers_hint"], 2)
        self.assertEqual(self.t["diarization_id"], vp_segments.diarization_id([]))
        self.assertEqual(self.t["speakers"], {})

    def test_one_speaker_declared_skips_diarisation_and_says_so(self):
        self.segments = []
        self.run_it(num_speakers=1)
        self.assertEqual(self.t["diarization"], "skipped — one speaker declared")
        self.assertEqual(self.t["speakers_hint"], 1)
        self.assertNotIn("diarization_fallback", self.t)
        self.assertEqual(self.t["speakers"], {})

    def test_run_clears_speaker_naming_and_the_identification_it_superseded(self):
        self.named_record(BODY_TWO)
        self.run_it()
        self.assertNotIn("speaker_naming", self.written)
        self.assertNotIn("speaker_questions", self.t)
        self.assertNotIn("identification", self.t)
        self.assertNotIn("speaker_sources", self.t)
        self.assertEqual(self.written["name"], "Northwind weekly")


class DiarizeSafe(unittest.TestCase):
    """`diarize_safe` returns (segments, fallback reason or None)."""

    def proc(self, returncode, stdout=b"", stderr=b""):
        return mock.Mock(returncode=returncode, stdout=stdout, stderr=stderr)

    def test_one_speaker_never_starts_the_diariser(self):
        with mock.patch("subprocess.run") as r:
            self.assertEqual(tm.diarize_safe("/w/a.wav", num_speakers=1), ([], None))
        r.assert_not_called()

    def test_a_crashed_diariser_falls_back_with_its_exit_code(self):
        with mock.patch("subprocess.run", return_value=self.proc(-10, stderr=b"Bus error")), \
                contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(tm.diarize_safe("/w/a.wav", num_speakers=2), ([], "diariser exited -10; one speaker"))

    def test_unreadable_output_falls_back_and_says_so(self):
        with mock.patch("subprocess.run", return_value=self.proc(0, stdout=b"not json")), \
                contextlib.redirect_stderr(io.StringIO()):
            segs, why = tm.diarize_safe("/w/a.wav", num_speakers=None)
        self.assertEqual(segs, [])
        self.assertIn("one speaker", why)
        self.assertIn("unreadable", why)

    def test_a_diarisation_has_no_fallback(self):
        segs = [seg("speaker_0", 0, 3), seg("speaker_1", 3, 6)]
        with mock.patch("subprocess.run", return_value=self.proc(0, stdout=json.dumps(segs).encode())):
            self.assertEqual(tm.diarize_safe("/w/a.wav", num_speakers=2), (segs, None))


# ------------------------------------------------------------------------------------------------------
# The ASR cache: diarisation id, audio sha256 and record, trusted only when all three match

class AsrCache(Harness):
    def test_the_cache_carries_the_three_keys(self):
        self.run_it()
        cache = json.loads(Path(self.cache_path).read_text(encoding="utf-8"))
        self.assertEqual(cache["diarization_id"], vp_segments.diarization_id(self.segments))
        self.assertEqual(cache["audio_sha256"], self.audio_sha)
        self.assertEqual(cache["record"], RECORD)
        self.assertEqual(cache["segments"], self.segments)
        self.assertIn("asr", cache)

    def test_the_audio_key_is_the_records_fingerprint_when_it_has_one(self):
        self.context["fingerprint"] = "sha256:" + "ab12" * 16
        self.run_it()
        cache = json.loads(Path(self.cache_path).read_text(encoding="utf-8"))
        self.assertEqual(cache["audio_sha256"], "ab12" * 16)
        files = self.sig_files()
        self.assertEqual(len(files), 1)
        self.assertEqual(files[0].parent.name, "ab12" * 16)
        self.assertEqual(files[0].parent.parent.name, "ab")
        self.assertEqual(files[0].name, vp_segments.diarization_id(self.segments) + ".json")

    def test_without_a_fingerprint_the_audio_key_is_computed_from_the_audio(self):
        self.run_it()
        self.assertEqual(self.only_signature()["audio"], self.audio_sha)

    def test_matches_only_on_all_three(self):
        cache = {"record": RECORD, "audio_sha256": "a" * 64, "diarization_id": "0123456789ab"}
        self.assertTrue(meeting_io.asr_cache_matches(cache, RECORD, "a" * 64, "0123456789ab"))
        self.assertFalse(meeting_io.asr_cache_matches(cache, "meeting-recordings/other", "a" * 64, "0123456789ab"))
        self.assertFalse(meeting_io.asr_cache_matches(cache, RECORD, "b" * 64, "0123456789ab"))
        self.assertFalse(meeting_io.asr_cache_matches(cache, RECORD, "a" * 64, "ba9876543210"))
        self.assertFalse(meeting_io.asr_cache_matches({"asr": {}, "segments": []}, RECORD, "a" * 64, "0123456789ab"))
        self.assertFalse(meeting_io.asr_cache_matches(cache, None, "a" * 64, "0123456789ab"))
        self.assertFalse(meeting_io.asr_cache_matches(None, RECORD, "a" * 64, "0123456789ab"))

    def test_read_asr_cache_is_none_for_a_missing_or_broken_file(self):
        self.assertIsNone(meeting_io.read_asr_cache(str(self.root / "nope.asr.json")))
        Path(self.cache_path).write_text("{broken", encoding="utf-8")
        self.assertIsNone(meeting_io.read_asr_cache(self.cache_path))


# ------------------------------------------------------------------------------------------------------
# Seam 5: earlier names move to previous_speakers (acceptance line 36)

class Line36(Harness):
    """Transcribing again a recording that has names writes none of them, keeps them on the record, and
    /identify-speakers then offers each as a proposal on the speaker label that now holds most of that
    speaker's time; two earlier names on one label are not offered"""

    def setUp(self):
        super().setUp()
        # the new diarisation: speaker_0 holds the first minute, speaker_1 the second
        self.segments = [seg("speaker_0", 0, 60), seg("speaker_1", 60, 120)]

    def prev(self):
        return self.t["previous_speakers"]

    def test_names_move_to_previous_speakers_with_the_overlap_from_a_matching_cache(self):
        self.named_record(BODY_TWO)
        # the old segments say the opposite of the body: old speaker_0 spoke the second minute
        self.write_cache([seg("speaker_1", 0, 60), seg("speaker_0", 60, 120)])
        self.run_it()
        self.assertEqual(self.t["speakers"], {})
        p = self.prev()
        self.assertEqual(p["diarization_id"], "0123456789ab")
        self.assertEqual(p["labels"]["speaker_0"]["name"], "Dana Oren")
        self.assertEqual(p["labels"]["speaker_0"]["source"]["person"], "users/dana-oren")
        self.assertEqual(p["labels"]["speaker_0"]["new_label"], "speaker_1")
        self.assertEqual(p["labels"]["speaker_0"]["share"], 1.0)
        self.assertTrue(p["labels"]["speaker_0"]["offered"])
        self.assertEqual(p["labels"]["speaker_1"]["name"], "Sam Diaz")
        self.assertNotIn("source", p["labels"]["speaker_1"])
        self.assertEqual(p["labels"]["speaker_1"]["new_label"], "speaker_0")
        self.assertTrue(p["labels"]["speaker_1"]["offered"])
        self.assertNotIn("note", p)

    def test_with_no_matching_cache_the_mapping_comes_from_the_body_turns(self):
        self.named_record(BODY_TWO)
        self.run_it()
        p = self.prev()
        self.assertEqual(p["labels"]["speaker_0"]["new_label"], "speaker_0")
        self.assertEqual(p["labels"]["speaker_1"]["new_label"], "speaker_1")
        self.assertTrue(p["labels"]["speaker_0"]["offered"] and p["labels"]["speaker_1"]["offered"])

    def test_a_turn_past_one_hundred_minutes_is_mapped(self):
        self.duration = 7200.0
        self.segments = [seg("speaker_0", 0, 6005), seg("speaker_1", 6005, 7200)]
        self.named_record("## Transcript\n\n[00:00] Speaker 1: we open with the agenda\n\n"
                          "[100:05] Speaker 0: and that closes the review\n")
        self.run_it()
        p = self.prev()
        self.assertEqual(p["labels"]["speaker_0"]["new_label"], "speaker_1")
        self.assertEqual(p["labels"]["speaker_0"]["share"], 1.0)
        self.assertEqual(p["labels"]["speaker_1"]["new_label"], "speaker_0")
        self.assertTrue(p["labels"]["speaker_0"]["offered"])

    def test_a_cache_whose_record_audio_or_id_differs_is_ignored(self):
        for field, kwargs in (("record", {"record": "meeting-recordings/2026/08/other"}),
                              ("audio", {"audio_sha": "c" * 64}),
                              ("diarization id", {"diar_id": "ba9876543210"})):
            with self.subTest(differs=field):
                self.named_record(BODY_TWO)
                self.write_cache([seg("speaker_1", 0, 60), seg("speaker_0", 60, 120)], **kwargs)
                self.run_it()
                # mapped from the body, not the cache
                self.assertEqual(self.prev()["labels"]["speaker_0"]["new_label"], "speaker_0", field)

    def test_two_old_labels_on_one_new_label_are_not_offered(self):
        self.segments = [seg("speaker_0", 0, 120)]
        self.named_record(BODY_TWO)
        self.run_it()
        p = self.prev()
        for old in ("speaker_0", "speaker_1"):
            self.assertEqual(p["labels"][old]["new_label"], "speaker_0")
            self.assertFalse(p["labels"][old]["offered"])

    def test_a_body_with_no_timestamps_maps_nothing_and_says_so(self):
        self.named_record("## Transcript\n\nSpeaker 0: good morning\n\nSpeaker 1: thanks\n")
        self.run_it()
        p = self.prev()
        self.assertEqual(p["labels"]["speaker_0"]["name"], "Dana Oren")
        for old in ("speaker_0", "speaker_1"):
            self.assertIsNone(p["labels"][old]["new_label"])
            self.assertFalse(p["labels"][old]["offered"])
        self.assertIn("no timestamps", p["note"])
        self.assertIn("no timestamps", self.stderr)

    def test_a_record_with_no_names_carries_nothing(self):
        self.fm = {"name": "Northwind weekly", "transcription": {"speakers": {}, "diarization_id": "0123456789ab"}}
        self.body = BODY_TWO
        self.run_it()
        self.assertNotIn("previous_speakers", self.t)
        self.assertIsNone(carry.previous(self.fm, BODY_TWO, None, self.segments, 120.0))

    def test_a_second_run_before_identify_keeps_the_offered_names(self):
        self.named_record(BODY_TWO)
        self.run_it()
        first = copy.deepcopy(self.written)
        # the first run left `speakers: {}` and previous_speakers; transcribe again, diarised the other way round
        self.fm = first
        self.body = self.written_body
        self.segments = [seg("speaker_1", 0, 60), seg("speaker_0", 60, 120)]
        self.write_cache([seg("speaker_0", 0, 60), seg("speaker_1", 60, 120)],
                         diar_id=first["transcription"]["diarization_id"])
        self.run_it()
        p = self.prev()
        names = {e["name"]: e for e in p["labels"].values()}
        self.assertEqual(names["Dana Oren"]["new_label"], "speaker_1")
        self.assertEqual(names["Sam Diaz"]["new_label"], "speaker_0")
        self.assertEqual(names["Dana Oren"]["source"]["person"], "users/dana-oren")
        self.assertEqual(self.t["speakers"], {})

    # review round 1, second-run-erases-unoffered-names: no name is ever lost by transcribing again

    def again(self, segments, cache=None):
        """Transcribe the record the last run wrote once more, diarised as `segments`."""
        first = copy.deepcopy(self.written)
        self.fm, self.body = first, self.written_body
        self.segments = segments
        if cache is not None:
            self.write_cache(cache, diar_id=first["transcription"]["diarization_id"])
        self.run_it()
        return {e["name"]: e for e in self.prev()["labels"].values()}

    def test_a_second_run_keeps_the_names_the_first_run_did_not_offer(self):
        # run 1: the diariser crashed, so both earlier names land on the one label and neither is offered
        self.named_record(BODY_TWO)
        self.segments, self.fallback = [], "diariser exited -10; one speaker"
        self.run_it()
        self.assertEqual({e["offered"] for e in self.prev()["labels"].values()}, {False})
        # run 2: a proper diarisation; the names' time is the one label of run 1, so they still collide
        self.fallback = None
        names = self.again([seg("speaker_0", 0, 60), seg("speaker_1", 60, 120)])
        self.assertEqual(set(names), {"Dana Oren", "Sam Diaz"})
        self.assertEqual(names["Dana Oren"]["source"]["status"], "confirmed")
        self.assertEqual(names["Dana Oren"]["source"]["person"], "users/dana-oren")
        for e in names.values():
            self.assertEqual(e["new_label"], names["Dana Oren"]["new_label"])
            self.assertFalse(e["offered"])
        self.assertEqual(self.t["speakers"], {})

    def test_names_that_could_not_be_placed_survive_every_later_run(self):
        self.named_record("## Transcript\n\nSpeaker 0: good morning\n\nSpeaker 1: thanks\n")
        self.run_it()
        for _ in range(2):
            names = self.again([seg("speaker_0", 0, 60), seg("speaker_1", 60, 120)])
            self.assertEqual(set(names), {"Dana Oren", "Sam Diaz"})
            for e in names.values():
                self.assertIsNone(e["new_label"])
                self.assertEqual(e["share"], 0.0)
                self.assertFalse(e["offered"])
            self.assertEqual(names["Dana Oren"]["source"]["status"], "confirmed")

    def test_names_on_the_record_and_earlier_names_merge_without_loss(self):
        # identify named speaker_0 Priya Raman on a record that still holds two earlier names: Dana Oren
        # carried onto speaker_0, Sam Diaz placed nowhere
        self.fm = {"name": "Northwind weekly", "transcription": {
            "diarization_id": "0123456789ab",
            "speakers": {"speaker_0": "Priya Raman", "speaker_1": None},
            "speaker_sources": {"speaker_0": {"name": "Priya Raman", "person": "contacts/priya-raman",
                                              "status": "confirmed"}},
            "previous_speakers": {"diarization_id": "aaaaaaaaaaaa", "labels": {
                "speaker_3": {"name": "Dana Oren", "source": {"person": "users/dana-oren", "status": "confirmed"},
                              "new_label": "speaker_0", "share": 0.9, "offered": True},
                "speaker_1": {"name": "Sam Diaz", "new_label": None, "share": 0.0, "offered": False}}}}}
        self.body = BODY_TWO
        self.run_it()
        names = {e["name"]: e for e in self.prev()["labels"].values()}
        self.assertEqual(set(names), {"Priya Raman", "Dana Oren", "Sam Diaz"})
        self.assertEqual(len(self.prev()["labels"]), 3)
        # Priya and Dana claim the same earlier time: both land on speaker_0 and neither is offered
        self.assertEqual(names["Priya Raman"]["new_label"], "speaker_0")
        self.assertEqual(names["Dana Oren"]["new_label"], "speaker_0")
        self.assertFalse(names["Priya Raman"]["offered"] or names["Dana Oren"]["offered"])
        self.assertEqual(names["Dana Oren"]["source"]["status"], "confirmed")
        self.assertIsNone(names["Sam Diaz"]["new_label"])
        self.assertFalse(names["Sam Diaz"]["offered"])

    def test_an_earlier_name_marked_forgotten_stays_forgotten_and_unoffered(self):
        self.fm = {"name": "Northwind weekly", "transcription": {
            "diarization_id": "0123456789ab", "speakers": {},
            "previous_speakers": {"diarization_id": None, "labels": {
                "speaker_0": {"name": "Dana Oren", "new_label": "speaker_0", "share": 1.0, "offered": True},
                "speaker_1": {"name": "Sam Diaz", "new_label": "speaker_1", "share": 1.0, "offered": False,
                              "forgotten": True}}}}}
        self.body = BODY_TWO
        self.run_it(context=None)
        sam = {e["name"]: e for e in self.prev()["labels"].values()}["Sam Diaz"]
        self.assertTrue(sam["forgotten"])
        self.assertFalse(sam["offered"])
        self.assertEqual(sam["new_label"], "speaker_1")


# ------------------------------------------------------------------------------------------------------
# Seam 5: a forgotten person is not carried (acceptance line 37)

class Line37(Harness):
    """After a person is forgotten, transcribing again a recording that names them stores no voice
    windows for the label carrying their earlier name and does not propose them for it"""

    def setUp(self):
        super().setUp()
        self.segments = [seg("speaker_0", 0, 60), seg("speaker_1", 60, 120)]
        self.named_record(BODY_TWO)

    def forget(self, person="contacts/sam-diaz", name="Sam Diaz", workspace=WORKSPACE,
               at="2026-11-10T09:00:00+02:00"):
        self.store().add_forgotten({"print": "p-5a9d1c2e",
                                    "known_as": [{"workspace": workspace, "person": person, "name": name}],
                                    "at": at})

    def assert_speaker_1_removed(self):
        sig = self.only_signature()
        self.assertEqual(sig["removed"], ["speaker_1"])
        self.assertEqual(sig["labels"]["speaker_1"]["windows"], [])
        self.assertGreater(len(sig["labels"]["speaker_0"]["windows"]), 0)
        self.assertTrue(all(e < 60.0 + 1e-9 for s, e in self.embedded),
                        "the forgotten label's windows were embedded")
        sam = self.t["previous_speakers"]["labels"]["speaker_1"]
        self.assertFalse(sam["offered"])
        self.assertTrue(sam["forgotten"])
        self.assertTrue(self.t["previous_speakers"]["labels"]["speaker_0"]["offered"])

    def test_by_the_person_on_the_source(self):
        self.fm["transcription"]["speaker_sources"]["speaker_1"] = {
            "name": "Sam Diaz", "person": "contacts/sam-diaz", "origin": "hand", "status": "confirmed",
            "named": "2026-08-01T10:00:00+02:00"}
        self.forget()
        self.run_it()
        self.assert_speaker_1_removed()

    def test_by_the_name_string_when_no_source_names_a_person(self):
        self.forget()
        self.run_it()
        self.assert_speaker_1_removed()

    def test_another_workspaces_forget_does_not_apply_here(self):
        self.forget(workspace="harbor-mutual")
        self.run_it()
        sig = self.only_signature()
        self.assertEqual(sig["removed"], [])
        self.assertGreater(len(sig["labels"]["speaker_1"]["windows"]), 0)
        self.assertTrue(self.t["previous_speakers"]["labels"]["speaker_1"]["offered"])
        self.assertNotIn("forgotten", self.t["previous_speakers"]["labels"]["speaker_1"])

    def test_a_name_confirmed_after_the_forget_is_carried(self):
        self.fm["transcription"]["speaker_sources"]["speaker_1"] = {
            "name": "Sam Diaz", "person": "contacts/sam-diaz", "origin": "hand", "status": "confirmed",
            "named": "2026-11-12T09:00:00+02:00"}
        self.forget(at="2026-11-10T09:00:00+02:00")
        self.run_it()
        self.assertEqual(self.only_signature()["removed"], [])
        self.assertTrue(self.t["previous_speakers"]["labels"]["speaker_1"]["offered"])

    def test_a_same_named_person_under_another_reference_is_not_forgotten(self):
        self.fm["transcription"]["speaker_sources"]["speaker_1"] = {
            "name": "Sam Diaz", "person": "users/sam-diaz", "origin": "hand", "status": "confirmed",
            "named": "2026-08-01T10:00:00+02:00"}
        self.forget(person="contacts/sam-diaz")
        self.run_it()
        self.assertEqual(self.only_signature()["removed"], [])

    def test_forgotten_new_labels_marks_what_it_returns(self):
        prev = {"diarization_id": None, "labels": {
            "speaker_0": {"name": "Dana Oren", "new_label": "speaker_0", "share": 1.0, "offered": True},
            "speaker_1": {"name": "Sam Diaz", "new_label": "speaker_1", "share": 1.0, "offered": True}}}
        entries = [{"print": "p-1", "known_as": [{"workspace": WORKSPACE, "person": "contacts/sam-diaz",
                                                  "name": "Sam Diaz"}], "at": "2026-11-10T09:00:00+02:00"}]
        fresh = copy.deepcopy(prev)
        self.assertEqual(carry.forgotten_new_labels(prev, entries, WORKSPACE), {"speaker_1"})
        self.assertEqual(prev["labels"]["speaker_1"]["forgotten"], True)
        self.assertFalse(prev["labels"]["speaker_1"]["offered"])
        self.assertEqual(carry.forgotten_new_labels(None, entries, WORKSPACE), set())
        # (a fresh copy: a name already marked forgotten stays forgotten, review round 1)
        self.assertEqual(carry.forgotten_new_labels(fresh, entries, "harbor-mutual"), set())
        self.assertTrue(fresh["labels"]["speaker_1"]["offered"])

    # review round 1, forgotten-label-by-old-argmax-not-new-majority

    SAM_SOURCE = {"name": "Sam Diaz", "person": "contacts/sam-diaz", "origin": "hand", "status": "confirmed",
                  "named": "2026-08-01T10:00:00+02:00"}

    def test_an_over_split_forgotten_voice_keeps_no_windows_on_any_label_mostly_theirs(self):
        # Sam spoke 40-120 s; transcribed again, his time is split over speaker_1 (40-90) and speaker_2 (90-120)
        self.fm["transcription"]["speaker_sources"]["speaker_1"] = dict(self.SAM_SOURCE)
        self.body = "## Transcript\n\n[00:00] Speaker 0: good morning\n\n[00:40] Speaker 1: thanks\n"
        self.segments = [seg("speaker_0", 0, 40), seg("speaker_1", 40, 90), seg("speaker_2", 90, 120)]
        self.forget()
        self.run_it()
        sig = self.only_signature()
        self.assertEqual(sig["removed"], ["speaker_1", "speaker_2"])
        self.assertEqual(sig["labels"]["speaker_2"]["windows"], [])
        self.assertGreater(len(sig["labels"]["speaker_0"]["windows"]), 0)
        self.assertTrue(all(e <= 40.0 + 1e-9 for s, e in self.embedded), "a forgotten voice was embedded")

    def test_forgotten_new_labels_takes_every_new_label_mostly_a_forgotten_time(self):
        entries = [{"print": "p-1", "known_as": [{"workspace": WORKSPACE, "person": "contacts/sam-diaz",
                                                  "name": "Sam Diaz"}], "at": "2026-11-10T09:00:00+02:00"}]
        new = [seg("speaker_0", 0, 40), seg("speaker_1", 40, 90), seg("speaker_2", 90, 120),
               seg("speaker_3", 120, 200)]
        prev = {"labels": {
            "speaker_0": {"name": "Dana Oren", "new_label": "speaker_0", "share": 1.0, "offered": True},
            "speaker_1": {"name": "Sam Diaz", "new_label": "speaker_1", "share": 0.62, "offered": True}}}
        # speaker_3 is 30 of 80 s Sam's: not mostly his, kept
        spans = {"speaker_0": [(0.0, 40.0)], "speaker_1": [(40.0, 150.0)]}
        got = carry.forgotten_new_labels(prev, entries, WORKSPACE, spans=spans, new_segments=new)
        self.assertEqual(got, {"speaker_1", "speaker_2"})
        # previous() hands the old spans of each carried entry out for exactly this
        out = {}
        p = carry.previous({"transcription": {"speakers": {"speaker_0": "Dana Oren", "speaker_1": "Sam Diaz"}}},
                           "## Transcript\n\n[00:00] Speaker 0: hi\n\n[00:40] Speaker 1: hi\n", None, new[:3], 120.0,
                           spans_out=out)
        self.assertEqual(out, {"speaker_0": [(0.0, 40.0)], "speaker_1": [(40.0, 120.0)]})
        self.assertEqual(carry.forgotten_new_labels(p, entries, WORKSPACE, spans=out, new_segments=new[:3]),
                         {"speaker_1", "speaker_2"})

    # review round 1, unmapped-forgotten-label-stores-windows (ruling: privacy first)

    def test_a_forgotten_name_that_cannot_be_placed_keeps_no_windows_of_any_label(self):
        self.body = "## Transcript\n\nSpeaker 0: good morning\n\nSpeaker 1: thanks\n"
        self.forget()
        summary = self.run_it()
        sig = self.only_signature()
        self.assertEqual(sig["removed"], ["speaker_0", "speaker_1"])
        self.assertTrue(all(v["windows"] == [] for v in sig["labels"].values()))
        self.assertEqual(self.embedded, [], "a voice was embedded beside an unplaceable forgotten one")
        self.assertEqual(summary["signatures"],
                         "not kept — an earlier speaker who was forgotten cannot be placed in this transcript")
        self.assertIn("## Transcript", self.written_body)
        self.assertEqual(self.t["speakers"], {})
        sam = self.t["previous_speakers"]["labels"]["speaker_1"]
        self.assertTrue(sam["forgotten"])
        self.assertFalse(sam["offered"])
        printed = json.loads(self.stdout.strip().splitlines()[-1])
        self.assertEqual(printed["signatures"], summary["signatures"])

    def test_unplaceable_names_with_nobody_forgotten_keep_their_windows(self):
        self.body = "## Transcript\n\nSpeaker 0: good morning\n\nSpeaker 1: thanks\n"
        self.forget(workspace="harbor-mutual")
        summary = self.run_it()
        sig = self.only_signature()
        self.assertEqual(sig["removed"], [])
        self.assertTrue(summary["signatures"].startswith("kept"), summary["signatures"])

    def test_an_earlier_forgotten_mark_removes_its_label_whatever_forgotten_json_says(self):
        self.fm = {"name": "Northwind weekly", "transcription": {
            "diarization_id": "0123456789ab", "speakers": {},
            "previous_speakers": {"diarization_id": None, "labels": {
                "speaker_1": {"name": "Sam Diaz", "new_label": "speaker_1", "share": 1.0, "offered": False,
                              "forgotten": True}}}}}
        self.run_it()
        self.assertEqual(self.only_signature()["removed"], ["speaker_1"])


# ------------------------------------------------------------------------------------------------------
# Review round 1, malformed-speaker-map-fails-run-after-asr: an unreadable earlier map never fails run

ODD_MAPS = (
    ("transcription.speakers", {"speakers": ["Dana Oren", "Sam Diaz"]}),
    ("transcription.speakers", {"speakers": "Dana Oren"}),
    ("transcription.speaker_sources", {"speakers": {"speaker_0": "Dana Oren"}, "speaker_sources": ["x"]}),
    ("transcription.previous_speakers.labels",
     {"speakers": {"speaker_0": "Dana Oren"}, "previous_speakers": {"labels": ["x"]}}),
    ("transcription.previous_speakers", {"speakers": {"speaker_0": "Dana Oren"}, "previous_speakers": "x"}),
    ("transcription.speakers.speaker_1", {"speakers": {"speaker_0": "Dana Oren", "speaker_1": ["Sam"]}}),
)


class UnreadableNames(Harness):
    def setUp(self):
        super().setUp()
        self.segments = [seg("speaker_0", 0, 60), seg("speaker_1", 60, 120)]

    def test_an_earlier_map_that_cannot_be_read_still_writes_the_transcript_and_says_so(self):
        for field, t in ODD_MAPS:
            with self.subTest(field=field, t=t):
                self.written = None
                self.fm = {"name": "Northwind weekly", "transcription": dict(t, diarization_id="0123456789ab")}
                self.body = BODY_TWO
                summary = self.run_it()
                self.assertIsNotNone(self.written, "the transcript was not written")
                self.assertIn("## Transcript", self.written_body)
                self.assertEqual(self.t["speakers"], {})
                self.assertIn(field, summary["previous_speakers"]["unreadable"])
                self.assertIn(field, self.stderr)
                self.assertIn("not carried", self.stderr)
                # nothing of the record is lost: what could not be read is kept as it was written
                kept = {u["field"]: u["value"] for u in self.t["previous_speakers"]["unreadable"]}
                self.assertIn(field, kept)
                if "Dana Oren" in json.dumps(t.get("speakers")) and isinstance(t["speakers"], dict):
                    names = [e["name"] for e in self.t["previous_speakers"]["labels"].values()]
                    self.assertIn("Dana Oren", names)

    def test_a_non_string_label_is_read_as_its_text(self):
        self.fm = {"name": "Northwind weekly", "transcription": {"speakers": {0: "Dana Oren"}}}
        self.body = BODY_TWO
        self.run_it()
        self.assertEqual(self.t["previous_speakers"]["labels"]["0"]["name"], "Dana Oren")

    def test_the_earlier_names_are_read_before_decoding_starts(self):
        self.named_record(BODY_TWO)
        order = []
        real_earlier = carry.earlier

        def earlier(fm):
            order.append("earlier")
            return real_earlier(fm)

        def decode(src, dst):
            order.append("decode")
            Path(dst).write_bytes(b"RIFF")

        with mock.patch.object(carry, "earlier", earlier), mock.patch.object(tm, "decode_audio", decode):
            self.run_it()
        self.assertEqual(order, ["earlier", "decode"])

    def test_previous_never_raises_on_an_odd_map(self):
        new = [seg("speaker_0", 0, 60)]
        for _, t in ODD_MAPS + (("", {"speakers": {0: "Dana"}}), ("", "a string"),
                                ("", {"previous_speakers": {"labels": {"speaker_0": "x", "speaker_1": {"name": 3}}}})):
            with self.subTest(t=t):
                carry.previous({"transcription": t}, "[00:00] Speaker 0: hi\n", None, new, 60.0)
        broken_cache = {"asr": "x", "segments": [{"speaker": "speaker_0"}, "x", None]}
        p = carry.previous({"transcription": {"speakers": {"speaker_0": "Dana Oren"}}}, "", broken_cache, new, 60.0)
        self.assertEqual(p["labels"]["speaker_0"]["name"], "Dana Oren")


# ------------------------------------------------------------------------------------------------------
# Seam 3: the signature file

class Compute(unittest.TestCase):
    class Emb:
        def __init__(self):
            self.model = vp_store.Model(CAMPP, FAKE_SHA, DIM)
            self.asked = []

        def embed(self, samples, sr, windows):
            self.asked.extend(windows)
            return [{"start": s, "end": e, "vector": vp_synth.windows(vp_synth.voice(7, DIM), 1, seed=(7, s))[0]}
                    for s, e in windows if e - s >= 2.0]

    def compute(self, segs, words=(), removed=(), hint=2, fallback=None):
        self.emb = self.Emb()
        return signatures.compute(self.emb, [], 16000, segs, list(words), audio_sha256="ab12" * 16,
                                  diarization_id=vp_segments.diarization_id(segs), speakers_hint=hint,
                                  fallback=fallback, removed=removed)

    def test_the_shape_of_section_8(self):
        segs = [seg("speaker_0", 0, 30), seg("speaker_1", 30, 40), seg("speaker_0", 40, 50)]
        sig = self.compute(segs)
        self.assertEqual(sig["version"], 1)
        self.assertEqual(sig["audio"], "ab12" * 16)
        self.assertEqual(sig["diarization"], {"id": vp_segments.diarization_id(segs), "labels": 2,
                                              "speakers_hint": 2, "fallback": None})
        self.assertEqual(sig["model"], {"id": CAMPP, "sha256": FAKE_SHA, "dim": DIM})
        self.assertEqual(sig["removed"], [])
        l0 = sig["labels"]["speaker_0"]
        self.assertAlmostEqual(l0["seconds"], 40.0)
        self.assertAlmostEqual(l0["share"], 0.8)
        self.assertAlmostEqual(l0["longest_turn"], 30.0)
        self.assertTrue(all(set(w) == {"start", "end", "vector"} for w in l0["windows"]))
        self.assertEqual(len(sig["labels"]["speaker_1"]["windows"]), 1)

    def test_a_32_minute_turn_keeps_80_windows_spread_over_it(self):
        segs = [seg("speaker_0", 0, 1920), seg("speaker_1", 1920, 1980)]
        sig = self.compute(segs)
        ws = sig["labels"]["speaker_0"]["windows"]
        self.assertEqual(len(ws), 80)
        self.assertEqual(ws[0]["start"], 0.0)
        self.assertGreaterEqual(ws[-1]["start"], 1914.0 - 1e-6)
        self.assertTrue(all(w["end"] - w["start"] <= 6.0 + 1e-9 for w in ws))

    def test_with_no_diarisation_the_windows_come_from_the_word_timings(self):
        sig = self.compute([], words=words_every_second(60), hint=None, fallback="diariser exited -10; one speaker")
        self.assertEqual(list(sig["labels"]), ["speaker_0"])
        self.assertEqual(sig["diarization"]["fallback"], "diariser exited -10; one speaker")
        self.assertEqual(sig["diarization"]["labels"], 1)
        self.assertAlmostEqual(sig["labels"]["speaker_0"]["share"], 1.0)
        ws = sig["labels"]["speaker_0"]["windows"]
        self.assertGreaterEqual(len(ws), 9)
        self.assertTrue(all(w["end"] <= 60.0 for w in ws))

    def test_a_removed_label_is_never_embedded(self):
        segs = [seg("speaker_0", 0, 30), seg("speaker_1", 30, 60)]
        sig = self.compute(segs, removed=("speaker_1",))
        self.assertEqual(sig["removed"], ["speaker_1"])
        self.assertEqual(sig["labels"]["speaker_1"]["windows"], [])
        self.assertTrue(all(e <= 30.0 for s, e in self.emb.asked))

    def test_a_signature_holds_no_name(self):
        sig = self.compute([seg("speaker_0", 0, 30), seg("speaker_1", 30, 60)])
        vp_store._check_no_names(sig)


class Signatures(Harness):
    def test_kept_signatures_name_the_record_and_say_so(self):
        summary = self.run_it()
        sig = self.only_signature()
        self.assertEqual(sig["records"], [{"workspace": WORKSPACE, "record": RECORD}])
        self.assertEqual(sig["diarization"]["id"], self.t["diarization_id"])
        self.assertEqual(set(sig["labels"]), {"speaker_0", "speaker_1"})
        self.assertTrue(summary["signatures"].startswith("kept"), summary["signatures"])
        self.assertEqual(self.excluded, [str(self.vp_home)], "the store was not excluded from backups once")
        self.assertEqual(self.events, ["record"])

    def test_the_transcript_is_written_before_the_signature(self):
        real = vp_store.Store.write_signature

        def spy(st, *a, **k):
            self.events.append("signature")
            return real(st, *a, **k)

        with mock.patch.object(vp_store.Store, "write_signature", spy):
            self.run_it()
        self.assertEqual(self.events, ["record", "signature"])

    def test_a_second_workspace_on_the_same_audio_and_diarisation_shares_the_file(self):
        self.run_it()
        self.context = dict(self.context, workspace="harbor-mutual", record="meeting-recordings/2026/08/hm-weekly")
        self.run_it()
        sig = self.only_signature()
        self.assertEqual(sig["records"], [{"workspace": WORKSPACE, "record": RECORD},
                                          {"workspace": "harbor-mutual", "record": "meeting-recordings/2026/08/hm-weekly"}])


class ActiveModel(Harness):
    """Revisions entry 1: `run` embeds with `models.active_model(skill_dir)`, never another way."""

    def calibration(self, model_id):
        folder = self.skill / "calibration"
        folder.mkdir()
        (folder / f"calibration-{model_id}.json").write_text(json.dumps({"model": model_id, "accept": 0.8}),
                                                              encoding="utf-8")

    def test_a_calibration_naming_the_other_model_is_the_model_run_embeds_with(self):
        other = next(m for m in vp_models.MODELS if m != vp_models.DEFAULT_MODEL)
        self.calibration(other)
        self.run_it()
        sig = self.only_signature()
        self.assertEqual(sig["model"]["id"], vp_models.active_model(str(self.skill)))
        self.assertEqual(sig["model"]["id"], other)
        self.assertEqual(self.embedder_models, [other])
        self.assertIn(other, self.sig_files()[0].relative_to(self.vp_home).parts[0])

    def test_with_no_calibration_it_is_the_default_model(self):
        self.run_it()
        self.assertEqual(self.only_signature()["model"]["id"], vp_models.DEFAULT_MODEL)
        self.assertEqual(self.embedder_models, [vp_models.DEFAULT_MODEL])


# ------------------------------------------------------------------------------------------------------
# Signatures not kept: the transcript is still written, the summary says why

class NotKept(Harness):
    def assert_not_kept(self, summary, *words):
        self.assertIsNotNone(self.written, "the transcript was not written")
        self.assertEqual(self.t["speakers"], {})
        self.assertIn("## Transcript", self.written_body)
        self.assertTrue(summary["signatures"].startswith("not kept — "), summary["signatures"])
        for w in words:
            self.assertIn(w, summary["signatures"])
        printed = json.loads(self.stdout.strip().splitlines()[-1])
        self.assertEqual(printed["signatures"], summary["signatures"])

    def test_no_context(self):
        summary = self.run_it(context=None)
        self.assert_not_kept(summary, "context")
        self.assertFalse(self.vp_home.exists(), "a run with no context made a store")
        self.assertEqual(self.embedded, [])
        cache = json.loads(Path(self.cache_path).read_text(encoding="utf-8"))
        self.assertIsNone(cache["record"])

    def test_a_store_inside_the_workspace_is_refused_and_nothing_is_made(self):
        inside = self.ws / "vp"
        with mock.patch.dict(os.environ, {"VOICE_PRINTS_HOME": str(inside)}):
            summary = self.run_it()
        self.assert_not_kept(summary, "inside the workspace")
        self.assertFalse(inside.exists())
        self.assertEqual(self.embedded, [], "a refused store still had windows embedded")

    def test_a_store_that_became_a_link_into_a_synced_folder_mid_run(self):
        synced = self.root / "Dropbox" / "vp"
        synced.mkdir(parents=True)

        def relink():
            shutil.rmtree(self.vp_home)
            os.symlink(synced, self.vp_home)

        self.on_embed = relink
        summary = self.run_it()
        self.assert_not_kept(summary, "sync")
        self.assertEqual(list(synced.rglob("*")), [], "something was written through the link")

    def test_a_full_disk_when_the_signature_is_written(self):
        full = OSError(errno.ENOSPC, "No space left on device")
        with mock.patch.object(vp_store.Store, "write_signature", side_effect=full):
            summary = self.run_it()
        self.assert_not_kept(summary, "No space left on device")

    @unittest.skipIf(hasattr(os, "geteuid") and os.geteuid() == 0, "root writes through any mode")
    def test_a_model_folder_that_became_unwritable_mid_run(self):
        model_dir = self.vp_home / CAMPP

        def lock_up():
            model_dir.mkdir(mode=0o700)
            os.chmod(model_dir, 0o500)
            self.addCleanup(os.chmod, model_dir, 0o700)

        self.on_embed = lock_up
        summary = self.run_it()
        self.assert_not_kept(summary)
        self.assertEqual(self.sig_files(), [])

    def test_a_missing_speaker_model_never_blocks_the_transcript(self):
        models_dir = self.root / "models"
        models_dir.mkdir()
        # the module's own load_embedder (setUp replaced it), over a models folder with no speaker model
        with mock.patch.object(tm, "load_embedder", REAL_LOAD_EMBEDDER), \
                mock.patch.object(tm, "MODELS_DIR", str(models_dir)):
            summary = self.run_it()
        self.assert_not_kept(summary, f"speaker model {CAMPP} missing; run setup")
        self.assertEqual(self.sig_files(), [])

    def test_a_signature_made_with_another_model_file(self):
        self.run_it()
        path = self.sig_files()[0]
        sig = json.loads(path.read_text(encoding="utf-8"))
        sig["model"]["sha256"] = "0" * 64
        path.write_text(json.dumps(sig), encoding="utf-8")
        summary = self.run_it()
        self.assert_not_kept(summary, "prints rebuild")


REAL_LOAD_EMBEDDER = tm.load_embedder


# ------------------------------------------------------------------------------------------------------
# The node entry's `--context <file.json>`

class ContextArgument(Harness):
    def test_main_run_hands_the_context_file_to_run(self):
        f = self.root / "context.json"
        f.write_text(json.dumps(self.context), encoding="utf-8")
        seen = {}
        with mock.patch.object(tm, "run", lambda *a, **k: seen.update(args=a, kw=k)):
            tm.main_run(["run", self.record, self.audio, "--speakers", "2", "--engine", "cpu", "--context", str(f)])
        self.assertEqual(seen["args"][:2], (self.record, self.audio))
        self.assertEqual(seen["kw"]["context"], self.context)
        self.assertEqual(seen["kw"]["num_speakers"], 2)

    def test_an_unreadable_context_transcribes_without_it_and_says_so(self):
        seen = {}
        err = io.StringIO()
        with mock.patch.object(tm, "run", lambda *a, **k: seen.update(kw=k)), contextlib.redirect_stderr(err):
            tm.main_run(["run", self.record, self.audio, "--context", str(self.root / "nope.json")])
        self.assertIsNone(seen["kw"]["context"])
        self.assertIn("context", err.getvalue())

    def test_no_context_flag_is_no_context(self):
        seen = {}
        with mock.patch.object(tm, "run", lambda *a, **k: seen.update(kw=k)):
            tm.main_run(["run", self.record, self.audio])
        self.assertIsNone(seen["kw"]["context"])

    def test_a_several_records_context_picks_this_record(self):
        other = dict(self.context, record="meeting-recordings/x", record_path=str(self.root / "x.md"))
        f = self.root / "context.json"
        f.write_text(json.dumps({"workspace": WORKSPACE, "records": [other, self.context]}), encoding="utf-8")
        ctx, warning = tm.context_from_args(["run", self.record, self.audio, "--context", str(f)])
        self.assertIsNone(warning)
        self.assertEqual(ctx["record"], RECORD)

    def test_the_usage_line_names_the_context(self):
        r = subprocess.run([sys.executable, "-B", str(SKILL / "transcribe_meeting.py"), "nothing"],
                           capture_output=True, text=True, env=dict(os.environ, PYTHONDONTWRITEBYTECODE="1"))
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("--context <file.json>", r.stderr)
        self.assertIn("--speaker-models", r.stderr)


# ------------------------------------------------------------------------------------------------------
# Acceptance line 21

class Line21(Harness):
    """Transcribing a recording still writes no name — only /identify-speakers does"""

    def trusted_print_of_dana_on_speaker_0(self):
        self.store().write_print(CAMPP, {
            "version": 1, "id": "p-3f9a1c2e",
            "known_as": [{"workspace": WORKSPACE, "person": "users/dana-oren", "name": "Dana Oren"}],
            "model": {"id": CAMPP, "sha256": FAKE_SHA, "dim": DIM},
            "vector": vp_synth.voice(VOICE_SEEDS["speaker_0"], DIM), "seconds": 412.5,
            "trust": "trusted", "auto": True, "sources": [], "negatives": [],
            "created": "2026-08-01", "updated": "2026-08-01"})

    def test_a_trusted_print_matching_an_attendee_names_nobody(self):
        self.trusted_print_of_dana_on_speaker_0()
        self.run_it()
        self.assertEqual(self.t["speakers"], {})
        self.assertNotIn("speaker_sources", self.t)
        self.assertNotIn("speaker_questions", self.t)
        self.assertNotIn("identification", self.t)
        self.assertNotIn("speaker_naming", self.written)
        text = json.dumps(self.written, ensure_ascii=False) + self.written_body + self.stdout
        for name in ("Dana Oren", "Sam Diaz"):
            self.assertNotIn(name, text)

    def test_a_named_record_transcribed_again_keeps_its_names_aside_and_writes_none(self):
        self.named_record(BODY_TWO)
        self.run_it()
        self.assertEqual(self.t["speakers"], {})
        self.assertNotIn("speaker_sources", self.t)
        self.assertNotIn("speaker_naming", self.written)
        rest = {k: v for k, v in self.t.items() if k != "previous_speakers"}
        text = json.dumps(rest, ensure_ascii=False) + self.written_body
        for name in ("Dana Oren", "Sam Diaz"):
            self.assertNotIn(name, text)
            self.assertIn(name, json.dumps(self.t["previous_speakers"]))

    def test_the_signature_file_holds_no_name(self):
        self.named_record(BODY_TWO)
        self.trusted_print_of_dana_on_speaker_0()
        self.run_it()
        raw = self.sig_files()[0].read_text(encoding="utf-8")
        for name in ("Dana Oren", "Sam Diaz", "dana-oren", "sam-diaz"):
            self.assertNotIn(name, raw)


if __name__ == "__main__":
    unittest.main()
