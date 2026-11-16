
"""Local meeting transcription: ffmpeg → sherpa-onnx diarize → whisper (Metal or CPU) → render.

The heavy stack (soundfile, sherpa-onnx, faster-whisper, PyYAML) is imported where it is used, so the
module loads under a bare python3 and its plumbing is testable without the venv.
"""
import datetime
import json
import os
import shutil
import sys
import subprocess
import tarfile
import tempfile
import time
import urllib.request

from render import align_words_to_speakers, render_transcript_body, fmt_ts
from meeting_io import (read_meeting, write_meeting, count_attendees, asr_cache_path_for, replace_transcript_section,
                        read_asr_cache, asr_cache_matches)
from text_source import parse_labeled, log as log_text_source
import engines
import locations
from voiceprints import carry as vp_carry
from voiceprints import models as vp_models
from voiceprints import segments as vp_segments
from voiceprints import signatures as vp_signatures
from voiceprints import store as vp_store

HERE = os.path.dirname(os.path.abspath(__file__))
# Everything under $TRANSCRIPTION_HOME/models (locations.py).
MODELS_DIR = locations.models_dir()
DIARIZATION_DIR = locations.diarization_dir()
SEG_MODEL = os.path.join(DIARIZATION_DIR, "segmentation.onnx")
EMB_MODEL = os.path.join(DIARIZATION_DIR, "embedding.onnx")
WHISPER_DIR = locations.whisper_ct2_dir()
WHISPER_ID = "ivrit-ai/whisper-large-v3-turbo-ct2"
GGML_MODEL = engines.ggml_path(MODELS_DIR)

_SEG_TAR_URL = ("https://github.com/k2-fsa/sherpa-onnx/releases/download/"
                "speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2")
_EMB_URL = ("https://github.com/k2-fsa/sherpa-onnx/releases/download/"
            "speaker-recongition-models/wespeaker_en_voxceleb_CAM++_LM.onnx")

DIARIZATION = "sherpa-onnx · pyannote-seg-3.0 + cam++"


def _download(url, dst):
    print(f"  downloading {url} -> {dst}", file=sys.stderr)
    urllib.request.urlretrieve(url, dst)


def warn_if_venv_in_skill(prefix=None):
    """Without the SKILL.md export, uv builds a `.venv` beside the skill, which the next `npm install`
    deletes. It still runs; say how to put it where it belongs. Returns whether it warned."""
    prefix = prefix or sys.prefix
    if not locations.inside(prefix, HERE):
        return False
    print(
        f"  note: this venv is inside the skill folder ({prefix}), which `npm install` and compile replace.\n"
        f"    Export UV_PROJECT_ENVIRONMENT=\"${{TRANSCRIPTION_HOME:-$HOME/.cache/dreamteamer/transcription}}/venv\"\n"
        f"    before `uv sync` / `uv run` (SKILL.md, \"paths\") and the venv lives at {locations.venv_dir()}.",
        file=sys.stderr,
    )
    return True


def ct2_ready(whisper_dir=None):
    """The faster-whisper weights are on disk: a `model.bin` somewhere in the hub cache under the folder."""
    for _, _, files in os.walk(whisper_dir or WHISPER_DIR):
        if "model.bin" in files:
            return True
    return False


def missing_models(engine, num_speakers, seg=None, emb=None, whisper_dir=None, speaker=False,
                   models_dir=None, skill_dir=None):
    """What a run needs and does not have. Diarization needs both onnx files unless the run is solo; the
    cpu engine needs the ct2 weights (metal's ggml file is checked by engine selection). A run that went
    ahead without them would diarize nothing and fall back to one speaker, or pull 1.5 GB mid-run.

    The active speaker model (voice signatures) is reported only when asked (`speaker=True`): a missing
    speaker model never blocks transcription — `run` writes the transcript and says signatures were not
    kept (ruling D16)."""
    seg, emb = seg or SEG_MODEL, emb or EMB_MODEL
    missing = []
    if num_speakers != 1:
        missing += [p for p in (seg, emb) if not (os.path.isfile(p) and os.path.getsize(p) > 0)]
    if engine == "cpu" and not ct2_ready(whisper_dir):
        missing.append(whisper_dir or WHISPER_DIR)
    if speaker:
        mdir = models_dir or MODELS_DIR
        active = vp_models.active_model(skill_dir or HERE)
        if not vp_models.ready(active, mdir):
            missing.append(vp_models.model_path(active, mdir))
    return missing


