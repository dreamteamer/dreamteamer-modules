"""Everything the transcriber keeps lives in ONE folder outside the skill: $TRANSCRIPTION_HOME, default
~/.cache/dreamteamer/transcription, with models/{diarization,whisper-ct2,whisper-ggml}, venv/ and asr/.

The skill is installed into node_modules, so anything kept beside it — the weights, a uv venv, the ASR
JSON of a real call — is deleted by the next `npm install` or sits in a package folder.
Standard library only, so `npm test` runs it with a bare python3 (run-cleanup.test.mjs).
"""
import os
import pathlib
import re
import sys
import tempfile
import unittest
from unittest import mock

SKILL = pathlib.Path(__file__).resolve().parents[2] / "skills" / "transcribing-recordings"
sys.path.insert(0, str(SKILL))
import locations  # noqa: E402
import meeting_io  # noqa: E402

HOME = {"HOME": "/home/dana"}


D = "/home/dana/.cache/dreamteamer/transcription"


class Home(unittest.TestCase):
    def test_default_is_one_folder_in_the_per_machine_cache(self):
        self.assertEqual(locations.transcription_home(HOME), D)

    def test_the_variable_moves_it(self):
        self.assertEqual(locations.transcription_home({**HOME, "TRANSCRIPTION_HOME": "/srv/transcription"}),
                         "/srv/transcription")

    def test_an_empty_variable_is_the_default(self):
        self.assertEqual(locations.transcription_home({**HOME, "TRANSCRIPTION_HOME": ""}), D)

    def test_a_tilde_or_relative_value_never_lands_beside_the_skill(self):
        self.assertEqual(locations.transcription_home({**HOME, "TRANSCRIPTION_HOME": "~/t"}), "/home/dana/t")
        self.assertTrue(os.path.isabs(locations.transcription_home({**HOME, "TRANSCRIPTION_HOME": "t"})))

    def test_never_inside_the_skill_folder_by_default(self):
        self.assertFalse(locations.inside(locations.transcription_home(HOME), str(SKILL)))

    def test_the_old_three_variables_move_nothing(self):
        env = {**HOME, "TRANSCRIBING_MODELS_DIR": "/x/m", "TRANSCRIBING_VENV_DIR": "/x/v", "TRANSCRIBING_CACHE_DIR": "/x/c"}
        for f in (locations.models_dir, locations.venv_dir, locations.asr_cache_dir):
            self.assertTrue(f(env).startswith(D + os.sep), f.__name__)


class Layout(unittest.TestCase):
    """Every path is a fixed name under the one folder, so the variable moves all of them together."""

    def test_each_path_under_the_default(self):
        self.assertEqual(locations.models_dir(HOME), D + "/models")
        self.assertEqual(locations.diarization_dir(HOME), D + "/models/diarization")
        self.assertEqual(locations.whisper_ct2_dir(HOME), D + "/models/whisper-ct2")
        self.assertEqual(locations.venv_dir(HOME), D + "/venv")
        self.assertEqual(locations.asr_cache_dir(HOME), D + "/asr")

    def test_the_variable_moves_every_path(self):
        env = {**HOME, "TRANSCRIPTION_HOME": "/srv/t"}
        for f in (locations.models_dir, locations.diarization_dir, locations.whisper_ct2_dir,
                  locations.venv_dir, locations.asr_cache_dir):
            self.assertTrue(f(env).startswith("/srv/t/"), f.__name__)


class AsrCachePath(unittest.TestCase):
    """The path `run` writes the raw ASR JSON to follows TRANSCRIPTION_HOME, never the skill folder."""

    def test_the_asr_json_lands_in_the_home_not_beside_the_skill(self):
        with tempfile.TemporaryDirectory() as home:
            before = (SKILL / ".cache").exists()
            with mock.patch.dict(os.environ, {"TRANSCRIPTION_HOME": home}):
                p = meeting_io.asr_cache_path_for("/w/data/meeting-recordings/2026-08-30--northwind-weekly.meeting-recording.md")
            self.assertEqual(p, os.path.join(home, "asr", "2026-08-30--northwind-weekly.asr.json"))
            self.assertTrue(os.path.isdir(os.path.join(home, "asr")))
            self.assertEqual((SKILL / ".cache").exists(), before, "a .cache folder appeared inside the skill")

    def test_the_default_is_under_home(self):
        with tempfile.TemporaryDirectory() as home:
            env = {k: v for k, v in os.environ.items() if k != "TRANSCRIPTION_HOME"}
            env["HOME"] = home
            with mock.patch.dict(os.environ, env, clear=True):
                p = meeting_io.asr_cache_path_for("/w/x.meeting-recording.md")
            self.assertEqual(p, os.path.join(home, ".cache", "dreamteamer", "transcription", "asr", "x.asr.json"))


class Inside(unittest.TestCase):
    def test_inside(self):
        self.assertTrue(locations.inside("/w/skill/.venv", "/w/skill"))
        self.assertTrue(locations.inside("/w/skill", "/w/skill"))
        self.assertFalse(locations.inside("/w/skill-other/.venv", "/w/skill"))
        self.assertFalse(locations.inside(D + "/venv", "/w/skill"))


class SkillDocumentsTheSameDefault(unittest.TestCase):
    """uv picks the environment before Python starts, so the venv location is set by the SKILL.md
    preamble's `export UV_PROJECT_ENVIRONMENT=…` — it must name the same variable and default as here."""

    def text(self):
        return (SKILL / "SKILL.md").read_text(encoding="utf-8")

    def test_the_preamble_exports_the_venv_under_the_home(self):
        m = re.search(r'export UV_PROJECT_ENVIRONMENT="\$\{TRANSCRIPTION_HOME:-\$HOME/([^}"]+)\}/venv"', self.text())
        self.assertIsNotNone(m, "SKILL.md does not export UV_PROJECT_ENVIRONMENT as $TRANSCRIPTION_HOME/venv")
        self.assertEqual("/home/dana/" + m.group(1) + "/venv", locations.venv_dir(HOME))

    def test_the_old_variables_and_folders_are_gone_from_the_skill(self):
        text = self.text()
        for gone in ("TRANSCRIBING_MODELS_DIR", "TRANSCRIBING_VENV_DIR", "TRANSCRIBING_CACHE_DIR",
                     "transcription-models", "transcription-venv", "transcription-cache", "transcribing-models"):
            self.assertNotIn(gone, text)


if __name__ == "__main__":
    unittest.main()
