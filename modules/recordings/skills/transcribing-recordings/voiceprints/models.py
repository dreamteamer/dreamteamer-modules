"""The speaker models voice prints are made with (design §7 seam 4, §8 "Model pinning").

The embedding that names speakers is its own step with its own pinned model, apart from the
diariser's `models/diarization/embedding.onnx`: the default is the same upstream file kept as its own
copy, so naming can change model without re-diarising anything. Every registered model sits in

    $TRANSCRIPTION_HOME/models/speaker/<file>

and is pinned by the sha256 of that file: a print or a signature carries `store.Model(id, sha256,
dim)`, and a file on disk that is not the registered one is refused rather than embedded with.

Which model is active is decided in one place, `active_model(skill_dir)`: the model named by the ONE
file in the skill's `calibration/` folder, else `DEFAULT_MODEL`. `setup`, `run`, `identify` and
`prints` all ask it; nothing picks a model another way.

Standard library only (the `engines.py` rule); `embed.py` is where numpy and sherpa-onnx come in.
"""
from __future__ import annotations

import hashlib
import json
import os

from voiceprints import store

# The sherpa-onnx release that carries the speaker-embedding models (the tag is spelled so upstream).
RELEASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/"

DEFAULT_MODEL = "campp-en-voxceleb-lm"

MODELS = {
    "campp-en-voxceleb-lm": {
        "id": "campp-en-voxceleb-lm",
        "file": "wespeaker_en_voxceleb_CAM++_LM.onnx",
        "url": RELEASE + "wespeaker_en_voxceleb_CAM++_LM.onnx",
        "size": 29292687,
        "sha256": "e197af7e9d473030cf486b3124149a19bf37014d0e4485e4c70c483b0ec10cb2",
        "dim": 512,
        # WeSpeaker: "the pretrained model on VoxCeleb follows Creative Commons Attribution 4.0
        # International License" (wenet-e2e/wespeaker docs/pretrained.md).
        "licence": "CC-BY-4.0",
    },
    "eres2netv2-zh-cn-16k-common": {
        "id": "eres2netv2-zh-cn-16k-common",
        "file": "3dspeaker_speech_eres2netv2_sv_zh-cn_16k-common.onnx",
        "url": RELEASE + "3dspeaker_speech_eres2netv2_sv_zh-cn_16k-common.onnx",
        "size": 71441526,
        "sha256": "bf1a75b9930474cf3389ef415e6e5d38ca96fea4a3a00f7e301d080a58ee2239",
        "dim": 192,
        # 3D-Speaker on ModelScope (iic/speech_eres2netv2_sv_zh-cn_16k-common): "Apache License 2.0".
        "licence": "Apache-2.0",
    },
}

SPEAKER_SUBDIR = "speaker"
CALIBRATION_SUBDIR = "calibration"


class ModelRefused(Exception):
    """A speaker model that cannot be used: not registered, not on disk, or not the registered file."""


class CalibrationAmbiguous(Exception):
    """The skill's `calibration/` folder does not name exactly one registered model."""


def entry(model_id):
    try:
        return MODELS[model_id]
    except KeyError:
        raise ModelRefused(f"speaker model {model_id!r} is not registered (known: {', '.join(sorted(MODELS))})")


def speaker_dir(models_dir):
    """`$TRANSCRIPTION_HOME/models/speaker` for `models_dir` = `$TRANSCRIPTION_HOME/models`."""
    return os.path.join(models_dir, SPEAKER_SUBDIR)


def model_path(model_id, models_dir):
    return os.path.join(speaker_dir(models_dir), entry(model_id)["file"])


def ready(model_id, models_dir):
    """The file is on disk at the registered size (cheap; `pin` checks the sha256)."""
    p = model_path(model_id, models_dir)
    return os.path.isfile(p) and os.path.getsize(p) == entry(model_id)["size"]


def setup_hint(model_id):
    if model_id == DEFAULT_MODEL:
        return "run `transcribe_meeting.py setup`"
    return f"run `transcribe_meeting.py setup --speaker-models {model_id}`"


