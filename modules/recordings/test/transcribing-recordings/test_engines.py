"""The GPU pass's pure half: which engine runs, how whisper.cpp's JSON becomes words, the bidi strip,
the whisper-cli invocation and the verified download. Standard library only, and unittest rather than
pytest fixtures, so the repo's `npm test` runs it with a bare python3 (engines.test.mjs) and the
skill's pytest collects it too. Every transcript fixture is synthetic."""
import hashlib
import json
import os
import pathlib
import stat
import sys
import tempfile
import textwrap
import unittest
from unittest import mock

SKILL = pathlib.Path(__file__).resolve().parents[2] / "skills" / "transcribing-recordings"
sys.path.insert(0, str(SKILL))
import engines  # noqa: E402

E = engines


def seg(ms_from, ms_to, text):
    return {"offsets": {"from": ms_from, "to": ms_to}, "text": text}


class SelectEngine(unittest.TestCase):
    ALL = dict(whisper_cli="/usr/local/bin/whisper-cli", ggml_present=True, apple_gpu=True)

    def test_auto_picks_metal_when_everything_is_there(self):
        self.assertEqual(E.select_engine("auto", **self.ALL), "metal")

    def test_auto_falls_back_to_cpu_for_each_missing_piece(self):
        for missing in ("whisper_cli", "ggml_present", "apple_gpu"):
            kw = dict(self.ALL, **{missing: None if missing == "whisper_cli" else False})
            self.assertEqual(E.select_engine("auto", **kw), "cpu", missing)

    def test_cpu_is_cpu_even_on_a_gpu_machine(self):
        self.assertEqual(E.select_engine("cpu", **self.ALL), "cpu")

    def test_metal_by_name_refuses_and_names_what_is_missing(self):
        with self.assertRaises(E.EngineUnavailable) as cm:
            E.select_engine("metal", whisper_cli=None, ggml_present=False, apple_gpu=True)
        msg = str(cm.exception)
        self.assertIn("whisper-cli", msg)
        self.assertIn(E.GGML_FILE, msg)
        self.assertNotIn("Apple Silicon", msg)

    def test_metal_off_apple_silicon_refuses(self):
        with self.assertRaises(E.EngineUnavailable) as cm:
            E.select_engine("metal", whisper_cli="/usr/bin/whisper-cli", ggml_present=True, apple_gpu=False)
        self.assertIn("Apple Silicon", str(cm.exception))

    def test_an_unknown_engine_is_an_error(self):
        with self.assertRaises(ValueError):
            E.select_engine("cuda", **self.ALL)

    def test_apple_silicon_is_darwin_on_arm64_only(self):
        self.assertTrue(E.apple_silicon("Darwin", "arm64"))
        self.assertFalse(E.apple_silicon("Darwin", "x86_64"))
        self.assertFalse(E.apple_silicon("Linux", "arm64"))


class ParseEngineArg(unittest.TestCase):
    def test_absent_is_auto(self):
        self.assertEqual(E.parse_engine_arg(["run", "m.md", "a.wav", "--speakers", "2"]), "auto")

    def test_each_value_parses(self):
        for v in E.ENGINES:
            self.assertEqual(E.parse_engine_arg(["run", "m.md", "a.wav", "--engine", v]), v)

    def test_bad_or_missing_value_is_an_error(self):
        with self.assertRaises(ValueError):
            E.parse_engine_arg(["run", "m.md", "a.wav", "--engine", "gpu"])
        with self.assertRaises(ValueError):
            E.parse_engine_arg(["run", "m.md", "a.wav", "--engine"])


class StripBidi(unittest.TestCase):
    def test_every_directional_mark_goes(self):
        marks = "\u200e\u200f\u061c\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069"
        self.assertEqual(E.strip_bidi(f"{marks}abc{marks} def"), "abc def")

    def test_hebrew_letters_and_punctuation_survive(self):
        s = "\u05e9\u05dc\u05d5\u05dd, world."
        self.assertEqual(E.strip_bidi("\u200f" + s + "\u200e"), s)


class WordsFromWhisperJson(unittest.TestCase):
    def test_one_segment_per_word_becomes_one_word_in_seconds(self):
        doc = {"result": {"language": "en"}, "transcription": [
            seg(0, 320, " Northwind"), seg(320, 700, " ships"), seg(700, 1250, " Tuesday."),
        ]}
        out = E.words_from_whisper_json(doc)
        self.assertEqual(out["words"], [
            {"start": 0.0, "end": 0.32, "text": " Northwind"},
            {"start": 0.32, "end": 0.7, "text": " ships"},
            {"start": 0.7, "end": 1.25, "text": " Tuesday."},
        ])
        self.assertEqual(out["language"], "en")
        self.assertEqual(out["duration"], 1.25)

    def test_a_segment_without_a_leading_space_continues_the_previous_word(self):
        doc = {"transcription": [seg(0, 400, " Harbor"), seg(400, 900, " Mut"), seg(900, 1100, "ual"), seg(1100, 1500, " renews")]}
        words = E.words_from_whisper_json(doc)["words"]
        self.assertEqual([w["text"] for w in words], [" Harbor", " Mutual", " renews"])
        self.assertEqual((words[1]["start"], words[1]["end"]), (0.4, 1.1))

    def test_bidi_marks_markers_and_blanks_are_dropped(self):
        doc = {"transcription": [
            seg(0, 100, "[BLANK_AUDIO]"), seg(100, 400, " \u200f\u05db\u05df\u200e"),
            seg(400, 500, "   "), seg(500, 800, " \u202bok\u202c"), seg(800, 900, " [MUSIC] "),
        ]}
        words = E.words_from_whisper_json(doc)["words"]
        self.assertEqual([w["text"] for w in words], [" \u05db\u05df", " ok"])
        self.assertFalse(any(E._BIDI.search(w["text"]) for w in words))

    def test_the_words_render_through_the_existing_aligner(self):
        from render import align_words_to_speakers  # stdlib-only module beside the skill
        words = E.words_from_whisper_json({"transcription": [
            seg(0, 500, " Dana"), seg(500, 1000, " here."), seg(2000, 2500, " Sam"), seg(2500, 3000, " too."),
        ]})["words"]
        turns = align_words_to_speakers(words, [
            {"speaker": "speaker_0", "start": 0.0, "end": 1.5}, {"speaker": "speaker_1", "start": 1.5, "end": 3.0},
        ])
        self.assertEqual([(t["speaker"], t["text"]) for t in turns], [("speaker_0", "Dana here."), ("speaker_1", "Sam too.")])

    def test_empty_output_is_no_words(self):
        out = E.words_from_whisper_json({"transcription": []})
        self.assertEqual((out["words"], out["language"], out["duration"]), ([], None, 0.0))


