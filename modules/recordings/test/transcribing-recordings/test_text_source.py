"""Tests for text-source ingest: parse_labeled and log()."""
import json

from render import render_transcript_body
from text_source import parse_labeled, log
from meeting_io import read_meeting


# ---------------------------------------------------------------------------
# parse_labeled
# ---------------------------------------------------------------------------

LABELED_TWO_SPEAKER = """\
Alice: Hello everyone, welcome to the meeting.
Bob: Thanks for having me.
I wanted to follow up on last week's actions.
Alice: Sure, let's go through them one by one.
"""

LABELED_SINGLE_SPEAKER = """\
Alice: This is a voice note. I wanted to jot down my thoughts.
Here are some follow-up items.
Let me know if you need anything else.
"""

LABELED_BLANK_LINES = """\
Alice: First point.

Bob: Second point.

Alice: Third point.
More of Alice's third point.
"""


def test_parse_labeled_two_speakers():
    result = parse_labeled(LABELED_TWO_SPEAKER)
    assert result["source"] == "pasted"
    assert result["method"] == "verbatim-labeled"
    assert result["speakers"] == {"speaker_0": "Alice", "speaker_1": "Bob"}
    turns = result["turns"]
    assert len(turns) == 3
    assert turns[0] == {"speaker": "speaker_0", "text": "Hello everyone, welcome to the meeting."}
    assert turns[1]["speaker"] == "speaker_1"
    assert "Thanks for having me." in turns[1]["text"]
    assert "follow up on last week" in turns[1]["text"]
    assert turns[2] == {"speaker": "speaker_0", "text": "Sure, let's go through them one by one."}


def test_parse_labeled_multiline_turn_joins_with_space():
    result = parse_labeled(LABELED_TWO_SPEAKER)
    # Bob's turn has two lines — joined by a single space, no double-space
    bob_turn = result["turns"][1]["text"]
    assert "  " not in bob_turn  # no double spaces
    assert bob_turn.startswith("Thanks for having me.")
    assert bob_turn.endswith("last week's actions.")


def test_parse_labeled_single_speaker():
    result = parse_labeled(LABELED_SINGLE_SPEAKER)
    assert result["speakers"] == {"speaker_0": "Alice"}
    turns = result["turns"]
    assert len(turns) == 1
    assert turns[0]["speaker"] == "speaker_0"
    # All continuation lines joined into the single turn
    assert "voice note" in turns[0]["text"]
    assert "follow-up items" in turns[0]["text"]
    assert "need anything else" in turns[0]["text"]


def test_parse_labeled_blank_lines_skipped():
    result = parse_labeled(LABELED_BLANK_LINES)
    turns = result["turns"]
    assert len(turns) == 3
    assert turns[0] == {"speaker": "speaker_0", "text": "First point."}
    assert turns[1] == {"speaker": "speaker_1", "text": "Second point."}
    assert turns[2]["speaker"] == "speaker_0"
    assert "Third point." in turns[2]["text"]
    assert "More of Alice" in turns[2]["text"]


def test_parse_labeled_speaker_order_preserved():
    result = parse_labeled(LABELED_TWO_SPEAKER)
    # Alice appears first → speaker_0; Bob appears second → speaker_1
    assert result["speakers"]["speaker_0"] == "Alice"
    assert result["speakers"]["speaker_1"] == "Bob"


# ---------------------------------------------------------------------------
# render_transcript_body — text source (no timestamps)
# ---------------------------------------------------------------------------

def test_render_text_source_no_timestamps():
    turns = [
        {"speaker": "speaker_0", "text": "Hello everyone."},
        {"speaker": "speaker_1", "text": "Good morning."},
    ]
    out = render_transcript_body(turns, timestamps=False)
    assert "Speaker 0: Hello everyone.\n" in out
    assert "Speaker 1: Good morning.\n" in out
    assert "[00:" not in out


# ---------------------------------------------------------------------------
# log() — integration: embeds transcript in body, stamps transcription: in frontmatter
# ---------------------------------------------------------------------------

MINIMAL_MEETING_MD = """\
---
title: Acme Standup
date: 2026-06-10
attendees:
  - alice@acme.example (self)
  - bob@acme.example
---

# Acme Standup
"""


def test_log_embeds_transcript_and_stamps_frontmatter(tmp_path):
    meeting_md = tmp_path / "2026-06-10--10-00--acme--standup.meeting.md"
    meeting_md.write_text(MINIMAL_MEETING_MD, encoding="utf-8")

    turns_data = {
        "source": "pasted",
        "method": "verbatim-labeled",
        "language": ["en"],
        "speakers": {"speaker_0": "Alice", "speaker_1": "Bob"},
        "turns": [
            {"speaker": "speaker_0", "text": "Hello."},
            {"speaker": "speaker_1", "text": "Hi there."},
        ],
    }
    turns_json = tmp_path / "turns.json"
    turns_json.write_text(json.dumps(turns_data), encoding="utf-8")

    summary = log(str(meeting_md), str(turns_json), "2026-06-30")

    fm, body = read_meeting(str(meeting_md))
    assert fm["transcription"]["source"] == "pasted"
    assert fm["transcription"]["method"] == "verbatim-labeled"
    assert fm["transcription"]["speakers"] == {"speaker_0": "Alice", "speaker_1": "Bob"}
    assert fm["transcription"]["speaker_count"] == 2
    assert "## Transcript" in body
    assert "Speaker 0: Hello.\n" in body
    assert "Speaker 1: Hi there.\n" in body
    assert "[00:" not in body
    # Title heading preserved above the transcript section
    assert body.index("# Acme Standup") < body.index("## Transcript")

    assert summary["source"] == "pasted"
    assert summary["method"] == "verbatim-labeled"
    assert summary["speaker_count"] == 2


def test_log_no_asr_json_written(tmp_path):
    """log() must NOT write any .asr.json file (text sources only)."""
    meeting_md = tmp_path / "2026-06-10--10-00--acme--standup.meeting.md"
    meeting_md.write_text(MINIMAL_MEETING_MD, encoding="utf-8")
    turns_data = {
        "source": "pasted",
        "method": "verbatim-single",
        "turns": [{"speaker": "speaker_0", "text": "A note."}],
    }
    turns_json = tmp_path / "turns.json"
    turns_json.write_text(json.dumps(turns_data), encoding="utf-8")
    log(str(meeting_md), str(turns_json), "2026-06-30")
    assert list(tmp_path.glob("*.asr.json")) == []


def test_log_replaces_prior_transcript_section(tmp_path):
    meeting_md = tmp_path / "2026-06-10--10-00--acme--standup.meeting.md"
    meeting_md.write_text(MINIMAL_MEETING_MD, encoding="utf-8")
    turns_json = tmp_path / "turns.json"

    turns_json.write_text(json.dumps({
        "source": "pasted", "method": "verbatim-single",
        "turns": [{"speaker": "speaker_0", "text": "First version."}],
    }), encoding="utf-8")
    log(str(meeting_md), str(turns_json), "2026-06-30")

    turns_json.write_text(json.dumps({
        "source": "pasted", "method": "verbatim-single",
        "turns": [{"speaker": "speaker_0", "text": "Second version."}],
    }), encoding="utf-8")
    log(str(meeting_md), str(turns_json), "2026-07-01")

    _, body = read_meeting(str(meeting_md))
    assert "First version" not in body
    assert "Second version" in body
    assert body.count("## Transcript") == 1
