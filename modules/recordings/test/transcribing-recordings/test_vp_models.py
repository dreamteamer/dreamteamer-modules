"""The speaker models (cr-modules-019 task 3): the registry, where the files live, the sha256 pin, the
active model, `setup` and `missing_models`, and window embedding.

Standard library only, so a bare python3 runs it (vp-models.test.mjs): no model file is needed — every
file here is a stand-in made in a temp directory (a sparse file at the registered size, or a few bytes
whose sha256 a patched registry entry names), every download is a mock, and nothing reaches the
network. `voiceprints.embed` needs numpy, so it is imported inside the one class that tests it, and
only where numpy is installed; the rest never imports it.
"""
from __future__ import annotations

import hashlib
import importlib
import json
import os
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
SKILL = HERE.parents[1] / "skills" / "transcribing-recordings"
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(SKILL))

import transcribe_meeting as tm  # noqa: E402
from voiceprints import models, store  # noqa: E402

CAMPP = "campp-en-voxceleb-lm"


def eres_id():
    return next(m for m in models.MODELS if m.startswith("eres2netv2-"))


def sparse(path, size):
    """A stand-in model file at `size` bytes that takes no disk (and is not the real file)."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.truncate(size)


class Tmp(unittest.TestCase):
    def setUp(self):
        self._td = tempfile.TemporaryDirectory()
        self.tmp = Path(self._td.name)
        self.models_dir = str(self.tmp / "models")
        self.skill = self.tmp / "skill"
        self.skill.mkdir()

    def tearDown(self):
        self._td.cleanup()

    def calibration(self, name, obj=None):
        folder = self.skill / "calibration"
        folder.mkdir(exist_ok=True)
        (folder / name).write_text(json.dumps(obj if obj is not None else {"accept": 0.8}), encoding="utf-8")


class Registry(unittest.TestCase):
    def test_every_entry_is_complete(self):
        self.assertGreaterEqual(len(models.MODELS), 2)
        for key, e in models.MODELS.items():
            with self.subTest(model=key):
                self.assertEqual(set(e), {"id", "file", "url", "size", "sha256", "dim", "licence"})
                self.assertEqual(e["id"], key)
                self.assertRegex(e["id"], r"^[a-z0-9][a-z0-9.-]*$")
                self.assertTrue(e["file"].endswith(".onnx"))
                self.assertTrue(e["url"].startswith(
                    "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/"))
                self.assertTrue(e["url"].endswith("/" + e["file"]))
                self.assertIsInstance(e["size"], int)
                self.assertGreater(e["size"], 1_000_000)
                self.assertRegex(e["sha256"], r"^[0-9a-f]{64}$")
                self.assertIsInstance(e["dim"], int)
                self.assertGreater(e["dim"], 0)
                self.assertIsInstance(e["licence"], str)
                self.assertTrue(e["licence"].strip())
        files = [e["file"] for e in models.MODELS.values()]
        self.assertEqual(len(files), len(set(files)))

    def test_default_is_the_diarisers_upstream_file_kept_as_its_own_copy(self):
        self.assertEqual(models.DEFAULT_MODEL, CAMPP)
        e = models.MODELS[CAMPP]
        self.assertEqual(e["file"], "wespeaker_en_voxceleb_CAM++_LM.onnx")
        self.assertEqual(e["url"], tm._EMB_URL)
        self.assertNotEqual(os.path.dirname(models.model_path(CAMPP, "/m")), os.path.dirname(tm.EMB_MODEL))

    def test_the_second_model_is_eres2netv2_named_after_its_file(self):
        mid = eres_id()
        e = models.MODELS[mid]
        self.assertTrue(e["file"].startswith("3dspeaker_speech_eres2netv2_"))
        variant = mid[len("eres2netv2-"):]
        self.assertTrue(variant)
        self.assertIn(variant.replace("-", "_"), e["file"].replace("-", "_"))

    def test_models_live_in_models_speaker(self):
        p = models.model_path(CAMPP, os.path.join("x", "models"))
        self.assertEqual(p, os.path.join("x", "models", "speaker", "wespeaker_en_voxceleb_CAM++_LM.onnx"))

    def test_an_unknown_id_is_refused(self):
        with self.assertRaises(models.ModelRefused):
            models.model_path("no-such-model", "/m")


class Missing(Tmp):
    def test_each_absent_model_is_a_line_naming_setup(self):
        lines = models.missing(list(models.MODELS), self.models_dir)
        self.assertEqual(len(lines), len(models.MODELS))
        for mid, line in zip(models.MODELS, lines):
            self.assertIn(mid, line)
            self.assertIn("setup", line)
        self.assertIn(f"--speaker-models {eres_id()}", lines[1])

    def test_a_file_at_the_wrong_size_is_missing_and_one_at_the_right_size_is_not(self):
        p = models.model_path(CAMPP, self.models_dir)
        sparse(p, 1000)
        self.assertEqual(len(models.missing([CAMPP], self.models_dir)), 1)
        sparse(p, models.MODELS[CAMPP]["size"])
        self.assertEqual(models.missing([CAMPP], self.models_dir), [])


class Pin(Tmp):
    def test_a_stand_in_with_the_wrong_sha256_is_refused(self):
        sparse(models.model_path(CAMPP, self.models_dir), models.MODELS[CAMPP]["size"])
        with self.assertRaises(models.ModelRefused) as cm:
            models.pin(CAMPP, self.models_dir)
        self.assertIn("sha256", str(cm.exception))
        self.assertIn("setup", str(cm.exception))

    def test_a_missing_file_is_refused_naming_setup(self):
        with self.assertRaises(models.ModelRefused) as cm:
            models.pin(eres_id(), self.models_dir)
        self.assertIn("setup", str(cm.exception))

    def test_the_registered_file_pins_to_its_id_sha256_and_dim(self):
        data = b"stand-in speaker model"
        sha = hashlib.sha256(data).hexdigest()
        entry = {"id": "stand-in", "file": "stand-in.onnx", "url": models.RELEASE + "stand-in.onnx",
                 "size": len(data), "sha256": sha, "dim": 8, "licence": "test"}
        with mock.patch.dict(models.MODELS, {"stand-in": entry}):
            p = models.model_path("stand-in", self.models_dir)
            os.makedirs(os.path.dirname(p))
            Path(p).write_bytes(data)
            self.assertEqual(models.pin("stand-in", self.models_dir), store.Model("stand-in", sha, 8))
            Path(p).write_bytes(b"another stand-in model")
            with self.assertRaises(models.ModelRefused):
                models.pin("stand-in", self.models_dir)


class ActiveModel(Tmp):
    def test_no_calibration_folder_or_an_empty_one_is_the_default(self):
        self.assertEqual(models.active_model(str(self.skill)), models.DEFAULT_MODEL)
        (self.skill / "calibration").mkdir()
        (self.skill / "calibration" / ".DS_Store").write_bytes(b"")
        self.assertEqual(models.active_model(str(self.skill)), models.DEFAULT_MODEL)

    def test_the_one_file_names_the_model(self):
        self.calibration(f"{eres_id()}.json")
        self.assertEqual(models.active_model(str(self.skill)), eres_id())

    def test_the_written_name_and_the_model_inside_both_count(self):
        self.calibration(f"calibration-{eres_id()}.json", {"model": {"id": eres_id(), "sha256": "0" * 64}})
        self.assertEqual(models.active_model(str(self.skill)), eres_id())
        os.remove(self.skill / "calibration" / f"calibration-{eres_id()}.json")
        self.calibration("thresholds.json", {"model": CAMPP})
        self.assertEqual(models.active_model(str(self.skill)), CAMPP)

    def test_two_files_is_an_error_naming_both(self):
        self.calibration(f"{CAMPP}.json")
        self.calibration(f"{eres_id()}.json")
        with self.assertRaises(models.CalibrationAmbiguous) as cm:
            models.active_model(str(self.skill))
        self.assertIn(f"{CAMPP}.json", str(cm.exception))
        self.assertIn(f"{eres_id()}.json", str(cm.exception))

    def test_an_unregistered_or_contradicting_file_is_an_error(self):
        self.calibration("no-such-model.json")
        with self.assertRaises(models.CalibrationAmbiguous):
            models.active_model(str(self.skill))
        os.remove(self.skill / "calibration" / "no-such-model.json")
        self.calibration(f"{CAMPP}.json", {"model": eres_id()})
        with self.assertRaises(models.CalibrationAmbiguous):
            models.active_model(str(self.skill))


class SetupArgs(unittest.TestCase):
    def test_no_flag_is_none(self):
        self.assertIsNone(tm.setup_args([]))

    def test_all_is_every_registered_model(self):
        self.assertEqual(tm.setup_args(["--speaker-models", "all"]), list(models.MODELS))

    def test_a_list_of_ids(self):
        self.assertEqual(tm.setup_args(["--speaker-models", f"{eres_id()},{CAMPP}"]), [eres_id(), CAMPP])

    def test_an_unknown_id_or_no_value_is_refused(self):
        with self.assertRaises(models.ModelRefused):
            tm.setup_args(["--speaker-models", "no-such-model"])
        with self.assertRaises(models.ModelRefused):
            tm.setup_args(["--speaker-models"])

    def test_the_command_line_refuses_an_unknown_id_before_anything_is_fetched(self):
        with tempfile.TemporaryDirectory() as home:
            env = dict(os.environ, TRANSCRIPTION_HOME=home, HOME=home)
            r = subprocess.run([sys.executable, "-B", str(SKILL / "transcribe_meeting.py"), "setup",
                                "--speaker-models", "no-such-model"], capture_output=True, text=True, env=env)
            self.assertNotEqual(r.returncode, 0)
            self.assertIn("no-such-model", r.stderr)
            self.assertFalse(os.path.exists(os.path.join(home, "models")))


class Setup(Tmp):
    """`setup` fetches into models/speaker/ through a mocked download; nothing reaches the network."""

    def fake_download(self):
        calls = []

        def download(url, dst, size, sha256):
            calls.append((url, dst, size, sha256))
            sparse(dst, size)
        return calls, download

    def pins(self):
        return mock.patch.object(tm.vp_models, "pin", lambda mid, mdir: store.Model(mid, models.MODELS[mid]["sha256"],
                                                                                   models.MODELS[mid]["dim"]))

    def test_speaker_models_all_asks_for_both_and_nothing_else(self):
        calls, download = self.fake_download()
        with self.pins(), mock.patch.object(tm, "_download") as other, \
                mock.patch.object(tm.engines, "download_verified") as verified:
            tm.setup(speaker_models=tm.setup_args(["--speaker-models", "all"]), models_dir=self.models_dir,
                     skill_dir=str(self.skill), download=download)
        other.assert_not_called()
        verified.assert_not_called()
        self.assertEqual([c[0] for c in calls], [models.MODELS[m]["url"] for m in models.MODELS])
        for (url, dst, size, sha256), mid in zip(calls, models.MODELS):
            self.assertEqual(dst, os.path.join(self.models_dir, "speaker", models.MODELS[mid]["file"]))
            self.assertEqual((size, sha256), (models.MODELS[mid]["size"], models.MODELS[mid]["sha256"]))

    def test_the_default_downloader_is_the_verified_one(self):
        with self.pins(), mock.patch.object(tm.engines, "download_verified",
                                            side_effect=lambda u, d, s, h: sparse(d, s)) as verified:
            tm.setup(speaker_models=[CAMPP], models_dir=self.models_dir)
        self.assertEqual(verified.call_count, 1)
        self.assertEqual(verified.call_args[0][0], models.MODELS[CAMPP]["url"])

    def test_a_model_already_there_is_not_fetched_again(self):
        for mid in models.MODELS:
            sparse(models.model_path(mid, self.models_dir), models.MODELS[mid]["size"])
        calls, download = self.fake_download()
        with self.pins():
            tm.setup(speaker_models=list(models.MODELS), models_dir=self.models_dir, download=download)
        self.assertEqual(calls, [])

    def test_a_file_that_is_not_the_registered_one_stops_setup(self):
        sparse(models.model_path(CAMPP, self.models_dir), models.MODELS[CAMPP]["size"])
        calls, download = self.fake_download()
        with self.assertRaises(models.ModelRefused):
            tm.setup(speaker_models=[CAMPP], models_dir=self.models_dir, download=download)

    def test_plain_setup_fetches_the_active_speaker_model(self):
        """No flag: the whole setup, and of the speaker models only the active one (the calibration
        file names ERes2NetV2 here)."""
        self.calibration(f"{eres_id()}.json")
        diar = self.tmp / "diarization"
        diar.mkdir()
        seg, emb = diar / "segmentation.onnx", diar / "embedding.onnx"
        seg.write_bytes(b"x")
        emb.write_bytes(b"x")
        fake_fw = types.ModuleType("faster_whisper")
        fake_fw.WhisperModel = mock.Mock()
        calls, download = self.fake_download()
        with self.pins(), mock.patch.dict(sys.modules, {"faster_whisper": fake_fw}), \
                mock.patch.object(tm, "DIARIZATION_DIR", str(diar)), \
                mock.patch.object(tm, "SEG_MODEL", str(seg)), mock.patch.object(tm, "EMB_MODEL", str(emb)), \
                mock.patch.object(tm, "_download") as other, \
                mock.patch.object(tm.engines, "apple_silicon", lambda: False), \
                mock.patch.object(tm.engines, "find_whisper_cli", lambda: None):
            tm.setup(models_dir=self.models_dir, skill_dir=str(self.skill), download=download)
        other.assert_not_called()
        self.assertEqual([c[0] for c in calls], [models.MODELS[eres_id()]["url"]])
        fake_fw.WhisperModel.assert_called_once()


class MissingModels(Tmp):
    """Ruling D16: a missing speaker model is reported only when asked, so it never blocks `run`."""

    def setUp(self):
        super().setUp()
        self.seg = self.tmp / "seg.onnx"
        self.emb = self.tmp / "emb.onnx"
        self.seg.write_bytes(b"x")
        self.emb.write_bytes(b"x")

    def check(self, **kw):
        return tm.missing_models("metal", None, seg=str(self.seg), emb=str(self.emb),
                                 models_dir=self.models_dir, skill_dir=str(self.skill), **kw)

    def test_not_asked_the_speaker_model_is_never_reported(self):
        self.assertEqual(self.check(), [])
        self.assertEqual(tm.missing_models("metal", None, seg=str(self.seg), emb=str(self.emb)), [])

    def test_asked_the_active_model_is_reported_until_it_is_there(self):
        self.assertEqual(self.check(speaker=True), [models.model_path(CAMPP, self.models_dir)])
        self.calibration(f"{eres_id()}.json")
        self.assertEqual(self.check(speaker=True), [models.model_path(eres_id(), self.models_dir)])
        sparse(models.model_path(eres_id(), self.models_dir), models.MODELS[eres_id()]["size"])
        self.assertEqual(self.check(speaker=True), [])


class NoNumpyOutsideEmbed(unittest.TestCase):
    def test_the_transcriber_and_the_registry_load_without_numpy(self):
        code = ("import sys; sys.path.insert(0, sys.argv[1]); import transcribe_meeting; "
                "from voiceprints import models, store; "
                "bad = sorted(m for m in ('numpy', 'sherpa_onnx', 'soundfile', 'voiceprints.embed') if m in sys.modules); "
                "sys.exit(' '.join(bad) or None)")
        r = subprocess.run([sys.executable, "-B", "-s", "-c", code, str(SKILL)], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)


def _have_numpy():
    try:
        importlib.import_module("numpy")
        return True
    except ImportError:
        return False


@unittest.skipUnless(_have_numpy(), "voiceprints.embed needs numpy (the venv); the bare CI python3 has none")
class Embed(Tmp):
    """The window rules of embed.Embedder, with a fake extractor in place of sherpa-onnx."""

    class FakeStream:
        def __init__(self):
            self.samples = []

        def accept_waveform(self, sr, samples):
            self.sr = sr
            self.samples.extend(float(x) for x in samples)

        def input_finished(self):
            pass

    class FakeExtractor:
        dim = 4

        def __init__(self):
            self.seen = []

        def create_stream(self):
            return Embed.FakeStream()

        def is_ready(self, stream):
            return True

        def compute(self, stream):
            self.seen.append(len(stream.samples))
            n = len(stream.samples)
            return [3.0, 4.0, 0.0, float(n % 2)]

    def setUp(self):
        super().setUp()
        from voiceprints import embed
        self.embed = embed
        data = b"stand-in speaker model"
        entry = {"id": "stand-in", "file": "stand-in.onnx", "url": models.RELEASE + "stand-in.onnx",
                 "size": len(data), "sha256": hashlib.sha256(data).hexdigest(), "dim": 4, "licence": "test"}
        self._patch = mock.patch.dict(models.MODELS, {"stand-in": entry})
        self._patch.start()
        p = models.model_path("stand-in", self.models_dir)
        os.makedirs(os.path.dirname(p))
        Path(p).write_bytes(data)

    def tearDown(self):
        self._patch.stop()
        super().tearDown()

    def signal(self, sr=16000):
        """0-3 s a tone, 3-6 s silence, 6-7.5 s a tone, 7.5-10 s silence."""
        import numpy as np
        t = np.arange(int(10 * sr)) / sr
        tone = (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)
        on = ((t < 3.0) | ((t >= 6.0) & (t < 7.5)))
        return np.where(on, tone, 0.0).astype(np.float32)

    def test_windows_under_two_seconds_of_speech_are_left_out_and_silence_is_dropped(self):
        fx = self.FakeExtractor()
        e = self.embed.Embedder("stand-in", self.models_dir, extractor=fx)
        self.assertEqual(e.model, store.Model("stand-in", models.MODELS["stand-in"]["sha256"], 4))
        out = e.embed(self.signal(), 16000, [(0.0, 6.0), (3.0, 6.0), (5.0, 10.0)])
        self.assertEqual([(w["start"], w["end"]) for w in out], [(0.0, 6.0)])
        self.assertEqual(fx.seen, [3 * 16000])
        v = out[0]["vector"]
        self.assertAlmostEqual(sum(x * x for x in v), 1.0, places=9)
        self.assertEqual(v, [0.6, 0.8, 0.0, 0.0])

    def test_an_extractor_of_another_dimension_is_refused(self):
        fx = self.FakeExtractor()
        fx.dim = 5
        with self.assertRaises(models.ModelRefused):
            self.embed.Embedder("stand-in", self.models_dir, extractor=fx)


if __name__ == "__main__":
    unittest.main()
