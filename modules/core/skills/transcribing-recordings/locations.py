"""Where the transcriber keeps everything that is not the skill itself: ONE folder per machine.

  $TRANSCRIPTION_HOME            default ~/.cache/dreamteamer/transcription
    models/
      diarization/               segmentation.onnx, embedding.onnx — every audio run
      whisper-ct2/               faster-whisper weights — the cpu engine
      whisper-ggml/              whisper.cpp weights — the metal engine
    venv/                        the Python environment
    asr/                         the raw recognizer output of each run

The skill is installed into node_modules (and compiled into .dreamteamer/skills/), so anything kept
beside it is deleted by the next `npm install`. One folder outside it, under one variable, is the
whole footprint: copy `models/` to bring a machine up, delete the folder to uninstall.

uv chooses the environment BEFORE Python starts, so nothing in this script can move the venv: the
SKILL.md preamble exports `UV_PROJECT_ENVIRONMENT` as `$TRANSCRIPTION_HOME/venv` with this same
default, and test_locations.py holds the two to each other.

Standard library only.
"""
import os

DEFAULT_HOME = os.path.join(".cache", "dreamteamer", "transcription")


def _home_dir(env):
    return env.get("HOME") or os.path.expanduser("~")


def _resolve(value, env):
    """An env value as an absolute path: `~` expands, and a relative path is made absolute rather than
    left to land wherever the process happens to run — which is the skill folder."""
    if value == "~" or value.startswith("~/"):
        value = os.path.join(_home_dir(env), value[2:])
    return os.path.abspath(value)


def transcription_home(env=None):
    env = os.environ if env is None else env
    value = env.get("TRANSCRIPTION_HOME")
    return _resolve(value, env) if value else os.path.join(_home_dir(env), DEFAULT_HOME)


def models_dir(env=None):
    return os.path.join(transcription_home(env), "models")


def diarization_dir(env=None):
    return os.path.join(models_dir(env), "diarization")


def whisper_ct2_dir(env=None):
    return os.path.join(models_dir(env), "whisper-ct2")


def venv_dir(env=None):
    return os.path.join(transcription_home(env), "venv")


def asr_cache_dir(env=None):
    return os.path.join(transcription_home(env), "asr")


def inside(path, folder):
    """True when `path` is `folder` or anything under it — symlinks resolved, because the skill is
    reached through `.dreamteamer/skills/`, which links into node_modules."""
    path, folder = os.path.realpath(path), os.path.realpath(folder)
    return path == folder or path.startswith(folder.rstrip(os.sep) + os.sep)
