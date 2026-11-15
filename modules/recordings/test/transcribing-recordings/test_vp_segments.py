"""Voice-print primitives (cr-modules-019 task 1): vectors, turns, windows and body timestamps.

Standard library only, so a bare python3 runs it (vp-segments.test.mjs). Every vector is a synthetic
voice made at run time by vp_synth.py; nothing is read from or written to disk.
"""
from __future__ import annotations

import re
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1] / "skills" / "transcribing-recordings"))

import vp_synth  # noqa: E402
from voiceprints import segments, vec  # noqa: E402


def seg(speaker, start, end):
    return {"speaker": speaker, "start": start, "end": end}


class TurnsTest(unittest.TestCase):
    def test_longest_turn_is_a_run_of_one_label_unbroken_by_another_start(self):
        segs = [
            seg("speaker_0", 0.0, 10.0),
            seg("speaker_0", 10.5, 40.0),   # same turn: nobody else started in between
            seg("speaker_1", 41.0, 50.0),
            seg("speaker_0", 49.0, 60.0),   # starts inside speaker_1's segment: a new turn
            seg("speaker_1", 61.0, 62.0),
            seg("speaker_0", 63.0, 70.0),
        ]
        turns = segments.turns(segs)
        self.assertEqual([t["speaker"] for t in turns],
                         ["speaker_0", "speaker_1", "speaker_0", "speaker_1", "speaker_0"])
        self.assertEqual((turns[0]["start"], turns[0]["end"]), (0.0, 40.0))
        stats = segments.label_stats(segs)
        self.assertAlmostEqual(stats["speaker_0"]["longest_turn"], 40.0)
        self.assertAlmostEqual(stats["speaker_1"]["longest_turn"], 9.0)
        self.assertAlmostEqual(stats["speaker_0"]["seconds"], 10.0 + 29.5 + 11.0 + 7.0)
        self.assertAlmostEqual(stats["speaker_1"]["seconds"], 10.0)
        self.assertAlmostEqual(stats["speaker_0"]["share"] + stats["speaker_1"]["share"], 1.0)

    def test_unsorted_input_gives_the_same_turns(self):
        segs = vp_synth.segments_two([300.0, 30.0], [20.0, 20.0], seg_max=7.0)
        self.assertEqual(segments.turns(list(reversed(segs))), segments.turns(segs))
        longest = segments.label_stats(segs)["speaker_0"]["longest_turn"]
        self.assertAlmostEqual(longest, 300.0)


class DiarizationIdTest(unittest.TestCase):
    def test_id_is_twelve_hex_and_stable(self):
        segs = vp_synth.segments_two([12.0, 8.0], [5.0])
        a = segments.diarization_id(segs)
        self.assertRegex(a, r"^[0-9a-f]{12}$")
        self.assertEqual(a, segments.diarization_id(list(reversed(segs))))
        self.assertEqual(a, segments.diarization_id([dict(s, start=s["start"] + 1e-5) for s in segs]))
        moved = [dict(s) for s in segs]
        moved[1]["end"] += 0.5
        self.assertNotEqual(a, segments.diarization_id(moved))
        relabelled = [dict(s, speaker="speaker_9") if s["speaker"] == "speaker_1" else s for s in segs]
        self.assertNotEqual(a, segments.diarization_id(relabelled))