SETUP_USAGE = "usage: transcribe_meeting.py setup [--speaker-models all|<id>[,<id>…]]"


class SetupUsage(ValueError):
    """An argument after `setup` that is not `--speaker-models <value>` (or `--speaker-models=<value>`)."""


def setup_args(args):
    """`setup [--speaker-models all|<id>[,<id>…]]` → the speaker model ids asked for, or None (no flag).
    The `--speaker-models=<value>` form is accepted too. Anything else — an unknown or misspelt flag, a
    stray word, the flag twice — is refused (SetupUsage) rather than ignored, so a typo never runs the
    whole setup; an unknown model id or a missing value is refused by the registry (ModelRefused)."""
    value, seen, i = None, False, 0
    while i < len(args):
        a = args[i]
        if a == "--speaker-models":
            if i + 1 >= len(args):
                raise vp_models.ModelRefused("--speaker-models needs `all` or a comma list of model ids")
            v, i = args[i + 1], i + 2
        elif a.startswith("--speaker-models="):
            v, i = a[len("--speaker-models="):], i + 1
        elif a.startswith("-"):
            raise SetupUsage(f"setup does not know the flag {a!r}")
        else:
            raise SetupUsage(f"setup takes no argument {a!r}")
        if seen:
            raise SetupUsage("--speaker-models is given more than once")
        seen, value = True, v
    if not seen:
        return None
    return vp_models.parse_speaker_models(value)


def setup_speaker_models(model_ids, models_dir=None, download=None):
    """Fetch speaker models into $TRANSCRIPTION_HOME/models/speaker/ (pinned by sha256), apart from
    the diariser's copy in models/diarization/."""
    mdir = models_dir or MODELS_DIR
    for pin in vp_models.fetch(model_ids, mdir, download or engines.download_verified):
        print(f"setup: speaker model {pin.id} ready ({pin.dim}-d, sha256 {pin.sha256[:12]}…) in "
              f"{vp_models.speaker_dir(mdir)}", file=sys.stderr)


def setup(speaker_models=None, models_dir=None, skill_dir=None, download=None):
    """Every model a run needs, plus the active speaker model. With `speaker_models` (from
    `--speaker-models all|<ids>`) only those speaker models are fetched: the developer's calibration
    needs every registered one on a machine whose transcription models are already in place."""
    warn_if_venv_in_skill()
    if speaker_models is not None:
        setup_speaker_models(speaker_models, models_dir, download)
        print("setup: speaker models only — the diarisation and whisper models are left as they are",
              file=sys.stderr)
        return
    os.makedirs(DIARIZATION_DIR, exist_ok=True)
    if not os.path.exists(SEG_MODEL):
        tar_path = os.path.join(DIARIZATION_DIR, "seg.tar.bz2")
        try:
            _download(_SEG_TAR_URL, tar_path)
            with tarfile.open(tar_path, "r:bz2") as tf:
                member = next(m for m in tf.getmembers() if m.name.endswith("model.onnx"))
                member.name = os.path.basename(SEG_MODEL)
                tf.extract(member, DIARIZATION_DIR)
        finally:
            if os.path.exists(tar_path):
                os.remove(tar_path)
    if not os.path.exists(EMB_MODEL):
        _download(_EMB_URL, EMB_MODEL)
    # The speaker model voice signatures are embedded with: the active one (models.active_model).
    setup_speaker_models([vp_models.active_model(skill_dir or HERE)], models_dir, download)
    # Prefetch the whisper weights.
    from faster_whisper import WhisperModel
    WhisperModel(WHISPER_ID, device="cpu", compute_type="int8", download_root=WHISPER_DIR)
    # The GPU pass's weights, only where the GPU pass can run: 1.6 GB is not worth fetching for a
    # machine whose `auto` would never pick it.
    if engines.apple_silicon() and engines.find_whisper_cli():
        if not engines.ggml_ready(MODELS_DIR):
            engines.download_verified(engines.ggml_url(), GGML_MODEL, engines.GGML_SIZE, engines.GGML_SHA256)
    else:
        print("setup: no whisper-cli on Apple Silicon — skipping the ggml weights; the CPU pass runs",
              file=sys.stderr)
    print("setup: models ready in", MODELS_DIR, file=sys.stderr)
    print("setup: venv", sys.prefix, "· ASR cache", locations.asr_cache_dir(), file=sys.stderr)


