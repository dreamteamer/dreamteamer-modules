import pytest
from meeting_io import (
    read_meeting,
    write_meeting,
    count_attendees,
    summary_path_for,
    replace_transcript_section,
)


def test_read_meeting_parses_frontmatter_and_body(tmp_path):
    p = tmp_path / "10--10-00--acme--design-review.meeting.md"
    p.write_text("---\ntitle: X\ndate: 2026-06-10\n---\n\n# X\n", encoding="utf-8")
    fm, body = read_meeting(str(p))
    assert fm == {"title": "X", "date": __import__("datetime").date(2026, 6, 10)}
    assert body == "# X\n"


def test_read_meeting_rejects_missing_frontmatter(tmp_path):
    p = tmp_path / "bad.meeting.md"
    p.write_text("no frontmatter here", encoding="utf-8")
    with pytest.raises(ValueError):
        read_meeting(str(p))


def test_write_meeting_roundtrip(tmp_path):
    p = tmp_path / "10--10-00--acme--design-review.meeting.md"
    write_meeting(str(p), {"title": "X", "attendees": ["Alice", "Bob"]}, "# X\n")
    fm, body = read_meeting(str(p))
    assert fm == {"title": "X", "attendees": ["Alice", "Bob"]}
    assert body == "# X\n"


def test_write_meeting_indents_sequences_under_key(tmp_path):
    p = tmp_path / "m.meeting.md"
    write_meeting(str(p), {"attendees": ["Alice", "Bob"]}, "# X\n")
    text = p.read_text(encoding="utf-8")
    assert "attendees:\n  - Alice\n  - Bob\n" in text


def test_count_attendees_present():
    assert count_attendees({"attendees_contacts": ["contacts/a", "contacts/b", "contacts/c"]}) == 3


def test_count_attendees_none_when_absent_or_empty():
    assert count_attendees({"title": "X"}) is None
    assert count_attendees({"attendees_contacts": []}) is None
    # the raw API list is not the count: it includes people who declined
    assert count_attendees({"attendees": [{"email": "a@example.invalid"}]}) is None


def test_summary_path_for():
    md = "data/meetings/2026/06/2026-06-10--10-00--acme--design-review.meeting.md"
    assert summary_path_for(md) == (
        "data/meeting-summaries/2026/06/2026-06-10--10-00--acme--design-review.summary.md"
    )


def test_summary_path_for_a_meeting_inside_its_company_folder():
    # `storage.under`: the meeting sits in the company's folder, the summary does not
    md = "data/companies/acme/meetings/2026/06/2026-06-10--10-00--acme--design-review.meeting.md"
    assert summary_path_for(md) == (
        "data/meeting-summaries/2026/06/2026-06-10--10-00--acme--design-review.summary.md"
    )


def test_summary_path_for_rejects_non_meeting():
    with pytest.raises(ValueError):
        summary_path_for("foo/bar.transcript.md")


def test_asr_cache_path_for_is_local_to_skill(tmp_path, monkeypatch):
    import meeting_io
    monkeypatch.setattr(meeting_io, "ASR_CACHE_DIR", str(tmp_path / "cache" / "asr"))
    md = "data/meetings/2026/06/2026-06-10--10-00--acme--design-review.meeting.md"
    path = meeting_io.asr_cache_path_for(md)
    assert path == str(tmp_path / "cache" / "asr" / "2026-06-10--10-00--acme--design-review.asr.json")
    assert (tmp_path / "cache" / "asr").is_dir()


def test_replace_transcript_section_appends_when_absent():
    body = "# Title\n"
    out = replace_transcript_section(body, "## Transcript\n\nSpeaker 0: Hi\n")
    assert out == "# Title\n\n## Transcript\n\nSpeaker 0: Hi\n"


def test_replace_transcript_section_replaces_existing():
    body = "# Title\n\n## Transcript\n\nSpeaker 0: old\n"
    out = replace_transcript_section(body, "## Transcript\n\nSpeaker 0: new\n")
    assert out == "# Title\n\n## Transcript\n\nSpeaker 0: new\n"
    assert "old" not in out


def test_replace_transcript_section_preserves_content_before_marker():
    body = "# Title\n\nSome description paragraph.\n\n## Transcript\n\nold\n"
    out = replace_transcript_section(body, "## Transcript\n\nnew\n")
    assert "Some description paragraph." in out
    assert "old" not in out
