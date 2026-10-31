"""`run` decodes the call into a temp folder; that folder must be gone when `run` returns AND when it
raises. Before 0.2.1 every transcription left a full decoded copy of the call under TMPDIR.

Standard library only, so `npm test` runs it with a bare python3 (run-cleanup.test.mjs): diarization,
recognition and the record I/O are replaced, and the decode is the real one. The clip is a synthetic
sine tone made by ffmpeg. Where ffmpeg is not on PATH (GitHub's ubuntu runner has none), a stand-in
`ffmpeg` on PATH writes the same 16 kHz mono WAV with the `wave` module, so the temp-folder lifecycle
under test is identical: `decode_audio` still finds a binary, runs it, and reads its exit code.
"""
import contextlib
import io
import math
import os
import pathlib
import shutil
import stat
import struct
import subprocess
import sys
import tempfile
import textwrap
import unittest
import wave
from unittest import mock

SKILL = pathlib.Path(__file__).resolve().parents[2] / "skills" / "transcribing-recordings"
sys.path.insert(0, str(SKILL))
import transcribe_meeting as tm  # noqa: E402

REAL_FFMPEG = shutil.which("ffmpeg")

STAND_IN = textwrap.dedent('''\
    #!{python}
    """A stand-in ffmpeg: `... -i <src> ... <dst> -y` → a 1 s 16 kHz mono sine WAV at <dst>."""
    import math, struct, sys, wave
    args = sys.argv[1:]
    src = args[args.index("-i") + 1]
    dst = args[args.index("-y") - 1]
    with open(src, "rb") as f:
        if f.read(9) == b"not audio":
            sys.stderr.write(src + ": Invalid data found when processing input\\n")
            sys.exit(1)
    with wave.open(dst, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
        w.writeframes(b"".join(struct.pack("<h", int(8000 * math.sin(2 * math.pi * 440 * i / 16000)))
                               for i in range(16000)))
''')


def write_sine_wav(path, rate=44100, seconds=1):
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"".join(struct.pack("<h", int(8000 * math.sin(2 * math.pi * 440 * i / rate)))
                               for i in range(rate * seconds)))