def choose_engine(requested):
    """auto | metal | cpu → (engine, fallback): the engine this run uses, decided from this machine, and
    why `auto` ended on the CPU (None when it did not)."""
    return engines.select_engine_why(
        requested,
        whisper_cli=engines.find_whisper_cli(),
        ggml_present=engines.ggml_ready(MODELS_DIR),
        apple_gpu=engines.apple_silicon(),
    )


def decode_audio(src, dst_wav):
    """Decode anything ffmpeg can read to 16 kHz mono WAV.

    Both guards below print ffmpeg's own reason: `check=True, capture_output=True` alone raises
    CalledProcessError with ffmpeg's stderr captured into the exception and never shown.
    """
    if shutil.which("ffmpeg") is None:
        raise SystemExit(
            "✖ ffmpeg is not on PATH — it is the only external binary this skill needs.\n"
            "  macOS: brew install ffmpeg · Debian/Ubuntu: apt-get install -y ffmpeg"
        )
    if not os.path.exists(src):
        raise SystemExit(f"✖ audio not found: {src}")
    p = subprocess.run(
        ["ffmpeg", "-nostdin", "-i", src, "-ar", "16000", "-ac", "1", "-f", "wav", dst_wav, "-y"],
        capture_output=True,
    )
    if p.returncode != 0:
        tail = p.stderr.decode("utf-8", "replace").strip().splitlines()[-3:]
        raise SystemExit(f"✖ ffmpeg failed on {src} (exit {p.returncode}):\n  " + "\n  ".join(tail))


def diarize_safe(wav, num_speakers=None):
    """Diarize without letting a native crash take the whole run down.

    sherpa-onnx 1.10.46 raises SIGBUS (a bus error, not an exception) whenever clustering
    resolves to a single speaker: `num_clusters=1`, a strict threshold, or one dominant voice
    under the default threshold all do it. A voice memo or any solo recording produces exactly
    that outcome, so pass `--speakers N` whenever the count is known.

    A SIGBUS cannot be caught in-process, so the only robust guard is a child process: if it dies,
    we still have a transcript, just an undiarized one. Two layers:
      · num_speakers == 1 → skip sherpa entirely. Correct for a solo recording AND crash-free.
      · otherwise → diarize in a child; on any abnormal exit fall back to one speaker.

    Returns `(segments, fallback)`: `fallback` is why diarisation fell back to one speaker
    (`"diariser exited -10; one speaker"`), None when it did not — a declared single speaker is not a
    fallback. `run` records it as `transcription.diarization_fallback` (design section 7, seam 1).
    """
    if num_speakers == 1:
        return [], None  # one speaker for the whole file; align_words_to_speakers handles the empty case

    import subprocess as _sp
    proc = _sp.run(
        [sys.executable, os.path.abspath(__file__), "_diarize-worker", wav,
         str(num_speakers if num_speakers else 0)],
        capture_output=True,
    )
    if proc.returncode == 0:
        try:
            segments = json.loads(proc.stdout)
            if isinstance(segments, list):
                return segments, None
        except (json.JSONDecodeError, UnicodeDecodeError):
            pass
        reason = "diariser output unreadable; one speaker"
    else:
        reason = f"diariser exited {proc.returncode}; one speaker"
    # -10 is SIGBUS on macOS, -7 on Linux; any abnormal exit gets the same treatment.
    print(
        f"  diarization failed (exit {proc.returncode}) — falling back to a single speaker.\n"
        f"    This is the known sherpa-onnx one-cluster crash if the audio has one dominant voice.\n"
        f"    Pass --speakers N to force a count, or --speakers 1 to skip diarization cleanly.",
        file=sys.stderr,
    )
    if proc.stderr:
        lines = proc.stderr.decode("utf-8", "replace").strip().splitlines()
        if lines:
            print("    " + lines[-1], file=sys.stderr)
    return [], reason


