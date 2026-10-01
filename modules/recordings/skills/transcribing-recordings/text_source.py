"""Text-source ingest: parse speaker-labeled transcripts and log turns to disk."""
import json
import re

from render import render_transcript_body
from meeting_io import read_meeting, write_meeting, replace_transcript_section

# Matches a speaker-turn opener: "Name: text" where Name contains no colon.
_TURN_RE = re.compile(r'^([^:\n]+?):\s*(.*)')


def parse_labeled(text: str) -> dict:
    """Parse a speaker-labeled transcript into a turns.json dict.

    Each line that starts with ``Name: text`` opens a new turn; subsequent
    lines without a speaker prefix continue the previous turn's text.
    Blank lines are skipped.  Distinct speaker names are mapped to
    ``speaker_0``, ``speaker_1``, … in order of first appearance.

    Returns a dict with keys source, method, speakers, turns — ready to
    pass to ``log()`` or ``render_transcript()``.
    """
    raw_turns: list[tuple[str, list[str]]] = []
    cur_name: str | None = None
    cur_parts: list[str] = []

    for line in text.splitlines():
        m = _TURN_RE.match(line)
        if m:
            name = m.group(1).strip()
            first = m.group(2).strip()
            if cur_name is not None and cur_parts:
                raw_turns.append((cur_name, cur_parts))
            cur_name = name
            cur_parts = [first] if first else []
        else:
            stripped = line.strip()
            if stripped and cur_name is not None:
                cur_parts.append(stripped)

    if cur_name is not None and cur_parts:
        raw_turns.append((cur_name, cur_parts))

    # Map names → speaker_N in order of first appearance.
    name_to_id: dict[str, str] = {}
    for name, _ in raw_turns:
        if name not in name_to_id:
            name_to_id[name] = f"speaker_{len(name_to_id)}"

    speakers = {sid: name for name, sid in name_to_id.items()}
    turns = [
        {"speaker": name_to_id[name], "text": " ".join(parts)}
        for name, parts in raw_turns
        if parts
    ]

    return {
        "source": "pasted",
        "method": "verbatim-labeled",
        "speakers": speakers,
        "turns": turns,
    }


def log(meeting_md: str, turns_json_path: str, generated: str) -> dict:
    """Universal writer for text-source transcripts.

    Reads turns.json (schema: source, method, optional language, optional
    speakers, turns[]), embeds a '## Transcript' section directly into the
    meeting's body, and stamps a `transcription:` block into its frontmatter.
    No .asr.json is written (text sources only — there's no raw ASR to cache).
    """
    with open(turns_json_path, encoding="utf-8") as f:
        data = json.load(f)

    turns = data["turns"]
    fm, body = read_meeting(meeting_md)
    fm["transcription"] = {
        "generated": generated,
        "source": data["source"],
        "method": data["method"],
        "language": data.get("language", ["und"]),
        "speaker_count": len({t["speaker"] for t in turns}),
        "speakers": data.get("speakers", {}),
    }
    body = replace_transcript_section(body, render_transcript_body(turns, timestamps=False))
    write_meeting(meeting_md, fm, body)

    summary = {
        "source": data["source"],
        "method": data["method"],
        "language": fm["transcription"]["language"],
        "speaker_count": fm["transcription"]["speaker_count"],
        "meeting": meeting_md,
    }
    return summary
