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
            "choose_engine": lambda requested: "cpu",
            "read_meeting": lambda p: ({}, ""),
            "write_meeting": lambda p, fm, body: None,
            "diarize_safe": lambda wav, num_speakers=None: [],
            "transcribe": self.fake_transcribe,
            "asr_cache_path_for": lambda p: self.asr_json,
        }.items():
            p = mock.patch.object(tm, name, value)
            p.start()
            self.addCleanup(p.stop)

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



class OldLayoutStillRunsAndSaysSo(unittest.TestCase):
    """A `.venv` inside the skill folder (the layout before 0.2.1) is used as it is — with a note."""

    def test_a_venv_inside_the_skill_prints_how_to_move_it(self):
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            self.assertTrue(tm.warn_if_venv_in_skill(str(SKILL / ".venv")))
        self.assertIn("UV_PROJECT_ENVIRONMENT", err.getvalue())
        self.assertIn("TRANSCRIBING_VENV_DIR", err.getvalue())

    def test_a_venv_in_the_cache_is_silent(self):
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            self.assertFalse(tm.warn_if_venv_in_skill("/home/dana/.cache/dreamteamer/transcription-venv"))
        self.assertEqual(err.getvalue(), "")


if __name__ == "__main__":
    unittest.main()