def diarize(wav, num_speakers=None):
    import sherpa_onnx
    import soundfile as sf
    if num_speakers and num_speakers >= 1:
        # Known speaker count (from meeting attendees / --speakers): force exactly
        # that many clusters. Robust — avoids the threshold path's over-splitting.
        clustering = sherpa_onnx.FastClusteringConfig(num_clusters=int(num_speakers))
    else:
        # Unknown count: threshold-based. CAM++ embeddings on noisy/phone audio
        # over-split at low thresholds (0.5 → dozens of speakers), so use a
        # conservative 0.8. Prefer passing a known count over this fallback.
        clustering = sherpa_onnx.FastClusteringConfig(num_clusters=-1, threshold=0.8)
    config = sherpa_onnx.OfflineSpeakerDiarizationConfig(
        segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
            pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(model=SEG_MODEL),
        ),
        embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=EMB_MODEL),
        clustering=clustering,
        min_duration_on=0.3,
        min_duration_off=0.5,
    )
    sd = sherpa_onnx.OfflineSpeakerDiarization(config)
    samples, sr = sf.read(wav, dtype="float32")
    if samples.ndim > 1:
        samples = samples[:, 0]
    result = sd.process(samples).sort_by_start_time()
    return [{"speaker": f"speaker_{r.speaker}", "start": r.start, "end": r.end} for r in result]


def transcribe(wav, language=None, engine="cpu"):
    if engine == "metal":
        asr = engines.run_whisper_cli(engines.find_whisper_cli(), GGML_MODEL, wav, language=language)
        return {
            "words": asr["words"],
            "language": [language or asr["language"] or "und"],
            "duration": asr["duration"],
            "language_forced": language,
        }
    from faster_whisper import WhisperModel
    model = WhisperModel(WHISPER_ID, device="cpu", compute_type="int8", download_root=WHISPER_DIR)
    segments, info = model.transcribe(
        wav,
        word_timestamps=True,
        vad_filter=True,
        # Explicit when we know the call's language. Otherwise faster-whisper detects it
        # from ONE window (language_detection_segments=1) and applies that to the whole
        # file — so an English call that opens with a Hebrew greeting gets pinned to `he`
        # by its own first sentence.
        language=language,
        # Whisper feeds each window's decoded text as the next window's prompt. When the
        # opening language differs from the rest of the call, that prompt keeps dragging
        # the decoder back, and English comes out transliterated into Hebrew script.
        # Measured on a 39-minute English call with a Hebrew intro, first 6 min,
        # as a ratio of Hebrew to Latin characters:
        #   conditioning on, no language          → 0.980  (unusable)
        #   conditioning OFF, no language         → 0.439
        #   conditioning OFF + language="en"      → 0.131
        # Off is the safe default in every language: it costs a little cross-window
        # coherence and removes the failure mode entirely.
        condition_on_previous_text=False,
    )
    words, duration = [], 0.0
    langs = {info.language} if info.language else set()
    for seg in segments:
        duration = max(duration, seg.end or 0.0)
        for w in (seg.words or []):
            words.append({"start": w.start, "end": w.end, "text": w.word})
    return {
        "words": words,
        "language": sorted(langs) or ["und"],
        "duration": duration,
        "language_forced": language,
    }


# ── voice signatures (design section 7, seams 3 and 4) ──────────────────────────────────────────────
# `run` keeps a signature of every diarisation in the user's voice-print store and never lets that
# stop a transcript: no context, a refused or unwritable store, or a missing speaker model each leave
# the transcript written and the summary saying `signatures: not kept — <reason>` (ruling D16).

ONE_SPEAKER_DECLARED = "skipped — one speaker declared"
NO_CONTEXT = ("no voice context — run it through the module's entry (`transcribe.mjs run <record>`) so the "
              "record's workspace and the store's guard are known")


class SpeakerModelMissing(Exception):
    """The active speaker model is not on disk: signatures are not kept, the transcript is."""


def load_embedder(model_id):
    """The window embedder for `model_id` (the active model — `models.active_model`), pinned by sha256.
    Imports numpy and sherpa-onnx, so it is only called where audio is embedded; tests replace it."""
    if not vp_models.ready(model_id, MODELS_DIR):
        raise SpeakerModelMissing(f"speaker model {model_id} missing; run setup")
    from voiceprints import embed
    return embed.Embedder(model_id, MODELS_DIR)


def read_samples(wav):
    """(samples, sample rate) of the decoded WAV, for the embedder. Tests replace it."""
    from voiceprints import embed
    return embed.read_audio(wav)


