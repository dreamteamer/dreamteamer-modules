from render import fmt_ts, align_words_to_speakers, render_transcript_body


def test_fmt_ts():
    assert fmt_ts(0) == "00:00"
    assert fmt_ts(21) == "00:21"
    assert fmt_ts(3540) == "59:00"
    assert fmt_ts(None) == "??:??"


def test_align_merges_consecutive_same_speaker():
    words = [
        {"start": 0.0, "end": 0.4, "text": "Hi"},
        {"start": 0.5, "end": 0.9, "text": " there"},
        {"start": 2.0, "end": 2.4, "text": "Hello"},
    ]
    segments = [
        {"speaker": "speaker_0", "start": 0.0, "end": 1.0},
        {"speaker": "speaker_1", "start": 1.5, "end": 3.0},
    ]
    assert align_words_to_speakers(words, segments) == [
        {"speaker": "speaker_0", "start": 0.0, "text": "Hi there"},
        {"speaker": "speaker_1", "start": 2.0, "text": "Hello"},
    ]


def test_align_no_segments_defaults_speaker_0():
    words = [{"start": 0.0, "end": 0.4, "text": "Hi"}]
    assert align_words_to_speakers(words, []) == [
        {"speaker": "speaker_0", "start": 0.0, "text": "Hi"}
    ]


def test_align_word_outside_all_segments_uses_nearest():
    words = [{"start": 5.0, "end": 5.4, "text": "Late"}]
    segments = [{"speaker": "speaker_1", "start": 0.0, "end": 1.0}]
    assert align_words_to_speakers(words, segments) == [
        {"speaker": "speaker_1", "start": 5.0, "text": "Late"}
    ]


def test_render_transcript_body_with_timestamps():
    turns = [
        {"speaker": "speaker_0", "start": 0.0, "text": "Hi there"},
        {"speaker": "speaker_1", "start": 2.0, "text": "Hello"},
    ]
    assert render_transcript_body(turns, timestamps=True) == (
        "## Transcript\n"
        "\n"
        "[00:00] Speaker 0: Hi there\n"
        "\n"
        "[00:02] Speaker 1: Hello\n"
    )


def test_render_transcript_body_without_timestamps():
    turns = [
        {"speaker": "speaker_0", "text": "Hello everyone."},
        {"speaker": "speaker_1", "text": "Good morning."},
    ]
    out = render_transcript_body(turns, timestamps=False)
    assert out == (
        "## Transcript\n"
        "\n"
        "Speaker 0: Hello everyone.\n"
        "\n"
        "Speaker 1: Good morning.\n"
    )
    assert "[00:" not in out


def test_render_transcript_body_skips_blank_turns():
    turns = [
        {"speaker": "speaker_0", "start": 0.0, "text": "  "},
        {"speaker": "speaker_1", "start": 1.0, "text": "Real content"},
    ]
    out = render_transcript_body(turns)
    assert "Speaker 0:" not in out
    assert "Speaker 1: Real content" in out