class RunLeavesNoDecodedAudio(unittest.TestCase):
    def setUp(self):
        self.work = tempfile.mkdtemp(prefix="run-cleanup-")
        self.addCleanup(shutil.rmtree, self.work, True)
        # Every temp folder run() makes lands here, so "nothing is left" is an exact listing.
        self.scratch = os.path.join(self.work, "tmp")
        os.mkdir(self.scratch)
        saved = tempfile.tempdir
        tempfile.tempdir = self.scratch
        self.addCleanup(setattr, tempfile, "tempdir", saved)

        self.record = os.path.join(self.work, "2026-08-30--northwind-weekly.meeting-recording.md")
        pathlib.Path(self.record).write_text("---\nname: Northwind weekly\n---\n", encoding="utf-8")
        self.asr_json = os.path.join(self.work, "cache", "northwind-weekly.asr.json")
        os.makedirs(os.path.dirname(self.asr_json))

        self.clip = os.path.join(self.work, "clip.m4a" if REAL_FFMPEG else "clip.wav")
        if REAL_FFMPEG:
            subprocess.run([REAL_FFMPEG, "-nostdin", "-loglevel", "error", "-f", "lavfi",
                            "-i", "sine=frequency=440:duration=1", "-c:a", "aac", self.clip, "-y"], check=True)
        else:
            write_sine_wav(self.clip)
            bindir = os.path.join(self.work, "bin")
            os.mkdir(bindir)
            fake = os.path.join(bindir, "ffmpeg")
            pathlib.Path(fake).write_text(STAND_IN.format(python=sys.executable), encoding="utf-8")
            os.chmod(fake, os.stat(fake).st_mode | stat.S_IXUSR)
            path_patch = mock.patch.dict(os.environ, {"PATH": bindir + os.pathsep + os.environ.get("PATH", "")})
            path_patch.start()
            self.addCleanup(path_patch.stop)

        self.decoded = []  # (path, rate, channels, frames) of the WAV each recognition pass was handed
        for name, value in {
            "choose_engine": lambda requested: ("cpu", None),
            "missing_models": lambda engine, num_speakers: [],
            "read_meeting": lambda p: ({}, ""),
            "write_meeting": self.capture_record,
            "diarize_safe": lambda wav, num_speakers=None: [],
            "transcribe": self.fake_transcribe,
            "asr_cache_path_for": lambda p: self.asr_json,
        }.items():
            p = mock.patch.object(tm, name, value)
            p.start()
            self.addCleanup(p.stop)

    def capture_record(self, path, fm, body):
        self.written = fm

    def fake_transcribe(self, wav, language=None, engine="cpu"):
        with wave.open(wav, "rb") as w:
            self.decoded.append((wav, w.getframerate(), w.getnchannels(), w.getnframes()))
        return {"words": [{"start": 0.0, "end": 0.5, "text": " hello"}], "language": ["en"],
                "duration": 1.0, "language_forced": language}

    def leftovers(self):
        return sorted(str(p.relative_to(self.scratch)) for p in pathlib.Path(self.scratch).rglob("*"))

    def run_quietly(self, audio):
        with contextlib.redirect_stdout(io.StringIO()):
            return tm.run(self.record, audio, "2026-08-30", num_speakers=2, language="en", engine="cpu")

    def test_a_finished_run_leaves_no_temp_folder(self):
        summary = self.run_quietly(self.clip)
        self.assertEqual(summary["engine"], "cpu")
        self.assertEqual(len(self.decoded), 1, "recognition never saw a decoded WAV")
        wav, rate, channels, frames = self.decoded[0]
        self.assertEqual((rate, channels), (16000, 1), "the decode is not the 16 kHz mono the recognizers take")
        self.assertGreater(frames, 8000)
        self.assertTrue(wav.startswith(self.scratch + os.sep), f"the WAV was not decoded under TMPDIR: {wav}")
        self.assertFalse(os.path.exists(wav), "the decoded WAV survived the run")
        self.assertEqual(self.leftovers(), [], "run() left its temp folder behind")

    def test_a_cpu_run_by_request_records_no_fallback(self):
        summary = self.run_quietly(self.clip)
        self.assertIsNone(summary["engine_fallback"])
        self.assertNotIn("engine_fallback", self.written["transcription"])

    def test_auto_falling_back_to_the_cpu_says_why_on_stderr_in_the_summary_and_on_the_record(self):
        why = "metal unavailable — needs whisper-cli on PATH (macOS: brew install whisper-cpp)"
        err = io.StringIO()
        with mock.patch.object(tm, "choose_engine", lambda requested: ("cpu", why)), \
                contextlib.redirect_stderr(err):
            summary = self.run_quietly(self.clip)
        self.assertIn(f"engine: cpu — {why}", err.getvalue())
        self.assertEqual(summary["engine_fallback"], why)
        self.assertEqual(self.written["transcription"]["engine_fallback"], why)
        self.assertEqual(self.written["transcription"]["engine"], tm.engines.LABELS["cpu"])

    def test_a_run_that_raises_in_recognition_leaves_no_temp_folder(self):
        def boom(wav, language=None, engine="cpu"):
            self.fake_transcribe(wav, language, engine)
            raise RuntimeError("recognizer crashed")
        with mock.patch.object(tm, "transcribe", boom):
            with self.assertRaises(RuntimeError):
                self.run_quietly(self.clip)
        self.assertEqual(len(self.decoded), 1, "the run raised before it decoded anything")
        self.assertEqual(self.leftovers(), [], "a failed run left the decoded audio behind")

    def test_a_run_that_raises_in_diarization_leaves_no_temp_folder(self):
        with mock.patch.object(tm, "diarize_safe", mock.Mock(side_effect=KeyboardInterrupt)):
            with self.assertRaises(KeyboardInterrupt):
                self.run_quietly(self.clip)
        self.assertEqual(self.leftovers(), [], "an interrupted run left the decoded audio behind")

    def test_a_decode_that_fails_leaves_no_temp_folder(self):
        bad = os.path.join(self.work, "bad.m4a")
        pathlib.Path(bad).write_bytes(b"not audio at all")
        with self.assertRaises(SystemExit):
            self.run_quietly(bad)
        self.assertEqual(self.decoded, [])
        self.assertEqual(self.leftovers(), [], "a failed decode left its temp folder behind")