class WindowsTest(unittest.TestCase):
    def test_a_32_second_segment_cuts_into_6_second_windows(self):
        segs = [seg("speaker_0", 100.0, 132.0), seg("speaker_1", 132.0, 140.0), seg("speaker_0", 140.0, 149.0)]
        wins = segments.cut_windows(segs, "speaker_0")
        long_part = [w for w in wins if w[0] < 132.0]
        self.assertEqual(long_part[0], (100.0, 106.0))
        self.assertEqual([round(e - s, 6) for s, e in long_part], [6.0, 6.0, 6.0, 6.0, 6.0, 2.0])
        for (s1, e1), (s2, _e2) in zip(long_part, long_part[1:]):
            self.assertAlmostEqual(e1, s2)
        self.assertAlmostEqual(long_part[-1][1], 132.0)
        # a segment of 10 s or less is one window, as it is
        self.assertEqual(wins[-1], (140.0, 149.0))
        self.assertEqual(segments.cut_windows(segs, "speaker_1"), [(132.0, 140.0)])

    def test_300_windows_spread_to_80_covering_first_and_last(self):
        wins = [(i * 6.0, i * 6.0 + 6.0) for i in range(300)]
        kept = segments.spread(wins, k=80)
        self.assertEqual(len(kept), 80)
        self.assertEqual(len(set(kept)), 80)
        self.assertEqual(kept[0], wins[0])
        self.assertEqual(kept[-1], wins[-1])
        self.assertEqual(kept, sorted(kept))
        gaps = [b[0] - a[0] for a, b in zip(kept, kept[1:])]
        self.assertLessEqual(max(gaps), 30.0)  # even: 1794 s / 79 is about 22.7 s

    def test_spread_is_over_time_not_over_index(self):
        # 200 windows bunched in the first minute, 100 spread over the next hour
        wins = [(i * 0.3, i * 0.3 + 6.0) for i in range(200)] + [(60.0 + i * 36.0, 66.0 + i * 36.0) for i in range(100)]
        kept = segments.spread(wins, k=80)
        self.assertEqual(len(kept), 80)
        late = [w for w in kept if w[0] >= 60.0]
        self.assertGreater(len(late), 60)

    def test_spread_keeps_everything_under_k(self):
        wins = [(0.0, 6.0), (6.0, 12.0)]
        self.assertEqual(segments.spread(wins, k=80), wins)

    def test_speech_seconds_drops_near_silent_frames(self):
        loud, quiet = 0.1, 0.001  # -20 dBFS and -60 dBFS
        frames = [loud] * 120 + [quiet] * 300 + [0.0] * 50
        self.assertAlmostEqual(segments.speech_seconds(frames), 2.4)
        self.assertLess(segments.speech_seconds([loud] * 99 + [quiet] * 400), 2.0)


class VectorsTest(unittest.TestCase):
    def test_unit_cos_and_mean(self):
        self.assertAlmostEqual(vec.cos([1.0, 0.0], [0.0, 2.0]), 0.0)
        self.assertAlmostEqual(vec.cos([3.0, 4.0], [6.0, 8.0]), 1.0)
        self.assertAlmostEqual(sum(x * x for x in vec.unit([3.0, 4.0])), 1.0)
        m = vec.mean_unit([[1.0, 0.0], [0.0, 5.0]])
        self.assertAlmostEqual(m[0], m[1])
        self.assertAlmostEqual(sum(x * x for x in m), 1.0)

    def test_robust_centroid_survives_a_fifth_of_outliers(self):
        voice = vp_synth.voice(1)
        other = vp_synth.voice(2)
        wins = vp_synth.windows(voice, 64, noise=0.6, seed=3) + vp_synth.windows(other, 16, noise=0.6, seed=4)
        robust = vec.robust_centroid(wins)
        self.assertGreater(vec.cos(robust, voice), 0.95)
        self.assertGreater(vec.cos(robust, voice), vec.cos(vec.mean_unit(wins), voice))
        self.assertAlmostEqual(sum(x * x for x in robust), 1.0)

    def test_two_means_splits_a_mixed_label(self):
        a, b = vp_synth.voice(10), vp_synth.voice(11)
        wins = vp_synth.mixed(a, b, 60, 0.4, seed=5)
        big, small, share, groups = vec.two_means(wins)
        self.assertAlmostEqual(share, 0.4, delta=0.05)
        self.assertLess(vec.cos(big, small), 0.55)
        self.assertGreater(vec.cos(big, a), 0.9)
        self.assertGreater(vec.cos(small, b), 0.9)
        self.assertEqual(len(groups), 60)
        self.assertEqual(groups.count(1), round(share * 60))
        self.assertEqual(vec.two_means(wins), (big, small, share, groups))

    def test_two_means_on_one_voice_finds_no_split(self):
        wins = vp_synth.windows(vp_synth.voice(20), 60, seed=6)
        big, small, _share, _groups = vec.two_means(wins)
        self.assertGreater(vec.cos(big, small), 0.55)


