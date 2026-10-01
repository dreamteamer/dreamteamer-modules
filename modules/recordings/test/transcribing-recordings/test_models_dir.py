"""The model folder is beside the skill by default and moves wherever TRANSCRIBING_MODELS_DIR says —
the npm channel needs that, because `npm ci` wipes node_modules and would re-download 1.6 GB."""
import importlib
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.join(os.path.dirname(os.path.dirname(HERE)), "skills", "transcribing-recordings")


def _load(env_value):
    if env_value is None:
        os.environ.pop("TRANSCRIBING_MODELS_DIR", None)
    else:
        os.environ["TRANSCRIBING_MODELS_DIR"] = env_value
    sys.path.insert(0, SKILL)
    try:
        sys.modules.pop("transcribe_meeting", None)
        return importlib.import_module("transcribe_meeting")
    finally:
        sys.path.remove(SKILL)


def test_default_is_beside_the_skill():
    mod = _load(None)
    assert mod.MODELS_DIR == os.path.join(SKILL, ".models")
    assert mod.WHISPER_DIR.startswith(mod.MODELS_DIR)


def test_env_override_moves_every_model_path(tmp_path):
    mod = _load(str(tmp_path))
    assert mod.MODELS_DIR == str(tmp_path)
    for p in (mod.SEG_MODEL, mod.EMB_MODEL, mod.WHISPER_DIR):
        assert p.startswith(str(tmp_path)), p


def test_empty_override_falls_back_to_the_default():
    mod = _load("")
    assert mod.MODELS_DIR == os.path.join(SKILL, ".models")