def open_store(context):
    """The user's voice-print store (VOICE_PRINTS_HOME, else the platform default), guarded by the
    context's workspace, files and inbox folders: a refused location raises StoreRefused before anything
    is made."""
    return vp_store.Store(vp_store.default_home(), guard=context.get("guard") or {})


def audio_key(context, audio):
    """The store's key for the recording: the record's `fingerprint` (`sha256:<hex>`, or the bare hex),
    else the sha256 of the audio file (design section 8)."""
    fp = (context or {}).get("fingerprint")
    if isinstance(fp, str):
        h = fp.strip().lower()
        h = h[len("sha256:"):] if h.startswith("sha256:") else h
        if len(h) == 64 and all(c in "0123456789abcdef" for c in h):
            return h
    return vp_models.file_sha256(audio)


def _not_kept(e):
    if isinstance(e, (vp_store.StoreRefused, vp_store.ModelMismatch, SpeakerModelMissing,
                      vp_models.ModelRefused, vp_models.CalibrationAmbiguous)):
        return str(e)
    if isinstance(e, OSError):
        return f"the voice-print store could not be written ({e})"
    return f"{type(e).__name__}: {e}"


def _diarized(result):
    """`diarize_safe`'s `(segments, fallback)`; a bare segment list (a stand-in written before 0.6.0
    returns one) is `(list, None)`."""
    if isinstance(result, tuple) and len(result) == 2:
        return list(result[0] or []), result[1]
    return list(result or []), None


def signature_step(context, wav, segments, words, previous, *, audio_sha256, diarization_id, speakers_hint,
                   fallback, spans=None):
    """While the decoded WAV still exists: open the store, leave out the labels carrying a forgotten
    person's earlier name or mostly their earlier time (seam 5, `spans` from `carry.previous`), embed
    every other label with the active model. Returns `(signature, store, None)`, or `(None, None,
    reason)` when signatures will not be kept. When a forgotten person's earlier name cannot be placed
    in this transcript, no label keeps windows: `(signature with every label removed, store, reason)`."""
    if not context:
        return None, None, NO_CONTEXT
    if not context.get("workspace") or not context.get("record"):
        return None, None, "the voice context names no workspace or no record"
    try:
        store = open_store(context)
        store.ensure()
        removed = vp_carry.forgotten_new_labels(previous, store.forgotten(), context["workspace"],
                                                spans=spans, new_segments=segments)
        unplaced = vp_carry.forgotten_unplaced(previous)
        embedder = load_embedder(vp_models.active_model(HERE))
        samples, sr = ([], 0) if unplaced else read_samples(wav)
        sig = vp_signatures.compute(embedder, samples, sr, segments, words, audio_sha256=audio_sha256,
                                    diarization_id=diarization_id, speakers_hint=speakers_hint,
                                    fallback=fallback, removed=removed, remove_all=unplaced)
        return sig, store, (vp_carry.FORGOTTEN_UNPLACED if unplaced else None)
    except Exception as e:  # never stops the transcript
        return None, None, _not_kept(e)


