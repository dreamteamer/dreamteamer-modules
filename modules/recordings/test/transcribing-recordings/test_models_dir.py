"""The models are $TRANSCRIPTION_HOME/models (default ~/.cache/dreamteamer/transcription/models), never
beside the skill, which `npm ci` wipes; every model path follows the one variable."""
import importlib
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL = os.path.join(os.path.dirname(os.path.dirname(HERE)), "skills", "transcribing-recordings")


def _load(env_value):
    if env_value is None:
        os.environ.pop("TRANSCRIPTION_HOME", None)
    else:
        os.environ["TRANSCRIPTION_HOME"] = env_value
    sys.path.insert(0, SKILL)
    try:
        sys.modules.pop("transcribe_meeting", None)
        return importlib.import_module("transcribe_meeting")
    finally:
        sys.path.remove(SKILL)


def test_default_is_the_per_machine_cache():
    mod = _load(None)
    assert mod.MODELS_DIR == os.path.join(os.path.expanduser("~"), ".cache", "dreamteamer", "transcription", "models")
    assert not mod.MODELS_DIR.startswith(SKILL)
    assert mod.WHISPER_DIR.startswith(mod.MODELS_DIR)


def test_env_override_moves_every_model_path(tmp_path):
    mod = _load(str(tmp_path))
    assert mod.MODELS_DIR == str(tmp_path / "models")
    assert mod.SEG_MODEL == str(tmp_path / "models" / "diarization" / "segmentation.onnx")
    assert mod.WHISPER_DIR == str(tmp_path / "models" / "whisper-ct2")
    for p in (mod.SEG_MODEL, mod.EMB_MODEL, mod.WHISPER_DIR, mod.GGML_MODEL):
        assert p.startswith(str(tmp_path)), p


def test_empty_override_falls_back_to_the_default():
    mod = _load("")
    assert mod.MODELS_DIR == os.path.join(os.path.expanduser("~"), ".cache", "dreamteamer", "transcription", "models")
