
"""Local meeting transcription: ffmpeg → sherpa-onnx diarize → faster-whisper → render."""
import datetime
import json
import os
import sys
import subprocess
import tarfile
import urllib.request

import numpy as np
import soundfile as sf

from render import align_words_to_speakers, render_transcript_body, fmt_ts
from meeting_io import read_meeting, write_meeting, count_attendees, asr_cache_path_for, replace_transcript_section
from text_source import parse_labeled, log as log_text_source

HERE = os.path.dirname(os.path.abspath(__file__))
# Beside the skill by default. `TRANSCRIBING_MODELS_DIR` moves the ~1.6 GB elsewhere — needed when this
# skill arrives through npm (`node_modules/@dreamteamer/extensions/…`), where `npm ci` wipes the folder
# and would re-download the weights on every install; a git-module or inline copy keeps the default.
MODELS_DIR = os.environ.get("TRANSCRIBING_MODELS_DIR") or os.path.join(HERE, ".models")
SEG_MODEL = os.path.join(MODELS_DIR, "segmentation.onnx")
EMB_MODEL = os.path.join(MODELS_DIR, "embedding.onnx")
WHISPER_DIR = os.path.join(MODELS_DIR, "whisper")
WHISPER_ID = "ivrit-ai/whisper-large-v3-turbo-ct2"

_SEG_TAR_URL = ("https://github.com/k2-fsa/sherpa-onnx/releases/download/"
                "speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2")
_EMB_URL = ("https://github.com/k2-fsa/sherpa-onnx/releases/download/"
            "speaker-recongition-models/wespeaker_en_voxceleb_CAM++_LM.onnx")

ENGINE = "faster-whisper · ivrit-ai/whisper-large-v3-turbo-ct2 (int8)"
DIARIZATION = "sherpa-onnx · pyannote-seg-3.0 + cam++"


def _download(url, dst):
    print(f"  downloading {url} -> {dst}", file=sys.stderr)
    urllib.request.urlretrieve(url, dst)


def setup():
    os.makedirs(MODELS_DIR, exist_ok=True)
    if not os.path.exists(SEG_MODEL):
        tar_path = os.path.join(MODELS_DIR, "seg.tar.bz2")
        _download(_SEG_TAR_URL, tar_path)
        with tarfile.open(tar_path, "r:bz2") as tf:
            member = next(m for m in tf.getmembers() if m.name.endswith("model.onnx"))
            member.name = os.path.basename(SEG_MODEL)
            tf.extract(member, MODELS_DIR)
        os.remove(tar_path)
    if not os.path.exists(EMB_MODEL):
        _download(_EMB_URL, EMB_MODEL)
    # Prefetch the whisper weights into the skill-local cache.
    from faster_whisper import WhisperModel
    WhisperModel(WHISPER_ID, device="cpu", compute_type="int8", download_root=WHISPER_DIR)
    print("setup: models ready in", MODELS_DIR, file=sys.stderr)


def decode_audio(src, dst_wav):
    """Decode anything ffmpeg can read to 16 kHz mono WAV.

    ⚠ Both guards below exist because `check=True, capture_output=True` alone raises
    CalledProcessError with ffmpeg's stderr captured into the exception and never printed — so a
    missing file reported `returned non-zero exit status 254` and the words "No such file or
    directory" appeared nowhere.
    """
    import shutil
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

    ⚠ sherpa-onnx 1.10.46 raises SIGBUS — not an exception, a **bus error** — whenever the
    clustering resolves to a SINGLE speaker. Measured 2026-08-13 on this stack: `num_clusters=1`
    crashes; `threshold=0.9` crashes (too strict, everything lands in one cluster); the default
    `threshold=0.8` crashed on 45s of one dominant voice and succeeded on the same call's first
    5 minutes once both voices were present (62 segments, 6 speakers). So the failure is not the
    threshold path as such — it is a one-cluster outcome, which is exactly what a **voice memo or
    any solo recording produces**. The audio route had 72 successes because the skill tells you to
    pass `--speakers N` from the attendee list, and N was always ≥ 2.

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
        f"  ⚠ diarization failed (exit {proc.returncode}) — falling back to a single speaker.\n"
        f"    This is the known sherpa-onnx one-cluster crash if the audio has one dominant voice.\n"
        f"    Pass --speakers N to force a count, or --speakers 1 to skip diarization cleanly.",
        file=sys.stderr,
    )
    if proc.stderr:
        print("    " + proc.stderr.decode("utf-8", "replace").strip().splitlines()[-1], file=sys.stderr)
    return []


def diarize(wav, num_speakers=None):
    import sherpa_onnx
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


def transcribe(wav, language=None):
    from faster_whisper import WhisperModel
    model = WhisperModel(WHISPER_ID, device="cpu", compute_type="int8", download_root=WHISPER_DIR)
    segments, info = model.transcribe(
        wav,
        word_timestamps=True,
        vad_filter=True,
        # Explicit when we know the call's language. Otherwise faster-whisper detects it
        # from ONE window (language_detection_segments=1) and applies that to the whole
        # file — and the operator announces every recording in Hebrew, so an English call
        # gets pinned to `he` by its own first sentence.
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


def run(meeting_md, audio, generated, num_speakers=None, language=None):
    fm, body = read_meeting(meeting_md)
    if num_speakers is None:
        num_speakers = count_attendees(fm)
    import tempfile
    wav = os.path.join(tempfile.mkdtemp(), "audio.wav")
    decode_audio(audio, wav)
    segments = diarize_safe(wav, num_speakers=num_speakers)
    asr = transcribe(wav, language=language)
    turns = align_words_to_speakers(asr["words"], segments)

    asr_json = asr_cache_path_for(meeting_md)
    with open(asr_json, "w", encoding="utf-8") as f:
        json.dump({"asr": asr, "segments": segments}, f, ensure_ascii=False)

    fm["transcription"] = {
        "generated": generated,
        "engine": ENGINE,
        "diarization": DIARIZATION,
        "language": asr["language"],
        # Whether the language was forced or detected — a detected one on a code-switched
        # call is the thing that produced a transliterated transcript before 2026-08-04.
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
        run(args[1], args[2], date, num_speakers=spk, language=lang)
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
            " | log <meeting.md> <turns.json> [--date YYYY-MM-DD]"
            " | parse-labeled <text-file>"
        )