class WhisperCli(unittest.TestCase):
    def test_the_invocation_splits_on_words_and_drops_the_text_prompt(self):
        a = E.whisper_cli_args("whisper-cli", "/m/ggml.bin", "/a.wav", "/o/asr")
        self.assertEqual(a[0], "whisper-cli")
        joined = " ".join(a)
        for flag in ("-m /m/ggml.bin", "-f /a.wav", "-l auto", "-ml 1", "-sow", "-mc 0", "-oj", "-of /o/asr"):
            self.assertIn(flag, joined)
        self.assertIn("-l he", " ".join(E.whisper_cli_args("whisper-cli", "m", "w", "o", language="he")))

    def _fake_cli(self, d, body):
        p = os.path.join(d, "whisper-cli")
        with open(p, "w") as f:
            f.write(f"#!{sys.executable}\n" + textwrap.dedent(body))
        os.chmod(p, os.stat(p).st_mode | stat.S_IXUSR)
        return p

    def test_run_reads_the_json_the_binary_writes(self):
        with tempfile.TemporaryDirectory() as d:
            cli = self._fake_cli(d, """
                import json, sys
                a = sys.argv
                doc = {"result": {"language": a[a.index("-l") + 1]},
                       "transcription": [{"offsets": {"from": 0, "to": 600}, "text": " \\u200fhello"},
                                         {"offsets": {"from": 600, "to": 900}, "text": " there"}]}
                open(a[a.index("-of") + 1] + ".json", "w").write(json.dumps(doc))
            """)
            out = E.run_whisper_cli(cli, "model.bin", "audio.wav", language="en")
        self.assertEqual([w["text"] for w in out["words"]], [" hello", " there"])
        self.assertEqual(out["language"], "en")

    def test_a_failing_binary_is_a_clear_exit(self):
        with tempfile.TemporaryDirectory() as d:
            cli = self._fake_cli(d, """
                import sys
                sys.stderr.write("error: failed to load model\\n"); sys.exit(3)
            """)
            with self.assertRaises(SystemExit) as cm:
                E.run_whisper_cli(cli, "model.bin", "audio.wav")
        self.assertIn("exit 3", str(cm.exception))
        self.assertIn("failed to load model", str(cm.exception))


class Ggml(unittest.TestCase):
    def test_path_and_pinned_url(self):
        self.assertEqual(E.ggml_path("/models"), os.path.join("/models", "whisper-ggml", "ggml-ivrit-large-v3-turbo.bin"))
        self.assertIn(f"/resolve/{E.GGML_REVISION}/", E.ggml_url())
        self.assertEqual(len(E.GGML_REVISION), 40, "pin a full commit, never a branch")

    def test_ready_means_present_at_the_exact_size(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertFalse(E.ggml_ready(d))
            os.makedirs(os.path.dirname(E.ggml_path(d)))
            with open(E.ggml_path(d), "wb") as f:
                f.write(b"\0" * 16)
            self.assertFalse(E.ggml_ready(d), "a truncated file is not ready")

    def test_download_lands_only_a_verified_file(self):
        with tempfile.TemporaryDirectory() as d:
            src = os.path.join(d, "src.bin")
            payload = b"synthetic weights" * 100
            with open(src, "wb") as f:
                f.write(payload)
            url = pathlib.Path(src).as_uri()
            dst = os.path.join(d, "out", "w.bin")
            E.download_verified(url, dst, len(payload), hashlib.sha256(payload).hexdigest())
            with open(dst, "rb") as f:
                self.assertEqual(f.read(), payload)

            bad = os.path.join(d, "out", "bad.bin")
            with self.assertRaises(SystemExit):
                E.download_verified(url, bad, len(payload), "0" * 64)
            self.assertFalse(os.path.exists(bad))
            self.assertFalse(os.path.exists(bad + ".part"))

    def test_a_download_that_dies_mid_stream_leaves_no_part_file(self):
        class Dropped:
            def __init__(self):
                self.calls = 0
            def __enter__(self):
                return self
            def __exit__(self, *exc):
                return False
            def read(self, n):
                self.calls += 1
                if self.calls > 1:
                    raise ConnectionResetError("connection dropped")
                return b"partial"
        with tempfile.TemporaryDirectory() as d:
            dst = os.path.join(d, "out", "w.bin")
            with mock.patch.object(E.urllib.request, "urlopen", lambda url: Dropped()):
                with self.assertRaises(ConnectionResetError):
                    E.download_verified("https://models.example/w.bin", dst, 100, "0" * 64)
            self.assertFalse(os.path.exists(dst))
            self.assertFalse(os.path.exists(dst + ".part"), "a dropped download left its .part behind")


if __name__ == "__main__":
    unittest.main()
