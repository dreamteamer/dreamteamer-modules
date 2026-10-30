"""Record file I/O: read/write a markdown record's frontmatter + body, derive sibling paths.

A transcribed recording is one markdown record: YAML frontmatter plus a body
that carries a `## Transcript` section directly — there is no separate
transcript file. Raw ASR JSON lives in the per-machine transcription cache
(`locations.asr_cache_dir`, TRANSCRIBING_CACHE_DIR), never under data/ and never
beside the skill.

PyYAML is imported where it is used, so the path helpers load under a bare python3.
"""
import os
import re

import locations


def _indent_dumper():
    """A SafeDumper that indents block-sequence items under their parent key
    (readable, matches hand-written frontmatter style)."""
    import yaml

    class _IndentDumper(yaml.SafeDumper):
        def increase_indent(self, flow=False, indentless=False):
            return super().increase_indent(flow, False)

    return _IndentDumper


def read_meeting(meeting_md):
    """Read a markdown record into (frontmatter: dict, body: str)."""
    with open(meeting_md, encoding="utf-8") as f:
        text = f.read()
    if not text.startswith("---\n"):
        raise ValueError(f"meeting file has no YAML frontmatter: {meeting_md}")
    close = text.index("\n---", 4)
    import yaml
    fm = yaml.safe_load(text[4:close]) or {}
    body = text[close + 4:].lstrip("\n")
    return fm, body


def write_meeting(meeting_md, frontmatter, body):
    """Write (frontmatter, body) back out to a markdown record."""
    import yaml
    fm_text = yaml.dump(
        frontmatter, Dumper=_indent_dumper(), allow_unicode=True, sort_keys=False, width=100,
    )
    text = f"---\n{fm_text}---\n\n{body.strip()}\n"
    with open(meeting_md, "w", encoding="utf-8") as f:
        f.write(text)


def count_attendees(frontmatter):
    """Number of attendees in frontmatter, or None if absent/empty.

    Used as the expected speaker count for diarization (best for 1:1s and
    small meetings).
    """
    attendees = frontmatter.get("attendees_contacts")
    return len(attendees) if attendees else None


def summary_path_for(meeting_md):
    """Mirror a .meeting.md path into data/meeting-summaries/, same YYYY/MM shard.

    A meeting may live INSIDE its company's folder (`storage.under`:
    `data/companies/<id>/meetings/2026/06/x.meeting.md`), so the summaries root is
    the DATA root plus `meeting-summaries`, not the `meetings` component swapped in
    place — that would put the summary inside the company folder too, where no
    collection reads it. The shard is whatever sits between `meetings/` and the file.
    """
    if not meeting_md.endswith(".meeting.md"):
        raise ValueError(f"not a .meeting.md path: {meeting_md}")
    parts = meeting_md.split(os.sep)
    try:
        idx = len(parts) - 1 - parts[::-1].index("meetings")
    except ValueError:
        raise ValueError(f"no 'meetings' directory component in path: {meeting_md}")
    # the data root: the nearest `data` component above `meetings`, else the folder holding it
    data_idx = next((i for i in range(idx - 1, -1, -1) if parts[i] == "data"), idx - 1)
    base = os.path.basename(meeting_md)[: -len(".meeting.md")]
    shard = parts[idx + 1 : -1]
    return os.sep.join(parts[: data_idx + 1] + ["meeting-summaries"] + shard + [f"{base}.summary.md"])


def asr_cache_path_for(record_md):
    """Where a record's raw ASR JSON is cached: the per-machine transcription cache
    (TRANSCRIBING_CACHE_DIR, default ~/.cache/dreamteamer/transcription-cache), in
    `asr/`. Not committed, regenerable, and never under data/ or inside the skill.

    Suffix-agnostic: any `.<suffix>.md` record name (`.meeting-recording.md`, say)
    loses just its suffix.
    """
    folder = locations.asr_cache_dir()
    os.makedirs(folder, exist_ok=True)
    base = re.sub(r"\.[a-z-]+\.md$", "", os.path.basename(record_md))
    return os.path.join(folder, f"{base}.asr.json")


def replace_transcript_section(body, new_section):
    """Replace the '## Transcript' section of a record body, or append it.

    Everything from the first '## Transcript' heading to the end of the body
    is treated as the transcript and replaced; content before it (the title
    heading, any other sections) is preserved.
    """
    marker = "## Transcript"
    idx = body.find(marker)
    head = (body[:idx] if idx != -1 else body).rstrip()
    return (f"{head}\n\n{new_section}" if head else new_section).strip() + "\n"
