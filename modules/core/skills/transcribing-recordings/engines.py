"""Which recognizer runs, and the GPU pass's own plumbing: whisper.cpp (`whisper-cli`) on Metal.

Standard library only, so engine selection, the whisper.cpp output parser and the verified download
are testable without the venv, the weights or a GPU.

Two engines, one set of weights. `cpu` is faster-whisper on CTranslate2 with the ivrit turbo weights
in int8 — CTranslate2 has no Metal backend, so on Apple Silicon it never leaves the CPU. `metal` is
whisper.cpp with the SAME ivrit fine-tune converted to ggml, which runs on the Apple GPU. `auto`
(the default) picks `metal` only where it is genuinely faster: Apple Silicon, `whisper-cli` on PATH
and the ggml file present. whisper.cpp on a CPU is slower than CTranslate2 on the same CPU (measured
on an M3: more than 580 s for a 12:47 recording, against an RTF of ~0.69 for faster-whisper), so a
Linux machine that happens to have `whisper-cli` keeps the CPU pass.
"""
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request

ENGINES = ("auto", "metal", "cpu")

# The ivrit-ai turbo fine-tune in ggml, pinned to one upstream commit so a re-upload never changes
# the weights under a running workspace. The size and sha256 are that commit's LFS object.
GGML_REPO = "ivrit-ai/whisper-large-v3-turbo-ggml"
GGML_REVISION = "2130c78e4a9cb4914cc4df91a1c3031407789705"
GGML_REMOTE_FILE = "ggml-model.bin"
GGML_SUBDIR = "whisper-ggml"
GGML_FILE = "ggml-ivrit-large-v3-turbo.bin"
GGML_SIZE = 1_624_555_275
GGML_SHA256 = "c8090411113357097bfafc2b8e228ec1639fa7f5fe4ecb5d054ac0ccef8641b1"

LABELS = {
    "cpu": "faster-whisper · ivrit-ai/whisper-large-v3-turbo-ct2 (int8)",
    "metal": f"whisper.cpp · {GGML_REPO}@{GGML_REVISION[:8]} (metal)",
}


class EngineUnavailable(Exception):
    """An engine was asked for by name and this machine cannot run it."""


def ggml_path(models_dir):
    return os.path.join(models_dir, GGML_SUBDIR, GGML_FILE)


def ggml_url():
    return f"https://huggingface.co/{GGML_REPO}/resolve/{GGML_REVISION}/{GGML_REMOTE_FILE}"


def ggml_ready(models_dir):
    """The weights are there AND whole — a half-copied or cloud-evicted file exists at the wrong size."""
    p = ggml_path(models_dir)
    return os.path.isfile(p) and os.path.getsize(p) == GGML_SIZE


def apple_silicon(system=None, machine=None):
    return (system or platform.system()) == "Darwin" and (machine or platform.machine()) == "arm64"


def find_whisper_cli():
    return shutil.which("whisper-cli")


def _metal_missing(whisper_cli, ggml_present, apple_gpu):
    missing = []
    if not apple_gpu:
        missing.append("an Apple Silicon GPU (Metal)")
    if not whisper_cli:
        missing.append("whisper-cli on PATH (macOS: brew install whisper-cpp)")
    if not ggml_present:
        missing.append(f"the ggml weights ({GGML_SUBDIR}/{GGML_FILE}; `transcribe_meeting.py setup` fetches them)")
    return missing


def select_engine_why(requested, *, whisper_cli, ggml_present, apple_gpu):
    """(engine, fallback) — the engine a run uses, and why `auto` did not get the GPU.

    `fallback` is None unless `auto` ended on the CPU; then it is the one line a run prints and records,
    so a slow transcription is never a silent one. Off Apple Silicon it says only that this machine has
    no GPU engine — whisper-cli or the weights would not change that.
    """
    if requested not in ENGINES:
        raise ValueError(f"--engine takes {' | '.join(ENGINES)}, got {requested!r}")
    if requested == "cpu":
        return "cpu", None
    missing = _metal_missing(whisper_cli, ggml_present, apple_gpu)
    if not missing:
        return "metal", None
    if requested == "metal":
        raise EngineUnavailable("--engine metal needs " + ", ".join(missing))
    if not apple_gpu:
        return "cpu", "no GPU engine on this machine (metal needs Apple Silicon)"
    return "cpu", "metal unavailable — needs " + ", ".join(missing)


def select_engine(requested, *, whisper_cli, ggml_present, apple_gpu):
    """The engine a run uses. `requested` is auto | metal | cpu.

    `auto` is metal when all three hold and cpu otherwise — never an error, so a machine without the
    binary transcribes exactly as before. `metal` asked for by name refuses rather than silently
    running the slow path, naming what is missing.
    """
    return select_engine_why(requested, whisper_cli=whisper_cli, ggml_present=ggml_present,
                             apple_gpu=apple_gpu)[0]


