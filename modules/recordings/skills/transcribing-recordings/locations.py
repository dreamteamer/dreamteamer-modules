"""Where the skill keeps what must NOT sit beside it: the models, the Python environment and the raw ASR cache.

The skill is installed into node_modules (and compiled into .dreamteamer/skills/), so a folder kept
beside it is deleted by the next `npm install` — the venv went with every pin bump and transcription
was unavailable until someone re-ran `uv sync` — and the raw ASR JSON of a real call sat inside a
package folder. All three live in a per-machine cache:

  TRANSCRIBING_MODELS_DIR  default ~/.cache/dreamteamer/transcription-models  (~1.6 GB, 3.2 GB with metal)
  TRANSCRIBING_VENV_DIR    default ~/.cache/dreamteamer/transcription-venv
  TRANSCRIBING_CACHE_DIR   default ~/.cache/dreamteamer/transcription-cache  (raw ASR JSON in asr/)

uv chooses the environment BEFORE Python starts, so nothing in this script can move the venv: the
SKILL.md preamble exports `UV_PROJECT_ENVIRONMENT` from TRANSCRIBING_VENV_DIR with this same default,
and test_locations.py holds the two to each other. `venv_dir` is here for the warning `setup` and `run`
print when they find themselves in a venv inside the skill folder — the old layout, which still works.

Standard library only.
"""
import os

CACHE_HOME = os.path.join(".cache", "dreamteamer")
MODELS_NAME = "transcription-models"
VENV_NAME = "transcription-venv"
CACHE_NAME = "transcription-cache"


def _home(env):
    return env.get("HOME") or os.path.expanduser("~")


def _resolve(value, env):
    """An env value as an absolute path: `~` expands, and a relative path is made absolute rather than
    left to land wherever the process happens to run — which is the skill folder."""
    if value == "~" or value.startswith("~/"):
        value = os.path.join(_home(env), value[2:])
    return os.path.abspath(value)


def models_dir(env=None):
    """The weights. Until recordings 0.2.2 the default was `.models/` beside the skill, which every
    `npm install` deleted, and every workspace had to set the variable to keep 1.6 GB from coming back;
    a session that missed the export ran without the GPU weights and never knew."""
    env = os.environ if env is None else env
    value = env.get("TRANSCRIBING_MODELS_DIR")
    return _resolve(value, env) if value else os.path.join(_home(env), CACHE_HOME, MODELS_NAME)


def venv_dir(env=None):
    env = os.environ if env is None else env
    value = env.get("TRANSCRIBING_VENV_DIR")
    return _resolve(value, env) if value else os.path.join(_home(env), CACHE_HOME, VENV_NAME)


def cache_dir(env=None):
    env = os.environ if env is None else env
    value = env.get("TRANSCRIBING_CACHE_DIR")
    return _resolve(value, env) if value else os.path.join(_home(env), CACHE_HOME, CACHE_NAME)


def asr_cache_dir(env=None):
    return os.path.join(cache_dir(env), "asr")


def inside(path, folder):
    """True when `path` is `folder` or anything under it — symlinks resolved, because the skill is
    reached through `.dreamteamer/skills/`, which links into node_modules."""
    path, folder = os.path.realpath(path), os.path.realpath(folder)
    return path == folder or path.startswith(folder.rstrip(os.sep) + os.sep)
