"""Tier 2 (cr-modules-019 task 13, design section 16): synthetic voices end to end, through the real models.

Dialogues between macOS `say` voices — invented English, made at test time into a temp folder and deleted
after — go through the real `run` (ffmpeg, the sherpa-onnx diariser, Whisper, the speaker model) and the
real `identify`, `--question`, `--shown` and `--answer`, as a user's first recordings would:

1. the first recording (Dana Oren and Sam Diaz, the meeting's people) asks about both voices; the answer
   stores two voice prints;
2. the second recording proposes both from the prints; the answer confirms them;
3. after that second confirmed recording both prints are trusted, so a third recording has both written,
   provisional, with origin `print`; a third `say` voice in it (nobody the meeting invited) is asked about
   and never named by the machine.

This proves the plumbing and the experience of design section 6, nothing about accuracy (that is the
developer's calibration). It runs only where `say` and its voices, `ffmpeg`, the diariser's models, both
registered speaker models, the Whisper weights and the transcription venv's packages are present;
anywhere else every case is SKIPPED, naming the missing piece, never passed.

Read-only towards the machine: the real models folder (`$TRANSCRIPTION_HOME/models`, default
`~/.cache/dreamteamer/transcription/models`) is reached through a symlink from a temp TRANSCRIPTION_HOME,
so the ASR cache, the decoded audio, the records and the voice-print store (VOICE_PRINTS_HOME) are all
temp folders; nothing is downloaded (HF_HUB_OFFLINE). The calibration is a fixture this test writes into
its own copy of the skill (the `Line17` way), so no shipped calibration file is ever read. The store's
backup exclusion is a fake (ruling D14): the verbs run through a two-line driver that replaces
`store.default_exclude_backup`.

Run it from the venv:
    cd modules/recordings/test/transcribing-recordings && \
    UV_PROJECT_ENVIRONMENT="${TRANSCRIPTION_HOME:-$HOME/.cache/dreamteamer/transcription}/venv" \
    uv run --project ../../skills/transcribing-recordings python -B -m unittest -v test_vp_e2e
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import random
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
import wave
from pathlib import Path

HERE = Path(__file__).resolve().parent
SKILL = HERE.parents[1] / "skills" / "transcribing-recordings"
sys.path.insert(0, str(SKILL))

import locations  # noqa: E402  (standard library only)
from voiceprints import models  # noqa: E402  (standard library only)

# The synthetic cast and the macOS voices that speak for them: a female and a male system voice for the
# meeting's two people, and a third, unlike both, for the voice nobody invited (decision D35).
VOICES = {"dana": "Samantha", "sam": "Daniel", "stranger": "Albert"}
DANA_REF, SAM_REF = "users/dana-oren", "contacts/sam-diaz"
PEOPLE = {"dana": (DANA_REF, "Dana Oren"), "sam": (SAM_REF, "Sam Diaz")}
WS = "northwind-hq"
RATE = 16000
GAP = 0.7          # seconds of silence between turns

THRESHOLDS = {"accept": 0.80, "accept_open": 0.85, "margin": 0.10, "same": 0.75, "split": 0.55, "suggest": 0.65}
PY_MODULES = ("numpy", "soundfile", "sherpa_onnx", "yaml")

# -- invented dialogue --------------------------------------------------------------------------------------
_OPEN = ["Let us", "I think we should", "Can we", "We could", "I would like to", "Maybe we can", "We need to"]
_DO = ["move the review of the grantee portal", "close the open notes on the Northwind budget",
       "check the numbers for the Harbor Mutual pilot", "send the updated plan to the finance team",
       "write down the steps for the next release", "book a short call about the onboarding screens",
       "look again at the risks on the reporting page", "finish the draft of the support guide"]
_WHEN = ["before Thursday", "by the end of the week", "after the board meeting", "early next month",
         "once the testing is done", "tomorrow morning", "before the holidays", "in the next sprint"]
_WHY = ["because the client asked for it twice", "so nobody waits on us", "since the data is finally ready",
        "and keep the scope small", "so the team can plan around it", "while the details are still fresh"]


def dialogue(seed, cast, turns_each, sentences=3):
    """`turns_each` turns for every voice in `cast`, taking turns in order; each turn `sentences` invented
    sentences, seeded so the audio is the same on every run."""
    rnd = random.Random(seed)
    out = []
    for _ in range(turns_each):
        for who in cast:
            text = " ".join(f"{rnd.choice(_OPEN)} {rnd.choice(_DO)} {rnd.choice(_WHEN)}, {rnd.choice(_WHY)}."
                            for _ in range(sentences))
            out.append((who, text))
    return out


def say_voices():
    """The names `say -v ?` lists, or None when `say` cannot run."""
    try:
        p = subprocess.run(["say", "-v", "?"], capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.SubprocessError):
        return None
    if p.returncode != 0:
        return None
    names = set()
    for line in p.stdout.splitlines():
        head = line.split("#", 1)[0].rstrip()
        # "<name>   <locale>": the locale is the last word; a name may hold spaces
        parts = head.rsplit(None, 1)
        if len(parts) == 2:
            names.add(parts[0].strip())
    return names


def real_models_dir():
    return locations.models_dir()


def whisper_ready(mdir):
    """The weights the transcriber's `auto` engine would use: the ggml file with whisper-cli on PATH, or the
    faster-whisper ct2 weights."""
    ggml = os.path.join(mdir, "whisper-ggml")
    has_ggml = os.path.isdir(ggml) and any(n.endswith(".bin") for n in os.listdir(ggml))
    if has_ggml and shutil.which("whisper-cli"):
        return True
    for _, _, files in os.walk(os.path.join(mdir, "whisper-ct2")):
        if "model.bin" in files:
            return True
    return False


def missing_pieces():
    """Every piece Tier 2 needs and this machine lacks, each named."""
    out = []
    if not shutil.which("say"):
        out.append("`say` (macOS text to speech)")
    else:
        have = say_voices()
        if have is None:
            out.append("`say -v ?` (macOS text to speech)")
        else:
            out += [f"the `say` voice {v}" for v in VOICES.values() if v not in have]
    if not shutil.which("ffmpeg"):
        out.append("`ffmpeg`")
    for m in PY_MODULES:
        if importlib.util.find_spec(m) is None:
            out.append(f"the Python package {m} (run it from the transcription venv: `uv run`)")
    mdir = real_models_dir()
    for f in ("segmentation.onnx", "embedding.onnx"):
        p = os.path.join(mdir, "diarization", f)
        if not (os.path.isfile(p) and os.path.getsize(p) > 0):
            out.append(f"the diariser's {f} (`setup`)")
    for mid in sorted(models.MODELS):
        if not models.ready(mid, mdir):
            out.append(f"the speaker model {mid} (`setup --speaker-models all`)")
    if not whisper_ready(mdir):
        out.append("the Whisper weights (`setup`)")
    return out


def snapshot(folder):
    """{relative path: (size, mtime_ns)} of every file under `folder` (links not followed)."""
    out = {}
    if not os.path.isdir(folder):
        return out
    for root, dirs, files in os.walk(folder):
        for n in files:
            p = os.path.join(root, n)
            try:
                st = os.lstat(p)
            except OSError:
                continue
            out[os.path.relpath(p, folder)] = (st.st_size, st.st_mtime_ns)
    return out


def numbers_in_a_list(obj):
    """True when `obj` holds a list with a number in it: a vector never goes in a record."""
    if isinstance(obj, dict):
        return any(numbers_in_a_list(v) for v in obj.values())
    if isinstance(obj, (list, tuple)):
        return any(isinstance(v, (int, float)) and not isinstance(v, bool) for v in obj) or \
            any(numbers_in_a_list(v) for v in obj)
    return False


# The verbs run in a child through this driver: the store's backup exclusion replaced by a fake that
# only notes the call (ruling D14), then transcribe_meeting.py as __main__.
DRIVER = """\
import os, runpy, sys
skill = os.environ["E2E_SKILL"]
sys.path.insert(0, skill)
from voiceprints import store
def _fake_exclude(home):
    with open(os.environ["E2E_EXCLUDED"], "a", encoding="utf-8") as f:
        f.write(home + "\\n")
