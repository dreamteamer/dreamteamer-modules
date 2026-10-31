"""The Python environment and the raw ASR cache live in a per-machine cache OUTSIDE the skill folder.

The skill is installed into node_modules, so anything kept beside it — a uv venv, the ASR JSON of a
real call — is deleted by the next `npm install` (the venv) or sits in a package folder (the cache).
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


class VenvDir(unittest.TestCase):
    def test_default_is_the_per_machine_cache(self):
        self.assertEqual(locations.venv_dir(HOME), "/home/dana/.cache/dreamteamer/transcription-venv")

    def test_env_var_moves_it(self):
        self.assertEqual(locations.venv_dir({**HOME, "TRANSCRIBING_VENV_DIR": "/srv/transcription/venv"}),
                         "/srv/transcription/venv")

    def test_empty_env_var_falls_back_to_the_default(self):
        self.assertEqual(locations.venv_dir({**HOME, "TRANSCRIBING_VENV_DIR": ""}),
                         "/home/dana/.cache/dreamteamer/transcription-venv")

    def test_a_tilde_or_relative_value_never_lands_beside_the_skill(self):
        self.assertEqual(locations.venv_dir({**HOME, "TRANSCRIBING_VENV_DIR": "~/venvs/t"}), "/home/dana/venvs/t")
        rel = locations.venv_dir({**HOME, "TRANSCRIBING_VENV_DIR": "venvs/t"})
        self.assertTrue(os.path.isabs(rel), rel)

    def test_never_inside_the_skill_folder_by_default(self):
        self.assertFalse(locations.inside(locations.venv_dir(HOME), str(SKILL)))


class ModelsDir(unittest.TestCase):
    """The weights live in the per-machine cache by default, never beside the skill (before 0.2.2 they
    did, and every npm install deleted them)."""

    def test_default_is_the_per_machine_cache(self):
        self.assertEqual(locations.models_dir(HOME), "/home/dana/.cache/dreamteamer/transcription-models")

    def test_env_var_moves_it(self):
        self.assertEqual(locations.models_dir({**HOME, "TRANSCRIBING_MODELS_DIR": "/srv/transcription/models"}),
                         "/srv/transcription/models")

    def test_empty_env_var_falls_back_to_the_default(self):
        self.assertEqual(locations.models_dir({**HOME, "TRANSCRIBING_MODELS_DIR": ""}),
                         "/home/dana/.cache/dreamteamer/transcription-models")

    def test_a_tilde_value_expands(self):
        self.assertEqual(locations.models_dir({**HOME, "TRANSCRIBING_MODELS_DIR": "~/models"}), "/home/dana/models")

    def test_never_inside_the_skill_folder_by_default(self):
        self.assertFalse(locations.inside(locations.models_dir(HOME), str(SKILL)))


class CacheDir(unittest.TestCase):
    def test_default_is_the_per_machine_cache(self):
        self.assertEqual(locations.cache_dir(HOME), "/home/dana/.cache/dreamteamer/transcription-cache")
        self.assertEqual(locations.asr_cache_dir(HOME), "/home/dana/.cache/dreamteamer/transcription-cache/asr")

    def test_env_var_moves_it(self):
        env = {**HOME, "TRANSCRIBING_CACHE_DIR": "/srv/transcription/cache"}
        self.assertEqual(locations.cache_dir(env), "/srv/transcription/cache")
        self.assertEqual(locations.asr_cache_dir(env), "/srv/transcription/cache/asr")

    def test_empty_env_var_falls_back_to_the_default(self):
        self.assertEqual(locations.cache_dir({**HOME, "TRANSCRIBING_CACHE_DIR": ""}),
                         "/home/dana/.cache/dreamteamer/transcription-cache")


class AsrCachePath(unittest.TestCase):
    """The path `run` writes the raw ASR JSON to follows TRANSCRIBING_CACHE_DIR, never the skill folder."""

    def test_the_asr_json_lands_in_the_cache_dir_not_beside_the_skill(self):
        with tempfile.TemporaryDirectory() as cache:
            before = (SKILL / ".cache").exists()
            with mock.patch.dict(os.environ, {"TRANSCRIBING_CACHE_DIR": cache}):
                p = meeting_io.asr_cache_path_for("/w/data/meeting-recordings/2026-08-30--northwind-weekly.meeting-recording.md")
            self.assertEqual(p, os.path.join(cache, "asr", "2026-08-30--northwind-weekly.asr.json"))
            self.assertTrue(os.path.isdir(os.path.join(cache, "asr")))
            self.assertEqual((SKILL / ".cache").exists(), before, "a .cache folder appeared inside the skill")

    def test_the_default_is_under_home(self):
        with tempfile.TemporaryDirectory() as home:
            env = {k: v for k, v in os.environ.items() if k != "TRANSCRIBING_CACHE_DIR"}
            env["HOME"] = home
            with mock.patch.dict(os.environ, env, clear=True):
                p = meeting_io.asr_cache_path_for("/w/x.meeting-recording.md")
            self.assertEqual(p, os.path.join(home, ".cache", "dreamteamer", "transcription-cache", "asr", "x.asr.json"))


class Inside(unittest.TestCase):
    def test_inside(self):
        self.assertTrue(locations.inside("/w/skill/.venv", "/w/skill"))
        self.assertTrue(locations.inside("/w/skill", "/w/skill"))
        self.assertFalse(locations.inside("/w/skill-other/.venv", "/w/skill"))
        self.assertFalse(locations.inside("/home/dana/.cache/dreamteamer/transcription-venv", "/w/skill"))


class SkillDocumentsTheSameDefault(unittest.TestCase):
    """uv picks the environment before Python starts, so the venv location is set by the SKILL.md
    preamble's `export UV_PROJECT_ENVIRONMENT=…` — it must name the same variable and default as here."""

    def test_the_preamble_exports_uv_project_environment(self):
        text = (SKILL / "SKILL.md").read_text(encoding="utf-8")
        m = re.search(r'export UV_PROJECT_ENVIRONMENT="\$\{TRANSCRIBING_VENV_DIR:-\$HOME/([^}"]+)\}"', text)
        self.assertIsNotNone(m, "SKILL.md does not export UV_PROJECT_ENVIRONMENT from TRANSCRIBING_VENV_DIR")
        self.assertEqual("/home/dana/" + m.group(1), locations.venv_dir(HOME))

    def test_the_preamble_names_the_models_default_and_no_other(self):
        text = (SKILL / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn("~/.cache/dreamteamer/transcription-models", text)
        self.assertNotIn("transcribing-models", text, "SKILL.md names the old models folder, which holds no ggml weights")
        self.assertNotIn("export TRANSCRIBING_MODELS_DIR", text, "the default needs no export")

    def test_the_preamble_exports_the_cache_dir_default_unchanged(self):
        text = (SKILL / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn("TRANSCRIBING_CACHE_DIR", text)
        self.assertIn("~/.cache/dreamteamer/transcription-cache", text)


if __name__ == "__main__":
    unittest.main()