class BodyTurnsTest(unittest.TestCase):
    HEBREW = "\u05e9\u05dc\u05d5\u05dd \u05dc\u05db\u05d5\u05dc\u05dd"  # Hebrew, as escapes: no Hebrew codepoints in the repository

    def body(self):
        return "\n".join([
            "## Transcript",
            "",
            "[00:03] Speaker 1: Morning, Dana.",
            "",
            "[02:14] Speaker 0: Thanks for joining from Northwind.",
            "",
            f"[100:05] Speaker 1: {self.HEBREW}",
            "",
            "**[1:40:05] Speaker 12:** Back to the Harbor Mutual numbers.",
            "",
            "Speaker 0: an untimed line maps nothing",
            "",
        ])

    def test_reads_mm_ss_long_minutes_and_hours(self):
        turns = segments.parse_body_turns(self.body())
        self.assertEqual([(t["label"], t["start"]) for t in turns], [
            ("speaker_1", 3.0),
            ("speaker_0", 134.0),
            ("speaker_1", 6005.0),
            ("speaker_12", 6005.0),
        ])

    def test_text_is_the_rest_of_the_line(self):
        turns = segments.parse_body_turns(self.body())
        self.assertEqual(turns[1]["text"], "Thanks for joining from Northwind.")
        self.assertEqual(turns[2]["text"], self.HEBREW)
        self.assertEqual(turns[3]["text"], "Back to the Harbor Mutual numbers.")

    def test_a_body_with_no_timestamps_maps_nothing(self):
        self.assertEqual(segments.parse_body_turns("## Transcript\n\nSpeaker 0: hello\n"), [])

    def test_render_output_round_trips(self):
        import render
        body = render.render_transcript_body([
            {"speaker": "speaker_0", "start": 5.2, "text": "hello"},
            {"speaker": "speaker_1", "start": 6005.9, "text": "later"},
        ])
        turns = segments.parse_body_turns(body)
        self.assertEqual([(t["label"], t["start"], t["text"]) for t in turns],
                         [("speaker_0", 5.0, "hello"), ("speaker_1", 6005.0, "later")])

    def test_body_spans_and_overlap_map(self):
        turns = segments.parse_body_turns(self.body())[:3]
        spans = segments.body_spans(turns, duration=6100.0)
        self.assertEqual(spans, {
            "speaker_1": [(3.0, 134.0), (6005.0, 6100.0)],
            "speaker_0": [(134.0, 6005.0)],
        })
        new = [seg("speaker_0", 0.0, 140.0), seg("speaker_1", 140.0, 6000.0), seg("speaker_0", 6000.0, 6100.0)]
        m = segments.overlap_map(spans, new)
        self.assertEqual(m["speaker_0"]["new_label"], "speaker_1")
        self.assertAlmostEqual(m["speaker_0"]["share"], 5860.0 / 5871.0)
        self.assertEqual(m["speaker_1"]["new_label"], "speaker_0")
        self.assertAlmostEqual(m["speaker_1"]["share"], (131.0 + 95.0) / 226.0)
        self.assertEqual(segments.overlap_map({"speaker_5": [(9000.0, 9010.0)]}, new),
                         {"speaker_5": {"new_label": None, "share": 0.0}})


class SynthTest(unittest.TestCase):
    def test_voices_are_seeded_unit_and_any_dimension(self):
        self.assertEqual(vp_synth.voice(7), vp_synth.voice(7))
        self.assertNotEqual(vp_synth.voice(7), vp_synth.voice(8))
        v = vp_synth.voice(7, dim=192)
        self.assertEqual(len(v), 192)
        self.assertAlmostEqual(sum(x * x for x in v), 1.0)
        self.assertLess(abs(vec.cos(vp_synth.voice(1, dim=192), vp_synth.voice(2, dim=192))), 0.3)

    def test_near_gives_the_asked_cosine(self):
        v = vp_synth.voice(3, dim=192)
        for c in (0.95, 0.8, 0.5, 0.0):
            self.assertAlmostEqual(vec.cos(vp_synth.near(v, c, seed=1), v), c, places=9)
        self.assertEqual(vp_synth.near(v, 0.8, seed=2), vp_synth.near(v, 0.8, seed=2))

    def test_windows_and_mixed_are_deterministic(self):
        a, b = vp_synth.voice(1), vp_synth.voice(2)
        self.assertEqual(vp_synth.windows(a, 5, seed=1), vp_synth.windows(a, 5, seed=1))
        w = vp_synth.mixed(a, b, 50, 0.3, seed=2)
        self.assertEqual(len(w), 50)
        self.assertEqual(sum(1 for x in w if vec.cos(x, b) > vec.cos(x, a)), 15)

    def test_segments_two_lays_out_alternating_turns(self):
        segs = vp_synth.segments_two([30.0, 10.0], [20.0], seg_max=12.0)
        self.assertEqual([s["speaker"] for s in segs],
                         ["speaker_0"] * 3 + ["speaker_1"] * 2 + ["speaker_0"])
        self.assertEqual(segs[0]["start"], 0.0)
        self.assertAlmostEqual(segs[-1]["end"], 60.0)
        self.assertTrue(all(re.match(r"^speaker_\d+$", s["speaker"]) for s in segs))


if __name__ == "__main__":
    unittest.main()