class MissingModelsStopTheRun(unittest.TestCase):
    """A run without its models stops before decoding anything, naming what is missing — it never
    diarizes into one speaker or pulls 1.5 GB from the network mid-run."""

    def setUp(self):
        self.d = tempfile.mkdtemp(prefix="models-")
        self.addCleanup(shutil.rmtree, self.d, True)
        self.seg, self.emb = os.path.join(self.d, "segmentation.onnx"), os.path.join(self.d, "embedding.onnx")
        self.ct2 = os.path.join(self.d, "whisper-ct2")

    def put(self, *paths):
        for p in paths:
            os.makedirs(os.path.dirname(p), exist_ok=True)
            pathlib.Path(p).write_bytes(b"x")

    def missing(self, engine, speakers):
        return tm.missing_models(engine, speakers, seg=self.seg, emb=self.emb, whisper_dir=self.ct2)

    def test_everything_present_is_nothing_missing(self):
        self.put(self.seg, self.emb, os.path.join(self.ct2, "models--x", "snapshots", "r", "model.bin"))
        self.assertEqual(self.missing("cpu", 2), [])

    def test_diarization_models_are_needed_unless_the_run_is_solo(self):
        self.put(os.path.join(self.ct2, "model.bin"))
        self.assertEqual(self.missing("cpu", 2), [self.seg, self.emb])
        self.assertEqual(self.missing("cpu", None), [self.seg, self.emb])
        self.assertEqual(self.missing("cpu", 1), [])

    def test_an_empty_onnx_file_counts_as_missing(self):
        self.put(os.path.join(self.ct2, "model.bin"), self.emb)
        pathlib.Path(self.seg).write_bytes(b"")
        self.assertEqual(self.missing("cpu", 2), [self.seg])

    def test_the_ct2_weights_are_needed_by_the_cpu_engine_only(self):
        self.put(self.seg, self.emb)
        self.assertEqual(self.missing("cpu", 2), [self.ct2])
        self.assertEqual(self.missing("metal", 2), [])

    def test_run_stops_before_decoding_and_names_the_files(self):
        decoded = []
        with mock.patch.object(tm, "choose_engine", lambda requested: ("cpu", None)), \
                mock.patch.object(tm, "read_meeting", lambda p: ({}, "")), \
                mock.patch.object(tm, "missing_models", lambda engine, n: [self.seg]), \
                mock.patch.object(tm, "decode_audio", lambda src, dst: decoded.append(src)):
            with self.assertRaises(SystemExit) as cm:
                tm.run("/w/x.meeting-recording.md", "/w/clip.m4a", "2026-08-30", num_speakers=2)
        self.assertIn(self.seg, str(cm.exception.code))
        self.assertIn("setup", str(cm.exception.code))
        self.assertEqual(decoded, [], "the run decoded audio before finding its models missing")


class VenvBesideTheSkillSaysSo(unittest.TestCase):
    """Without the SKILL.md export uv builds a `.venv` beside the skill; it runs, with a note."""

    def test_a_venv_inside_the_skill_prints_how_to_move_it(self):
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            self.assertTrue(tm.warn_if_venv_in_skill(str(SKILL / ".venv")))
        self.assertIn("UV_PROJECT_ENVIRONMENT", err.getvalue())
        self.assertIn("TRANSCRIPTION_HOME", err.getvalue())

    def test_a_venv_in_the_cache_is_silent(self):
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            self.assertFalse(tm.warn_if_venv_in_skill("/home/dana/.cache/dreamteamer/transcription/venv"))
        self.assertEqual(err.getvalue(), "")


if __name__ == "__main__":
    unittest.main()