def missing(model_ids, models_dir):
    """One line per model that is not on disk at its registered size, each naming `setup`."""
    lines = []
    for mid in model_ids:
        if not ready(mid, models_dir):
            lines.append(f"speaker model {mid} missing at {model_path(mid, models_dir)} — {setup_hint(mid)}")
    return lines


_SHA_CACHE = {}


def file_sha256(path):
    st = os.stat(path)
    key = (os.path.realpath(path), st.st_size, st.st_mtime_ns)
    if key not in _SHA_CACHE:
        h = hashlib.sha256()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        _SHA_CACHE[key] = h.hexdigest()
    return _SHA_CACHE[key]


def pin(model_id, models_dir):
    """`store.Model(id, sha256, dim)` of the file on disk — refused when it is missing or its sha256
    is not the registry's, so nothing is ever embedded with a file nobody pinned."""
    e = entry(model_id)
    p = model_path(model_id, models_dir)
    if not os.path.isfile(p):
        raise ModelRefused(f"speaker model {model_id} missing at {p} — {setup_hint(model_id)}")
    got = file_sha256(p)
    if got != e["sha256"]:
        raise ModelRefused(
            f"speaker model {model_id} at {p} has sha256 {got[:12]}…, the registered file has "
            f"{e['sha256'][:12]}… — delete it and {setup_hint(model_id)}")
    return store.Model(model_id, got, e["dim"])


def _named_in(path):
    """The model id a calibration file names: its `model` (an id, or `{id, …}`), else its file name
    (`<model id>.json` or `calibration-<model id>.json`)."""
    name = os.path.basename(path)
    stem = name[:-5] if name.endswith(".json") else name
    if stem.startswith("calibration-"):
        stem = stem[len("calibration-"):]
    named = None
    try:
        with open(path, encoding="utf-8") as f:
            obj = json.load(f)
        m = obj.get("model") if isinstance(obj, dict) else None
        named = m.get("id") if isinstance(m, dict) else m
    except (OSError, ValueError):
        raise CalibrationAmbiguous(f"calibration file {name} cannot be read as JSON")
    if named and stem in MODELS and named != stem:
        raise CalibrationAmbiguous(f"calibration file {name} names model {named}, its file name says {stem}")
    model_id = named or stem
    if model_id not in MODELS:
        raise CalibrationAmbiguous(f"calibration file {name} names model {model_id!r}, which is not registered")
    return model_id


def active_model(skill_dir):
    """The model id naming runs with: the one file in `<skill_dir>/calibration/`, else DEFAULT_MODEL.
    Two files there is an error naming both (dotfiles such as .DS_Store are not files here)."""
    folder = os.path.join(skill_dir, CALIBRATION_SUBDIR)
    try:
        names = sorted(n for n in os.listdir(folder)
                       if not n.startswith(".") and os.path.isfile(os.path.join(folder, n)))
    except (FileNotFoundError, NotADirectoryError):
        return DEFAULT_MODEL
    if not names:
        return DEFAULT_MODEL
    if len(names) > 1:
        raise CalibrationAmbiguous(
            f"the skill's calibration folder holds {len(names)} files ({', '.join(names)}); "
            f"exactly one names the active speaker model")
    return _named_in(os.path.join(folder, names[0]))


def parse_speaker_models(value):
    """`all` or a comma list of ids → the ids, registry order; an unknown id is refused."""
    if value == "all":
        return list(MODELS)
    ids = [v.strip() for v in (value or "").split(",") if v.strip()]
    if not ids:
        raise ModelRefused("--speaker-models needs `all` or a comma list of model ids")
    for mid in ids:
        entry(mid)
    return ids


def fetch(model_ids, models_dir, download):
    """Put each model in `models/speaker/`: download what is not there at its registered size with
    `download(url, dst, size, sha256)` (engines.download_verified), then pin every one. Returns the pins."""
    pins = []
    for mid in model_ids:
        e = entry(mid)
        if not ready(mid, models_dir):
            os.makedirs(speaker_dir(models_dir), exist_ok=True)
            download(e["url"], model_path(mid, models_dir), e["size"], e["sha256"])
        pins.append(pin(mid, models_dir))
    return pins