def run(meeting_md, audio, generated, num_speakers=None, language=None, engine="auto", context=None):
    """Transcribe one recording into its record. Writes no name: `transcription.speakers` is `{}`, earlier
    names move to `previous_speakers` (seam 5), and the top-level `speaker_naming` is cleared. `context`
    is the node entry's one-record voice context (lib/voice-context.mjs); without it the transcript is
    written and signatures are not kept."""
    try:
        engine, fallback = choose_engine(engine)
    except engines.EngineUnavailable as e:
        raise SystemExit(f"✖ {e}")
    if fallback:
        print(f"  engine: cpu — {fallback}", file=sys.stderr)
    fm, body = read_meeting(meeting_md)
    if num_speakers is None:
        num_speakers = count_attendees(fm)
    missing = missing_models(engine, num_speakers)
    if missing:
        raise SystemExit("✖ models missing — run `uv run python transcribe_meeting.py setup` first:\n    "
                         + "\n    ".join(missing))
    warn_if_venv_in_skill()
    old_t = fm.get("transcription") if isinstance(fm.get("transcription"), dict) else {}
    # The earlier names are read now, before an hour of recognition: nothing in them can fail the run, and
    # a part that cannot be read is kept as written and said so.
    earlier = vp_carry.earlier(fm)
    record_ref = (context or {}).get("record")
    # The old cache is read before this run replaces it, and trusted only when it is this record's, this
    # audio's and the old diarisation's.
    asr_json = asr_cache_path_for(meeting_md)
    old_cache = read_asr_cache(asr_json)
    # The decoded WAV is a full copy of the call. Its folder goes when the decode, diarization,
    # recognition and embedding are done — on success and on any failure alike, ^C included.
    tmp = tempfile.mkdtemp(prefix="transcribe-")
    try:
        wav = os.path.join(tmp, "audio.wav")
        decode_audio(audio, wav)
        audio_sha = audio_key(context, audio)
        segments, diar_fallback = _diarized(diarize_safe(wav, num_speakers=num_speakers))
        t0 = time.monotonic()
        asr = transcribe(wav, language=language, engine=engine)
        asr_seconds = round(time.monotonic() - t0, 1)
        diar_id = vp_segments.diarization_id(segments)
        cache = old_cache if asr_cache_matches(old_cache, record_ref, audio_sha, old_t.get("diarization_id")) else None
        spans = {}
        previous = vp_carry.previous(fm, body, cache, segments, asr["duration"], earlier_names=earlier,
                                     spans_out=spans)
        sig, store, not_kept = signature_step(
            context, wav, segments, asr["words"], previous, audio_sha256=audio_sha, diarization_id=diar_id,
            speakers_hint=num_speakers or None, fallback=diar_fallback, spans=spans)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    turns = align_words_to_speakers(asr["words"], segments)

    with open(asr_json, "w", encoding="utf-8") as f:
        json.dump({"asr": asr, "segments": segments, "diarization_id": diar_id, "audio_sha256": audio_sha,
                   "record": record_ref}, f, ensure_ascii=False)

    fm.pop("speaker_naming", None)   # written only by identify; a new transcript has no names to judge
    fm["transcription"] = {
        "generated": generated,
        "engine": engines.LABELS[engine],
        **({"engine_fallback": fallback} if fallback else {}),
        "diarization": ONE_SPEAKER_DECLARED if num_speakers == 1 else DIARIZATION,
        **({"diarization_fallback": diar_fallback} if diar_fallback else {}),
        **({"speakers_hint": num_speakers} if num_speakers else {}),
        "diarization_id": diar_id,
        "language": asr["language"],
        # Whether the language was forced or detected — a detected one on a code-switched
        # call is what produces a transliterated transcript.
        "language_source": "forced" if language else "detected",
        "duration": fmt_ts(asr["duration"]),
        "speaker_count": len({t["speaker"] for t in turns}),
        "speakers": {},
        **({"previous_speakers": previous} if previous else {}),
    }
    body = replace_transcript_section(body, render_transcript_body(turns, timestamps=True))
    write_meeting(meeting_md, fm, body)

    # The transcript is on the record; only now is the signature written, so a store that fails here
    # (full, unwritable, swapped for a link into a synced folder) costs the signature and nothing else.
    if sig is not None:
        try:
            store.write_signature(sig["model"]["id"], sig, record={"workspace": context["workspace"],
                                                                  "record": record_ref})
        except Exception as e:  # never stops the transcript
            not_kept = _not_kept(e)
    if not_kept:
        signatures = f"not kept — {not_kept}"
        print(f"  signatures: {signatures}", file=sys.stderr)
    else:
        signatures = f"kept — {sig['model']['id']}, {len(sig['labels'])} labels, diarisation {diar_id}"
    for notice in (store.notices if store is not None else []):
        print(f"  ⚠ {notice}", file=sys.stderr)
    if previous and previous.get("note"):
        print(f"  previous speakers: {previous['note']}", file=sys.stderr)
    unreadable = [u["field"] for u in (previous or {}).get("unreadable") or []]
    if unreadable:
        print(f"  previous speakers: not carried — {', '.join(unreadable)} could not be read; kept as written "
              "under previous_speakers.unreadable", file=sys.stderr)

    summary = {
        "language": asr["language"],
        "duration": fmt_ts(asr["duration"]),
        "speaker_count": fm["transcription"]["speaker_count"],
        "speakers_hint": num_speakers,
        "diarization_id": diar_id,
        "diarization_fallback": diar_fallback,
        "signatures": signatures,
        "previous_speakers": (
            {"labels": len(previous["labels"]),
             "offered": sum(1 for e in previous["labels"].values() if e.get("offered")),
             **({"note": previous["note"]} if previous.get("note") else {}),
             **({"unreadable": unreadable} if unreadable else {})} if previous else None),
        "engine": engine,
        "engine_fallback": fallback,
        "asr_seconds": asr_seconds,
        "meeting": meeting_md,
        "asr_cache": asr_json,
    }
    print(json.dumps(summary, ensure_ascii=False))
    return summary