store.default_exclude_backup = lambda platform=None: _fake_exclude
script = os.path.join(skill, "transcribe_meeting.py")
sys.argv = [script] + sys.argv[1:]
runpy.run_path(script, run_name="__main__")
"""


class Walk(unittest.TestCase):
    """Design section 16, Tier 2: a user's first recordings, through the real models. The steps run in
    order and share the walk; a step whose predecessor failed fails saying so."""

    @classmethod
    def setUpClass(cls):
        gone = missing_pieces()
        cls.missing = ("Tier 2 needs " + "; ".join(gone)) if gone else None
        if gone:
            return      # every case is skipped in setUp, each naming what is missing
        cls.t0 = time.monotonic()
        cls._td = tempfile.TemporaryDirectory(prefix="vp-e2e-")
        cls.root = Path(os.path.realpath(cls._td.name))
        cls.real_models = real_models_dir()
        cls.real_home = locations.transcription_home()
        cls.before = {"asr": snapshot(os.path.join(cls.real_home, "asr")), "models": snapshot(cls.real_models)}
        # a temp TRANSCRIPTION_HOME whose models are the real ones, read through a link
        th = cls.root / "transcription"
        th.mkdir()
        os.symlink(cls.real_models, th / "models")
        # the skill, copied, with the calibration fixture in it and no other calibration file
        cls.skill = cls.root / "skill"
        shutil.copytree(str(SKILL), str(cls.skill),
                        ignore=shutil.ignore_patterns("__pycache__", ".venv", "calibration", "uv.lock"))
        e = models.entry(models.DEFAULT_MODEL)
        cls.model = e
        (cls.skill / "calibration").mkdir()
        (cls.skill / "calibration" / f"{e['id']}.json").write_text(json.dumps({
            "version": 1, "model": {"id": e["id"], "sha256": e["sha256"], "dim": e["dim"]},
            "thresholds": THRESHOLDS, "print_closed": "auto", "print_open": "auto", "elimination": "propose",
            "split_weak": False, "counts": {"recordings": 3, "people": 3, "genuine": 2, "impostor": 4,
                                            "written": 2, "wrong": 0},
            "bound": 0.25, "generated": "2026-11-16"}), encoding="utf-8")
        cls.driver = cls.root / "driver.py"
        cls.driver.write_text(DRIVER, encoding="utf-8")
        for d in ("home", "tmp", "audio", "ctx"):     # the store's folder is the store's to make
            (cls.root / d).mkdir()
        cls.ws = cls.root / "ws"
        cls.env = dict(os.environ)
        cls.env.update({
            "TRANSCRIPTION_HOME": str(th), "VOICE_PRINTS_HOME": str(cls.root / "vp"),
            "HOME": str(cls.root / "home"), "USERPROFILE": str(cls.root / "home"),
            "TMPDIR": str(cls.root / "tmp"), "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1",
            "PYTHONDONTWRITEBYTECODE": "1", "E2E_SKILL": str(cls.skill),
            "E2E_EXCLUDED": str(cls.root / "excluded.txt")})
        cls.env.pop("XDG_DATA_HOME", None)
        cls.done = set()
        cls.recs = {}
        cls.timings = {}

    @classmethod
    def tearDownClass(cls):
        td = getattr(cls, "_td", None)
        if td is not None:
            td.cleanup()
            if hasattr(cls, "t0"):
                print(f"\n  Tier 2 walk: {time.monotonic() - cls.t0:.0f} s; "
                      + ", ".join(f"{k} {v:.0f} s" for k, v in cls.timings.items()), file=sys.stderr)

    def setUp(self):
        if self.missing:
            self.skipTest(self.missing)

    # -- the pieces -----------------------------------------------------------------------------------
    def need(self, *steps):
        for s in steps:
            if s not in self.done:
                self.fail(f"step {s} did not complete, so this step cannot run")

    def speak(self, name, lines):
        """The dialogue as one 16 kHz mono WAV in the temp audio folder, and each turn's (who, start, end)."""
        folder = self.root / "audio" / name
        folder.mkdir()
        frames, turns, t = [], [], 0.0
        silence = b"\x00\x00" * int(GAP * RATE)
        for i, (who, text) in enumerate(lines):
            part = folder / f"turn-{i:02d}.wav"
            p = subprocess.run(["say", "-v", VOICES[who], "--file-format=WAVE", f"--data-format=LEI16@{RATE}",
                                "-o", str(part), text], capture_output=True, text=True, timeout=300)
            self.assertEqual(p.returncode, 0, p.stderr)
            with wave.open(str(part), "rb") as w:
                self.assertEqual((w.getnchannels(), w.getsampwidth(), w.getframerate()), (1, 2, RATE))
                data = w.readframes(w.getnframes())
            dur = len(data) / 2 / RATE
            turns.append((who, t, t + dur))
            frames += [data, silence]
            t += dur + GAP
            part.unlink()
        out = folder / f"{name}.wav"
        with wave.open(str(out), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(RATE)
            w.writeframes(silence + b"".join(frames))
        turns = [(who, s + GAP, e + GAP) for who, s, e in turns]
        return out, turns

    def record(self, name, lines, cast_attendees):
        """A meeting-recordings record in the temp workspace for the dialogue, and its voice context (the
        shape lib/voice-context.mjs writes)."""
        audio, turns = self.speak(name, lines)
        sha = hashlib.sha256(audio.read_bytes()).hexdigest()
        ref = f"meeting-recordings/2026/11/2026-11-2{len(self.recs)}--{name}"
        path = self.ws / "data" / f"{ref}.meeting-recording.md"
        path.parent.mkdir(parents=True, exist_ok=True)
        fm = {"name": f"Northwind {name}", "date": f"2026-11-2{len(self.recs)}", "fingerprint": "sha256:" + sha,
              "meeting": f"meetings/2026/11/2026-11-2{len(self.recs)}--{name}"}
        path.write_text("---\n" + json.dumps(fm, indent=2) + "\n---\n\n# " + name + "\n", encoding="utf-8")
        cands = []
        for who in cast_attendees:
            ref_, nm = PEOPLE[who]
            c = {"person": ref_, "name": nm, "kind": "user" if ref_.startswith("users/") else "contact"}
            if who == "dana":
                c["you"] = True
            cands.append(c)
        ctx = {"workspace": WS, "guard": {"workspace": str(self.ws), "files_folder": None, "inbox_folders": []},
               "known": {r: n for r, n in PEOPLE.values()},
               "workspace_users": [{"person": DANA_REF, "name": "Dana Oren"}],
               "record": ref, "record_path": str(path), "audio": str(audio), "fingerprint": "sha256:" + sha,
               "meeting": {"ref": fm["meeting"], "name": fm["name"], "date": fm["date"], "location": None},
               "candidates": cands, "attendee_count": len(cands), "attendee_count_certain": True,
               "documents": []}
        cf = self.root / "ctx" / f"{name}.json"
        cf.write_text(json.dumps(ctx), encoding="utf-8")
        rec = {"name": name, "path": path, "ref": ref, "audio": audio, "turns": turns, "ctx": cf, "sha": sha}
        self.recs[name] = rec
        return rec

    def verb(self, *args, ok=True):
        t = time.monotonic()
        p = subprocess.run([sys.executable, "-B", str(self.driver), *[str(a) for a in args]], env=self.env,
                           cwd=str(self.root), capture_output=True, text=True, timeout=1800)
        self.timings[args[0]] = self.timings.get(args[0], 0.0) + time.monotonic() - t
        if ok:
            self.assertEqual(p.returncode, 0, f"{args[:2]} exited {p.returncode}\n{p.stdout[-2000:]}\n{p.stderr[-3000:]}")
        return p

    def last_json(self, text):
        for line in reversed([x for x in text.splitlines() if x.strip()]):
            try:
                return json.loads(line)
            except ValueError:
                continue
        self.fail(f"no JSON in the output:\n{text[-2000:]}")

    def transcribe(self, rec, speakers):
        p = self.verb("run", rec["path"], rec["audio"], "--date", "2026-11-20", "--speakers", speakers,
                      "--engine", "auto", "--context", rec["ctx"])
        summary = self.last_json(p.stdout)
        self.assertTrue(str(summary.get("signatures", "")).startswith(f"kept — {self.model['id']}"),
                        f"the signature was not kept: {summary.get('signatures')}\n{p.stderr[-2000:]}")
        rec["labels"] = self.labels_to_voices(rec)
        return summary

    def labels_to_voices(self, rec):
        """Each diarised label → the synthetic voice whose turns it overlaps most, from the temp ASR cache's
        segments. The diariser must have told the voices apart for the walk to mean anything."""
        cache = Path(self.env["TRANSCRIPTION_HOME"]) / "asr" / (rec["path"].name.replace(".meeting-recording.md", "")
                                                                + ".asr.json")
        segs = json.loads(cache.read_text(encoding="utf-8"))["segments"]
        over = {}
        for s in segs:
            for who, a, b in rec["turns"]:
                o = max(0.0, min(b, s["end"]) - max(a, s["start"]))
                if o:
                    over.setdefault(s["speaker"], {}).setdefault(who, 0.0)
                    over[s["speaker"]][who] += o
        out = {}
        for label, by in over.items():
            who = max(by, key=by.get)
            purity = by[who] / sum(by.values())
            if by[who] < 5.0:
                continue      # a sliver label: not a voice of the dialogue
            self.assertGreaterEqual(purity, 0.8, f"label {label} mixes the voices: {by}")
            self.assertNotIn(who, out.values(), f"two labels for one voice: {over}")
            out[label] = who
        voices = sorted({w for w, _, _ in rec["turns"]})
        self.assertEqual(sorted(out.values()), voices, f"the diariser did not find every voice: {over}")
        return {who: label for label, who in out.items()}

    def fm(self, rec):
        text = rec["path"].read_text(encoding="utf-8")
        close = text.index("\n---", 4)
        import yaml
        return yaml.safe_load(text[4:close]) or {}

    def t(self, rec):
        return self.fm(rec)["transcription"]

    def identify(self, rec):
        p = self.verb("identify", rec["path"], "--context", rec["ctx"])
        return self.last_json(p.stdout)["records"][0]

    def question(self, rec):
        p = self.verb("identify", "--question", rec["path"], "--context", rec["ctx"])
        return self.last_json(p.stdout) if p.stdout.strip() else None

    def shown(self, rec):
        self.verb("identify", "--shown", rec["path"], "--context", rec["ctx"])

    def answer(self, rec, pairs):
        p = self.verb("identify", "--answer", rec["path"], *[f"{l}={a}" for l, a in pairs], "--context", rec["ctx"])
        return self.last_json(p.stdout)

    def prints(self):
        """{person reference: print} of this workspace in the active model's folder of the temp store."""
        folder = self.root / "vp" / self.model["id"] / "prints"
        out = {}
        for f in sorted(folder.glob("*.json")) if folder.is_dir() else []:
            p = json.loads(f.read_text(encoding="utf-8"))
            for k in p.get("known_as") or []:
                if k.get("workspace") == WS:
                    out[k["person"]] = p
        return out

    def asked(self, msg, rec):
        rows = [r for r in (msg or {}).get("records") or [] if r.get("record") == rec["ref"]]
        self.assertEqual(len(rows), 1, msg)
        return {x["label"]: x for x in rows[0]["labels"]}

    def no_vector_in(self, rec):
        self.assertFalse(numbers_in_a_list(self.fm(rec)), "a record holds a numeric array")

    # -- the walk -------------------------------------------------------------------------------------
    def test_1_the_first_recording_asks_and_stores_two_prints(self):
        rec = self.record("first", dialogue("e2e-first", ["dana", "sam"], 6), ["dana", "sam"])
        self.transcribe(rec, 2)
        t = self.t(rec)
        self.assertEqual(t["speakers"], {}, "transcribing writes no name")
        r = self.identify(rec)
        t = self.t(rec)
        self.assertEqual(t["speakers"], {}, f"no print yet, so no name: {r}")
        self.assertEqual(self.fm(rec).get("speaker_naming"), "waiting")
        msg = self.question(rec)
        asked = self.asked(msg, rec)
        d, s = rec["labels"]["dana"], rec["labels"]["sam"]
        for label in (d, s):
            self.assertEqual(asked[label]["kind"], "ask", asked)
            self.assertEqual(len(asked[label]["quotes"]), 2, asked[label])
            texts = " ".join(c["text"] for c in asked[label]["choices"])
            self.assertIn("Dana Oren", texts)
            self.assertIn("Sam Diaz", texts)
        self.shown(rec)
        out = self.answer(rec, [(d, DANA_REF), (s, SAM_REF)])
        t = self.t(rec)
        self.assertEqual(t["speakers"], {d: "Dana Oren", s: "Sam Diaz"}, out)
        self.assertEqual({t["speaker_sources"][l]["status"] for l in (d, s)}, {"confirmed"})
        prints = self.prints()
        self.assertEqual(sorted(prints), sorted([DANA_REF, SAM_REF]), out)
        for ref in (DANA_REF, SAM_REF):
            srcs = prints[ref]["sources"]
            self.assertEqual([x["status"] for x in srcs], ["admitted"], (ref, srcs, out))
            self.assertNotEqual(prints[ref]["trust"], "trusted", "one recording does not make a print trusted")
        self.no_vector_in(rec)
        self.done.add(1)

    def test_2_the_second_recording_proposes(self):
        self.need(1)
        rec = self.record("second", dialogue("e2e-second", ["sam", "dana"], 6), ["dana", "sam"])
        self.transcribe(rec, 2)
        r = self.identify(rec)
        t = self.t(rec)
        self.assertEqual(t["speakers"], {}, f"a print not yet trusted proposes, it never writes: {r}")
        d, s = rec["labels"]["dana"], rec["labels"]["sam"]
        qs = t["speaker_questions"]
        for label, ref in ((d, DANA_REF), (s, SAM_REF)):
            self.assertEqual(qs[label]["proposed"]["person"], ref, (label, qs[label], r))
            self.assertEqual(qs[label]["proposed"]["origin"], "print", qs[label])
        msg = self.question(rec)
        asked = self.asked(msg, rec)
        for label, nm in ((d, "Dana Oren"), (s, "Sam Diaz")):
            self.assertEqual(len(asked[label]["quotes"]), 2, asked[label])
            self.assertIn(nm, asked[label]["choices"][0]["text"], "the proposal is the first choice")
        self.shown(rec)
        out = self.answer(rec, [(d, DANA_REF), (s, SAM_REF)])
        prints = self.prints()
        for ref in (DANA_REF, SAM_REF):
            p = prints[ref]
            self.assertEqual([x["status"] for x in p["sources"]], ["admitted", "admitted"], (ref, p["sources"], out))
            self.assertEqual(p["trust"], "trusted", (ref, p.get("trust"), out))
        self.no_vector_in(rec)
        self.done.add(2)

    def test_3_both_written_provisional_and_a_third_voice_asked_never_named(self):
        self.need(1, 2)
        rec = self.record("third", dialogue("e2e-third", ["dana", "stranger", "sam"], 4), ["dana", "sam"])
        self.transcribe(rec, 3)
        r = self.identify(rec)
        t = self.t(rec)
        d, s, x = rec["labels"]["dana"], rec["labels"]["sam"], rec["labels"]["stranger"]
        self.assertEqual(t["speakers"], {d: "Dana Oren", s: "Sam Diaz"}, r)
        for label, ref in ((d, DANA_REF), (s, SAM_REF)):
            src = t["speaker_sources"][label]
            self.assertEqual((src["person"], src["origin"], src["status"]), (ref, "print", "provisional"), src)
        print("\n  written from prints: " + ", ".join(f"{t['speaker_sources'][l]['name']} {t['speaker_sources'][l].get('score')}"
                                                   for l in (d, s)), file=sys.stderr)
        self.assertNotIn(x, t["speakers"])
        self.assertNotIn(x, t.get("speaker_sources") or {})
        msg = self.question(rec)
        asked = self.asked(msg, rec)
        self.assertEqual(asked[x]["kind"], "ask", asked)
        self.assertEqual(len(asked[x]["quotes"]), 2, asked[x])
        self.assertEqual({asked[d]["kind"], asked[s]["kind"]}, {"unconfirmed"}, asked)
        self.shown(rec)
        # the unknown voice is nobody the workspace knows: the person says so, and the machine still never names it
        self.answer(rec, [(x, "nobody")])
        self.identify(rec)
        t = self.t(rec)
        self.assertNotIn(x, t["speakers"])
        self.assertEqual(sorted(self.prints()), sorted([DANA_REF, SAM_REF]), "no print for the unknown voice")
        self.no_vector_in(rec)
        self.done.add(3)

    def test_4_the_machine_was_used_read_only(self):
        self.need(1, 2, 3)
        self.assertEqual(snapshot(os.path.join(self.real_home, "asr")), self.before["asr"],
                         "the real ASR cache was written")
        self.assertEqual(snapshot(self.real_models), self.before["models"], "the real models folder changed")
        self.assertTrue(list((Path(self.env["TRANSCRIPTION_HOME"]) / "asr").glob("*.asr.json")),
                        "the ASR cache went to the temp TRANSCRIPTION_HOME")
        excluded = (self.root / "excluded.txt").read_text(encoding="utf-8").split()
        self.assertEqual([os.path.realpath(x) for x in excluded], [str(self.root / "vp")],
                         "the fake backup exclusion ran once, on the temp store")
        self.assertEqual(os.stat(self.root / "vp").st_mode & 0o777, 0o700)


if __name__ == "__main__":
    unittest.main()
