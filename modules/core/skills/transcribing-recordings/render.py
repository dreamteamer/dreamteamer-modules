"""Pure rendering helpers: timestamp formatting, word→speaker alignment, markdown."""


def fmt_ts(seconds):
    if seconds is None:
        return "??:??"
    s = int(seconds)
    return f"{s // 60:02d}:{s % 60:02d}"


def _speaker_for(word, segments):
    if not segments:
        return "speaker_0"
    mid = (word["start"] + word["end"]) / 2
    for seg in segments:
        if seg["start"] <= mid < seg["end"]:
            return seg["speaker"]
    nearest = min(segments, key=lambda s: min(abs(mid - s["start"]), abs(mid - s["end"])))
    return nearest["speaker"]


def align_words_to_speakers(words, segments):
    turns = []
    cur = None
    for w in words:
        spk = _speaker_for(w, segments)
        if cur is None or spk != cur["speaker"]:
            if cur is not None:
                cur["text"] = cur["text"].strip()
                turns.append(cur)
            cur = {"speaker": spk, "start": w["start"], "text": ""}
        cur["text"] += w["text"]
    if cur is not None:
        cur["text"] = cur["text"].strip()
        turns.append(cur)
    return turns


def _speaker_label(speaker_id):
    return "Speaker " + speaker_id[len("speaker_"):] if speaker_id.startswith("speaker_") else speaker_id


def render_transcript_body(turns, timestamps=True):
    """Render turns into a '## Transcript' markdown section (no frontmatter).

    This is embedded directly into the recording record's body; there is no
    separate transcript file. `timestamps=True` (audio
    sources) prefixes each turn with `[mm:ss]`; text sources (pasted/labeled)
    pass `timestamps=False` since turns have no wall-clock offsets.
    """
    lines = ["## Transcript", ""]
    for t in turns:
        text = t["text"].strip()
        if not text:
            continue
        if timestamps and isinstance(t.get("start"), (int, float)):
            lines.append(f"[{fmt_ts(t['start'])}] {_speaker_label(t['speaker'])}: {text}")
        else:
            lines.append(f"{_speaker_label(t['speaker'])}: {text}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"