def parse_engine_arg(args, default="auto"):
    """`--engine X` from an argv list; the default when absent."""
    if "--engine" not in args:
        return default
    i = args.index("--engine")
    if i + 1 >= len(args):
        raise ValueError(f"--engine takes {' | '.join(ENGINES)}")
    value = args[i + 1]
    if value not in ENGINES:
        raise ValueError(f"--engine takes {' | '.join(ENGINES)}, got {value!r}")
    return value


# Directional formatting characters. whisper.cpp's Hebrew output carries them around punctuation and
# Latin runs; they are invisible in a viewer, break a grep, and faster-whisper never emits them.
_BIDI = re.compile("[\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]")
# whisper.cpp's own non-speech markers, emitted as a segment of their own: [BLANK_AUDIO], [MUSIC].
_MARKER = re.compile(r"^\s*\[[A-Z_ ]+\]\s*$")


def strip_bidi(text):
    return _BIDI.sub("", text)


def words_from_whisper_json(doc):
    """whisper.cpp's `-oj` output, run with `-ml 1 -sow`, as the words faster-whisper would have given.

    Each segment is then one word, timed by whisper.cpp's segment offsets (milliseconds). Word
    timing comes from the segments and not from token timestamps because whisper.cpp's DTW token
    timestamps do not work for this fine-tune — every one comes back -1.

    A segment whose text does not open with a space continues the previous word (a word longer than
    one split), so it is glued onto it and extends its end. Words keep the leading space, as
    faster-whisper's do — `align_words_to_speakers` concatenates them as they are.

    Returns {"words": [{start, end, text}], "language": <code or None>, "duration": seconds}.
    """
    words = []
    for seg in doc.get("transcription") or []:
        text = strip_bidi(seg.get("text") or "")
        if not text.strip() or _MARKER.match(text):
            continue
        off = seg.get("offsets") or {}
        start = (off.get("from") or 0) / 1000.0
        end = (off.get("to") or 0) / 1000.0
        if words and not text[:1].isspace():
            words[-1]["text"] += text.rstrip()
            words[-1]["end"] = max(words[-1]["end"], end)
            continue
        words.append({"start": start, "end": max(start, end), "text": " " + text.strip()})
    language = ((doc.get("result") or {}).get("language")) or None
    duration = max((w["end"] for w in words), default=0.0)
    return {"words": words, "language": language, "duration": duration}


def whisper_cli_args(cli, model, wav, out_base, language=None):
    """The one whisper-cli invocation the GPU pass makes.

    -ml 1 -sow   one segment per word: the word timing (see words_from_whisper_json)
    -mc 0        no previous text as the next window's prompt — the same choice as the CPU pass's
                 condition_on_previous_text=False, for the same reason: a call that opens in one
                 language otherwise drags every later window back into it
    -l auto      detect when the language is not forced
    """
    return [
        cli, "-m", model, "-f", wav,
        "-l", language or "auto",
        "-ml", "1", "-sow",
        "-mc", "0",
        "-oj", "-of", out_base,
        "-np",
    ]


def run_whisper_cli(cli, model, wav, language=None):
    """Run whisper-cli and return words_from_whisper_json's result. Raises SystemExit with the tool's
    own last lines when it fails."""
    tmp = tempfile.mkdtemp(prefix="whisper-cpp-")
    out_base = os.path.join(tmp, "asr")
    try:
        p = subprocess.run(whisper_cli_args(cli, model, wav, out_base, language), capture_output=True)
        if p.returncode != 0 or not os.path.exists(out_base + ".json"):
            tail = p.stderr.decode("utf-8", "replace").strip().splitlines()[-5:]
            raise SystemExit(f"✖ whisper-cli failed (exit {p.returncode}):\n  " + "\n  ".join(tail))
        with open(out_base + ".json", "rb") as f:
            # whisper.cpp writes the bytes it decoded; a token boundary inside a multi-byte character
            # must not abort a whole call, so an invalid byte becomes U+FFFD rather than an exception.
            doc = json.loads(f.read().decode("utf-8", "replace"))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return words_from_whisper_json(doc)


def download_verified(url, dst, size, sha256):
    """Download to `<dst>.part`, check the byte count and sha256, then move into place.

    Nothing lands at `dst` unless it is the exact file, so a dropped connection leaves no file that
    the size check would later have to catch.
    """
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    part = dst + ".part"
    print(f"  downloading {url} -> {dst}", file=sys.stderr)
    h = hashlib.sha256()
    got = 0
    try:
        with urllib.request.urlopen(url) as r, open(part, "wb") as f:
            while True:
                chunk = r.read(1 << 20)
                if not chunk:
                    break
                f.write(chunk)
                h.update(chunk)
                got += len(chunk)
    except BaseException:
        # A dropped connection or a ^C mid-download leaves no half file behind either.
        if os.path.exists(part):
            os.remove(part)
        raise
    if got != size or h.hexdigest() != sha256:
        os.remove(part)
        raise SystemExit(
            f"✖ {url}: got {got} bytes sha256 {h.hexdigest()}, expected {size} bytes sha256 {sha256}"
        )
    os.replace(part, dst)