RUN_USAGE = ("run <meeting.md> <audio> [--date YYYY-MM-DD] [--speakers N] [--language en|he]"
             " [--engine auto|metal|cpu] [--context <file.json>]")


def context_from_args(args):
    """`--context <file.json>` (the node entry writes it, lib/voice-context.mjs) → `(context, warning)`.
    No flag is `(None, None)`; an unreadable file is `(None, why)`, and run transcribes without it. A
    several-records context gives the entry whose `record_path` is this run's record."""
    if "--context" not in args:
        return None, None
    i = args.index("--context")
    if i + 1 >= len(args):
        return None, "--context needs a file"
    path = args[i + 1]
    try:
        with open(path, encoding="utf-8") as f:
            ctx = json.load(f)
    except (OSError, ValueError) as e:
        return None, f"the voice context {path} cannot be read ({e})"
    if not isinstance(ctx, dict):
        return None, f"the voice context {path} is not an object"
    if isinstance(ctx.get("records"), list):
        record = os.path.abspath(args[1]) if len(args) > 1 else None
        for c in ctx["records"]:
            if isinstance(c, dict) and c.get("record_path") and os.path.abspath(c["record_path"]) == record:
                return c, None
        return None, f"the voice context {path} has no entry for {args[1] if len(args) > 1 else 'this record'}"
    return ctx, None


def main_run(args):
    """`run <meeting.md> <audio> [flags…]` from the command line."""
    date = datetime.date.today().isoformat()
    if "--date" in args:
        date = args[args.index("--date") + 1]
    spk = None
    if "--speakers" in args:
        spk = int(args[args.index("--speakers") + 1])
    lang = None
    if "--language" in args:
        lang = args[args.index("--language") + 1]
    try:
        eng = engines.parse_engine_arg(args)
    except ValueError as e:
        sys.exit(f"✖ {e}")
    context, warning = context_from_args(args)
    if warning:
        print(f"  ⚠ {warning} — transcribing without it; signatures will not be kept", file=sys.stderr)
    return run(args[1], args[2], date, num_speakers=spk, language=lang, engine=eng, context=context)


if __name__ == "__main__":
    args = sys.argv[1:]
    if args and args[0] == "setup":
        try:
            _speaker_models = setup_args(args[1:])
        except (SetupUsage, vp_models.ModelRefused) as e:
            sys.exit(f"✖ {e}\n  {SETUP_USAGE}")
        try:
            setup(speaker_models=_speaker_models)
        except (vp_models.ModelRefused, vp_models.CalibrationAmbiguous) as e:
            sys.exit(f"✖ {e}")
    elif len(args) == 3 and args[0] == "_diarize-worker":
        # Internal. Runs in a child so a sherpa-onnx SIGBUS is an exit code, not a dead pipeline.
        n = int(args[2]) or None
        print(json.dumps(diarize(args[1], num_speakers=n), ensure_ascii=False))
    elif len(args) >= 3 and args[0] == "run":
        main_run(args)
    elif len(args) >= 3 and args[0] == "log":
        date = datetime.date.today().isoformat()
        if "--date" in args:
            date = args[args.index("--date") + 1]
        summary = log_text_source(args[1], args[2], date)
        print(json.dumps(summary, ensure_ascii=False))
    elif len(args) >= 2 and args[0] == "parse-labeled":
        with open(args[1], encoding="utf-8") as _f:
            _text = _f.read()
        print(json.dumps(parse_labeled(_text), ensure_ascii=False, indent=2))
    else:
        sys.exit(
            "usage: transcribe_meeting.py setup [--speaker-models all|<id>[,<id>…]]"
            " | " + RUN_USAGE +
            " | log <meeting.md> <turns.json> [--date YYYY-MM-DD]"
            " | parse-labeled <text-file>"
        )
