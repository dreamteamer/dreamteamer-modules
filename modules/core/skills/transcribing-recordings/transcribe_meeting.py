
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
from meeting_io import read_meeting, write_meeting, count_attendees, asr_cache_path_for, replace_transcript_section
from text_source import parse_labeled, log as log_text_source
import engines
import locations

HERE = os.path.dirname(os.path.abspath(__file__))
# Beside the skill by default. `TRANSCRIBING_MODELS_DIR` (an absolute path, read from the process
# environment) moves the ~1.6 GB elsewhere — needed when the skill sits in a folder that gets
# reinstalled, such as node_modules, where the weights would otherwise be re-downloaded every time.
MODELS_DIR = locations.models_dir()  # never beside the skill: npm ci would delete 1.6 GB
SEG_MODEL = os.path.join(MODELS_DIR, "segmentation.onnx")
EMB_MODEL = os.path.join(MODELS_DIR, "embedding.onnx")
WHISPER_DIR = os.path.join(MODELS_DIR, "whisper")
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
    """The old layout — a `.venv` beside the skill — still runs, but the next `npm install` deletes it.
    Say so, and say how to move it, rather than fail. Returns whether it warned."""
    prefix = prefix or sys.prefix
    if not locations.inside(prefix, HERE):
        return False
    print(
        f"  note: this venv is inside the skill folder ({prefix}), which `npm install` and compile replace.\n"
        f"    Export UV_PROJECT_ENVIRONMENT=\"${{TRANSCRIBING_VENV_DIR:-$HOME/.cache/dreamteamer/transcription-venv}}\"\n"
        f"    before `uv sync` / `uv run` (SKILL.md, \"paths\") and the venv lives at {locations.venv_dir()}.",
        file=sys.stderr,
    )
    return True


def setup():
    warn_if_venv_in_skill()
    os.makedirs(MODELS_DIR, exist_ok=True)
    if not os.path.exists(SEG_MODEL):
        tar_path = os.path.join(MODELS_DIR, "seg.tar.bz2")
        try:
            _download(_SEG_TAR_URL, tar_path)
            with tarfile.open(tar_path, "r:bz2") as tf:
                member = next(m for m in tf.getmembers() if m.name.endswith("model.onnx"))
                member.name = os.path.basename(SEG_MODEL)
                tf.extract(member, MODELS_DIR)
        finally:
            if os.path.exists(tar_path):
                os.remove(tar_path)
    if not os.path.exists(EMB_MODEL):
        _download(_EMB_URL, EMB_MODEL)
    # Prefetch the whisper weights into the skill-local cache.
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
    """auto | metal | cpu → the engine this run uses, decided from this machine."""
    return engines.select_engine(
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
    """
    if num_speakers == 1:
        return []  # one speaker for the whole file; align_words_to_speakers handles the empty case

    import subprocess as _sp
    proc = _sp.run(
        [sys.executable, os.path.abspath(__file__), "_diarize-worker", wav,
         str(num_speakers if num_speakers else 0)],
        capture_output=True,
    )
    if proc.returncode == 0:
        try:
            return json.loads(proc.stdout)
        except json.JSONDecodeError:
            pass
    # -10 is SIGBUS on macOS, -7 on Linux; any abnormal exit gets the same treatment.
    print(
        f"  diarization failed (exit {proc.returncode}) — falling back to a single speaker.\n"
        f"    This is the known sherpa-onnx one-cluster crash if the audio has one dominant voice.\n"
        f"    Pass --speakers N to force a count, or --speakers 1 to skip diarization cleanly.",
        file=sys.stderr,
    )
    if proc.stderr:
        print("    " + proc.stderr.decode("utf-8", "replace").strip().splitlines()[-1], file=sys.stderr)
    return []


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


def run(meeting_md, audio, generated, num_speakers=None, language=None, engine="auto"):
    try:
        engine = choose_engine(engine)
    except engines.EngineUnavailable as e:
        raise SystemExit(f"✖ {e}")
    fm, body = read_meeting(meeting_md)
    if num_speakers is None:
        num_speakers = count_attendees(fm)
    warn_if_venv_in_skill()
    # The decoded WAV is a full copy of the call. Its folder goes when the decode, diarization and
    # recognition are done — on success and on any failure alike, ^C included.
    tmp = tempfile.mkdtemp(prefix="transcribe-")
    try:
        wav = os.path.join(tmp, "audio.wav")
        decode_audio(audio, wav)
        segments = diarize_safe(wav, num_speakers=num_speakers)
        t0 = time.monotonic()
        asr = transcribe(wav, language=language, engine=engine)
        asr_seconds = round(time.monotonic() - t0, 1)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    turns = align_words_to_speakers(asr["words"], segments)

    asr_json = asr_cache_path_for(meeting_md)
    with open(asr_json, "w", encoding="utf-8") as f:
        json.dump({"asr": asr, "segments": segments}, f, ensure_ascii=False)

    fm["transcription"] = {
        "generated": generated,
        "engine": engines.LABELS[engine],
        "diarization": DIARIZATION,
        "language": asr["language"],
        # Whether the language was forced or detected — a detected one on a code-switched
        # call is what produces a transliterated transcript.
        "language_source": "forced" if language else "detected",
        "duration": fmt_ts(asr["duration"]),
        "speaker_count": len({t["speaker"] for t in turns}),
        "speakers": {},
    }
    body = replace_transcript_section(body, render_transcript_body(turns, timestamps=True))
    write_meeting(meeting_md, fm, body)

    summary = {
        "language": asr["language"],
        "duration": fmt_ts(asr["duration"]),
        "speaker_count": fm["transcription"]["speaker_count"],
        "speakers_hint": num_speakers,
        "engine": engine,
        "asr_seconds": asr_seconds,
        "meeting": meeting_md,
        "asr_cache": asr_json,
    }
    print(json.dumps(summary, ensure_ascii=False))
    return summary


if __name__ == "__main__":
    args = sys.argv[1:]
    if args and args[0] == "setup":
        setup()
    elif len(args) == 3 and args[0] == "_diarize-worker":
        # Internal. Runs in a child so a sherpa-onnx SIGBUS is an exit code, not a dead pipeline.
        n = int(args[2]) or None
        print(json.dumps(diarize(args[1], num_speakers=n), ensure_ascii=False))
    elif len(args) >= 3 and args[0] == "run":
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
        run(args[1], args[2], date, num_speakers=spk, language=lang, engine=eng)
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
            "usage: transcribe_meeting.py setup"
            " | run <meeting.md> <audio> [--date YYYY-MM-DD] [--speakers N] [--language en|he]"
            " [--engine auto|metal|cpu]"
            " | log <meeting.md> <turns.json> [--date YYYY-MM-DD]"
            " | parse-labeled <text-file>"
        )
