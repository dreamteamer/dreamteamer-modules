"""The per-user voice-print store (cr-modules-019 task 2): where it lives, where it is refused, its
layout, atomic writes, the advisory lock, and the model pin.

Standard library only, so a bare python3 runs it (vp-store.test.mjs). Every store is made in a temp
directory with HOME pointed at a temp folder, so the real home and the real store are never touched;
`exclude_backup` is always a fake, so `tmutil` never runs. Every vector is a synthetic voice made at
run time by vp_synth.py.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
SKILL = HERE.parents[1] / "skills" / "transcribing-recordings"
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(SKILL))

import vp_synth  # noqa: E402
from voiceprints import store  # noqa: E402

POSIX = os.name == "posix"
MODEL_A = store.Model("eres2netv2-test", "a" * 64, 64)
MODEL_B = store.Model("campplus-test", "b" * 64, 64)
AUDIO = "ab" + "12" * 31
CAST = ("Dana Oren", "Sam Diaz", "Priya Raman", "Tom Whitfield")


def no_exclude(home):
    return None


class Tmp(unittest.TestCase):
    """A temp root with HOME pointed inside it; every path a test touches is under `self.root`."""

    def setUp(self):
        self._td = tempfile.TemporaryDirectory()
        self.root = os.path.realpath(self._td.name)
        self.home_dir = os.path.join(self.root, "home")
        os.makedirs(self.home_dir)
        env = mock.patch.dict(os.environ, {"HOME": self.home_dir, "USERPROFILE": self.home_dir})
        env.start()
        self.addCleanup(env.stop)
        self.addCleanup(self._td.cleanup)

    def path(self, *parts):
        return os.path.join(self.root, *parts)

    def tree(self):
        """Every path under the temp root, for asserting that nothing was created."""
        out = set()
        for d, dirs, files in os.walk(self.root):
            for n in dirs + files:
                out.add(os.path.join(d, n))
        return out

    def guard(self, **kw):
        g = {"workspace": self.path("ws"), "files_folder": None, "inbox_folders": []}
        g.update(kw)
        return g

    def new_store(self, name="vp", exclude=no_exclude):
        return store.Store(self.path(name), exclude_backup=exclude)


def signature(audio=AUDIO, diar="7c1d09a4e2b1", model=MODEL_A, seed=1):
    a, b = vp_synth.voice(f"sig-a-{seed}"), vp_synth.voice(f"sig-b-{seed}")
    return {
        "version": 1,
        "audio": audio,
        "diarization": {"id": diar, "labels": 2, "speakers_hint": 2, "fallback": None},
        "model": model._asdict(),
        "labels": {
            "speaker_0": {"seconds": 41.0, "share": 0.54, "longest_turn": 12.0,
                          "windows": [{"start": 1.0 + i * 6, "end": 7.0 + i * 6, "vector": w}
                                      for i, w in enumerate(vp_synth.windows(a, 3, seed=(seed, "a")))]},
            "speaker_1": {"seconds": 35.0, "share": 0.46, "longest_turn": 9.0,
                          "windows": [{"start": 50.0 + i * 6, "end": 56.0 + i * 6, "vector": w}
                                      for i, w in enumerate(vp_synth.windows(b, 3, seed=(seed, "b")))]},
        },
    }


def a_print(pid="p-3f9a1c2e", model=MODEL_A):
    return {
        "version": 1, "id": pid,
        "known_as": [{"workspace": "northwind-hq", "person": "users/dana-oren", "name": "Dana Oren"}],
        "model": model._asdict(), "vector": vp_synth.voice("print-dana"), "seconds": 61.0,
        "trust": "trusted", "auto": True, "sources": [], "negatives": [],
        "created": "2026-11-20", "updated": "2026-11-21",
    }


# --------------------------------------------------------------------------------------------------
class DefaultHomeTest(unittest.TestCase):
    def test_darwin(self):
        self.assertEqual(store.default_home("darwin", {"HOME": "/h/dana"}),
                         "/h/dana/Library/Application Support/dreamteamer/voice-prints")

    def test_linux_without_xdg(self):
        self.assertEqual(store.default_home("linux", {"HOME": "/h/dana"}),
                         "/h/dana/.local/share/dreamteamer/voice-prints")

    def test_linux_with_xdg(self):
        self.assertEqual(store.default_home("linux", {"HOME": "/h/dana", "XDG_DATA_HOME": "/data/dana"}),
                         "/data/dana/dreamteamer/voice-prints")

    def test_linux_empty_or_relative_xdg_is_ignored(self):
        for xdg in ("", "rel/data"):
            self.assertEqual(store.default_home("linux", {"HOME": "/h/dana", "XDG_DATA_HOME": xdg}),
                             "/h/dana/.local/share/dreamteamer/voice-prints")

    def test_win32(self):
        self.assertEqual(store.default_home("win32", {"LOCALAPPDATA": "D:\\Local"}),
                         "D:\\Local\\dreamteamer\\voice-prints")

    def test_override_wins_and_expands_tilde(self):
        for plat in ("darwin", "linux", "win32"):
            self.assertEqual(store.default_home(plat, {"HOME": "/h/dana", "LOCALAPPDATA": "D:\\Local",
                                                       "VOICE_PRINTS_HOME": "/srv/vp"}), "/srv/vp")
        self.assertEqual(store.default_home("linux", {"HOME": "/h/dana", "VOICE_PRINTS_HOME": "~/vp"}),
                         "/h/dana/vp")

    def test_empty_override_is_no_override(self):
        self.assertEqual(store.default_home("linux", {"HOME": "/h/dana", "VOICE_PRINTS_HOME": ""}),
                         "/h/dana/.local/share/dreamteamer/voice-prints")


# --------------------------------------------------------------------------------------------------
class Line13(Tmp):
    """A print store located inside a repository, inside the workspace or its files and inbox folders,
    or inside a folder the module recognises as synced or cloud-backed is refused before anything is
    written"""

    def assertRefused(self, home, guard=None, ensure_too=True):
        guard = guard if guard is not None else self.guard()
        before = self.tree()
        with self.assertRaises(store.StoreRefused) as cm:
            store.check_location(home, guard)
        self.assertTrue(cm.exception.reason)
        self.assertEqual(self.tree(), before, "check_location created something")
        if ensure_too:
            calls = []
            s = store.Store(home, exclude_backup=calls.append, guard=guard)
            with self.assertRaises(store.StoreRefused):
                s.ensure()
            with self.assertRaises(store.StoreRefused):
                s.write_json(os.path.join(home, "x.json"), {"a": 1})
            with self.assertRaises(store.StoreRefused):
                with s.lock(None):
                    pass
            self.assertEqual(calls, [])
            self.assertEqual(self.tree(), before, "a refused store created something")
        return cm.exception

    def test_a_plain_folder_is_accepted(self):
        store.check_location(self.path("plain", "voice-prints"), self.guard())

    def test_inside_a_git_working_tree(self):
        os.makedirs(self.path("repo", ".git"))
        e = self.assertRefused(self.path("repo", "deep", "voice-prints"))
        self.assertIn("git", e.reason)
        self.assertFalse(os.path.exists(self.path("repo", "deep")))

    def test_a_git_file_marks_a_worktree_too(self):
        os.makedirs(self.path("wt"))
        Path(self.path("wt", ".git")).write_text("gitdir: elsewhere\n")
        self.assertRefused(self.path("wt", "voice-prints"))

    def test_inside_the_workspace(self):
        os.makedirs(self.path("ws"))
        self.assertRefused(self.path("ws", ".voice-prints"))
        self.assertRefused(self.path("ws"))

    def test_inside_a_files_folder(self):
        os.makedirs(self.path("files"))
        self.assertRefused(self.path("files", "vp"), self.guard(files_folder=self.path("files")))

    def test_inside_the_second_inbox_root(self):
        os.makedirs(self.path("in1"))
        os.makedirs(self.path("in2"))
        g = self.guard(inbox_folders=[self.path("in1"), self.path("in2")])
        self.assertRefused(self.path("in2", "nested", "vp"), g)
        self.assertFalse(os.path.exists(self.path("in2", "nested")))
        # a newline-separated INBOX_FOLDERS string is read the same way
        self.assertRefused(self.path("in2", "vp"),
                           self.guard(inbox_folders=self.path("in1") + "\n" + self.path("in2")))

    def test_under_library_mobile_documents_and_cloudstorage(self):
        for where in (("Library", "Mobile Documents", "x"), ("Library", "CloudStorage", "Box-Box", "x")):
            e = self.assertRefused(os.path.join(self.home_dir, *where))
            self.assertTrue(e.reason)
        self.assertFalse(os.path.exists(os.path.join(self.home_dir, "Library")))

    def test_a_folder_named_for_a_sync_service(self):
        for name in ("Dropbox", "dropbox", "OneDrive - Northwind", "Google Drive", "iCloud Drive",
                     "Box Sync", "Nextcloud", "Syncthing", "MEGA"):
            e = self.assertRefused(self.path(name, "x"))
            self.assertIn("sync", e.reason.lower())
            self.assertFalse(os.path.exists(self.path(name)))

    def test_a_name_that_only_contains_a_sync_word_is_accepted(self):
        store.check_location(self.path("dropboxes-old", "vp"), self.guard())
        store.check_location(self.path("Boxing", "vp"), self.guard())

    def test_a_sync_name_with_a_team_or_account_suffix(self):
        # Dropbox's team-folder form, the hyphenated account forms, and the spaced-dash form
        for name in ("Dropbox (Northwind)", "dropbox (northwind)", "Dropbox-Northwind", "OneDrive-Northwind",
                     "OneDrive - Harbor Mutual", "Google Drive (Northwind)", "Google Drive-Northwind",
                     "Box (Northwind)", "Sync (Northwind)", "MEGA - Northwind", "Nextcloud-Northwind",
                     "Syncthing-Northwind"):
            e = self.assertRefused(self.path(name, "voice-prints"))
            self.assertIn("sync", e.reason.lower(), name)
            self.assertFalse(os.path.exists(self.path(name)), name)

    def test_ordinary_words_that_start_with_a_sync_name_are_accepted(self):
        # Box, Sync and MEGA are ordinary words: a bare hyphen after them is not an account suffix,
        # and no suffix at all is not a sync folder
        for name in ("Boxes", "Boxing", "Synchronised", "Syncopation", "Megaphone", "Box-art", "sync-scripts",
                     "mega-project", "dropboxes-old", "OneDriver"):
            store.check_location(self.path(name, "vp"), self.guard())

    def assertSubfolderRefused(self, s, write, outside):
        """`write` against store `s` is refused, and nothing is created anywhere under the temp root —
        in particular nothing at `outside`, the folder the link points at."""
        before = self.tree()
        with self.assertRaises(store.StoreRefused) as cm:
            write()
        self.assertIn("link", cm.exception.reason)
        self.assertEqual(self.tree(), before, "a refused write created something")
        if os.path.isdir(outside):
            self.assertEqual(os.listdir(outside), [])
        return cm.exception

    @unittest.skipUnless(POSIX, "symlinks")
    def test_a_model_folder_linked_into_a_synced_folder_receives_nothing(self):
        s = store.Store(self.path("vp"), exclude_backup=no_exclude, guard=self.guard())
        s.ensure()
        os.makedirs(self.path("Dropbox", "stolen"))
        os.symlink(self.path("Dropbox", "stolen"), s.model_dir("m1"))
        out = self.path("Dropbox", "stolen")
        self.assertSubfolderRefused(s, lambda: s.write_print("m1", a_print("p-1")), out)
        self.assertSubfolderRefused(s, lambda: s.write_signature("m1", signature(),
                                                                 record={"workspace": "w", "record": "r"}), out)

        def take():
            with s.lock("m1"):
                pass
        self.assertSubfolderRefused(s, take, out)
        self.assertSubfolderRefused(s, lambda: s.remove_windows("m1", AUDIO, "7c1d09a4e2b1", "speaker_0"), out)

    @unittest.skipUnless(POSIX, "symlinks")
    def test_a_dangling_model_folder_link_creates_no_target(self):
        s = store.Store(self.path("vp"), exclude_backup=no_exclude, guard=self.guard())
        s.ensure()
        os.symlink(self.path("Dropbox", "not-yet", "m1"), s.model_dir("m1"))
        self.assertSubfolderRefused(s, lambda: s.write_print("m1", a_print("p-1")), self.path("Dropbox"))
        self.assertFalse(os.path.exists(self.path("Dropbox")))

    @unittest.skipUnless(POSIX, "symlinks")
    def test_a_prints_signatures_or_labels_folder_linked_out_receives_nothing(self):
        s = store.Store(self.path("vp"), exclude_backup=no_exclude, guard=self.guard())
        s.ensure()
        os.makedirs(self.path("elsewhere", "a"))
        os.makedirs(self.path("elsewhere", "b"))
        os.makedirs(self.path("elsewhere", "c"))
        os.makedirs(os.path.join(s.model_dir("m1"), "signatures"))
        os.symlink(self.path("elsewhere", "a"), os.path.join(s.model_dir("m1"), "prints"))
        os.symlink(self.path("elsewhere", "b"), os.path.join(s.model_dir("m1"), "signatures", AUDIO[:2]))
        os.symlink(self.path("elsewhere", "c"), s.calibration_labels_dir())
        self.assertSubfolderRefused(s, lambda: s.write_print("m1", a_print("p-1")), self.path("elsewhere", "a"))
        self.assertSubfolderRefused(s, lambda: s.write_signature("m1", signature(),
                                                                 record={"workspace": "w", "record": "r"}),
                                    self.path("elsewhere", "b"))
        self.assertSubfolderRefused(
            s, lambda: s.write_json(os.path.join(s.calibration_labels_dir(), "x.json"), {"a": 1}),
            self.path("elsewhere", "c"))

    @unittest.skipUnless(POSIX, "symlinks")
    def test_a_lock_file_linked_out_is_never_created_at_its_target(self):
        s = store.Store(self.path("vp"), exclude_backup=no_exclude, guard=self.guard())
        s.ensure()
        os.makedirs(self.path("elsewhere"))
        os.makedirs(s.model_dir("m1"))
        os.symlink(self.path("elsewhere", "lock"), os.path.join(s.model_dir("m1"), ".lock"))
        os.symlink(self.path("elsewhere", "root-lock"), os.path.join(s.home, ".lock"))
        for model_id in ("m1", None):
            def take():
                with s.lock(model_id):
                    pass
            self.assertSubfolderRefused(s, take, self.path("elsewhere"))
        self.assertSubfolderRefused(s, lambda: s.add_never({"workspace": "w", "person": "contacts/sam-diaz",
                                                            "name": "Sam Diaz", "at": "2026-11-20T10:00:00Z"}),
                                    self.path("elsewhere"))

    @unittest.skipUnless(POSIX, "symlinks")
    def test_a_link_that_stays_inside_the_store_is_accepted(self):
        s = store.Store(self.path("vp"), exclude_backup=no_exclude, guard=self.guard())
        s.ensure()
        os.makedirs(os.path.join(s.home, "m1-real"))
        os.symlink(os.path.join(s.home, "m1-real"), s.model_dir("m1"))
        s.write_print("m1", a_print("p-1"))
        with s.lock("m1"):
            pass
        self.assertEqual(os.listdir(os.path.join(s.home, "m1-real", "prints")), ["p-1.json"])

    @unittest.skipUnless(POSIX, "symlinks")
    def test_a_symlink_into_a_git_tree_leaves_nothing_at_either_end(self):
        os.makedirs(self.path("repo", ".git"))
        os.makedirs(self.path("repo", "target"))
        os.makedirs(self.path("elsewhere"))
        link = self.path("elsewhere", "vp")
        os.symlink(self.path("repo", "target"), link)
        self.assertRefused(link)
        self.assertEqual(os.listdir(self.path("repo", "target")), [])
        self.assertTrue(os.path.islink(link))

    @unittest.skipUnless(POSIX, "symlinks")
    def test_a_dangling_symlink_into_a_git_tree_creates_no_target(self):
        os.makedirs(self.path("repo", ".git"))
        os.makedirs(self.path("elsewhere"))
        link = self.path("elsewhere", "vp")
        os.symlink(self.path("repo", "not-yet", "vp"), link)
        self.assertRefused(link)
        self.assertFalse(os.path.exists(self.path("repo", "not-yet")))

    @unittest.skipUnless(POSIX, "symlinks")
    def test_a_symlinked_parent_into_a_synced_folder(self):
        os.makedirs(self.path("Dropbox", "real"))
        os.symlink(self.path("Dropbox", "real"), self.path("innocent"))
        self.assertRefused(self.path("innocent", "voice-prints"))
        self.assertEqual(os.listdir(self.path("Dropbox", "real")), [])

    @unittest.skipUnless(POSIX, "symlinks")
    def test_a_workspace_reached_through_a_link_is_still_the_workspace(self):
        os.makedirs(self.path("ws"))
        os.symlink(self.path("ws"), self.path("ws-link"))
        self.assertRefused(self.path("ws-link", "vp"))
        self.assertRefused(self.path("ws", "vp"), self.guard(workspace=self.path("ws-link")))


# --------------------------------------------------------------------------------------------------
class EnsureTest(Tmp):
    @unittest.skipUnless(POSIX, "modes")
    def test_modes_readme_and_backup_exclusion_once(self):
        calls = []
        s = store.Store(self.path("a", "vp"), exclude_backup=calls.append)
        s.ensure()
        s.ensure()
        self.assertEqual(calls, [s.home])
        self.assertEqual(os.stat(s.home).st_mode & 0o777, 0o700)
        readme = os.path.join(s.home, "README.txt")
        self.assertEqual(os.stat(readme).st_mode & 0o777, 0o600)
        text = Path(readme).read_text()
        self.assertIn("voice", text.lower())
        self.assertIn("sync", text.lower())
        s.write_print(MODEL_A.id, a_print())
        self.assertEqual(os.stat(s.model_dir(MODEL_A.id)).st_mode & 0o777, 0o700)
        self.assertEqual(os.stat(s.print_path(MODEL_A.id, "p-3f9a1c2e")).st_mode & 0o777, 0o600)
        s.write_signature(MODEL_A.id, signature(), record={"workspace": "w", "record": "meeting-recordings/r"})
        self.assertEqual(os.stat(s.signature_dir(MODEL_A.id, AUDIO)).st_mode & 0o777, 0o700)
        self.assertEqual(os.stat(s.signature_path(MODEL_A.id, AUDIO, "7c1d09a4e2b1")).st_mode & 0o777, 0o600)

    def test_a_failing_backup_exclusion_is_reported_never_fatal(self):
        def boom(home):
            raise OSError("tmutil: not permitted")
        s = store.Store(self.path("vp"), exclude_backup=boom)
        s.ensure()
        self.assertTrue(os.path.isdir(s.home))
        self.assertTrue(any("Time Machine" in n or "backup" in n for n in s.notices), s.notices)

    # whole-branch review, `time-machine-exclusion-only-when-the-store-is-made`: the exclusion no longer
    # depends on ensure() making the folder. It was `test_an_existing_store_is_not_excluded_again`, which
    # asserted the defect (a folder the user made first was never excluded); a store already excluded is still
    # not excluded again — by its mark, below.
    def test_a_folder_the_user_made_first_is_excluded_too(self):
        os.makedirs(self.path("vp"))
        calls = []
        store.Store(self.path("vp"), exclude_backup=calls.append).ensure()
        self.assertEqual(calls, [self.path("vp")])

    def test_a_store_already_excluded_is_not_excluded_again(self):
        calls = []
        store.Store(self.path("vp"), exclude_backup=calls.append).ensure()
        store.Store(self.path("vp"), exclude_backup=calls.append).ensure()   # the next verb, the next process
        self.assertEqual(calls, [self.path("vp")])
        self.assertTrue(os.path.isfile(os.path.join(self.path("vp"), store.EXCLUDED_MARK)))

    def test_a_failed_exclusion_is_tried_again_by_the_next_verb(self):
        tried = []

        def boom(home):
            tried.append(home)
            raise OSError("tmutil: not permitted")
        first = store.Store(self.path("vp"), exclude_backup=boom)
        first.ensure()
        first.ensure()
        first.write_json(os.path.join(first.home, "x.json"), {"n": 1})        # every write ensures
        self.assertEqual(len(tried), 1, "tried once per verb, not on every write")
        self.assertEqual(len(first.notices), 1, first.notices)
        self.assertFalse(os.path.exists(os.path.join(first.home, store.EXCLUDED_MARK)))
        calls = []
        second = store.Store(self.path("vp"), exclude_backup=calls.append)
        second.ensure()
        self.assertEqual(calls, [self.path("vp")])
        self.assertEqual(second.notices, [])

    def test_say_notices_says_each_notice_once(self):
        def boom(home):
            raise OSError("tmutil: not permitted")
        s = store.Store(self.path("vp"), exclude_backup=boom)
        s.ensure()
        said = []
        store.say_notices(s, said.append)
        store.say_notices(s, said.append)
        store.say_notices(None, said.append)
        self.assertEqual(len(said), 1, said)
        self.assertTrue(said[0].startswith("⚠ ") and "Time Machine" in said[0], said)

    @unittest.skipUnless(POSIX, "symlinks")
    def test_a_store_linked_to_an_allowed_folder_not_yet_made_is_made_at_the_target(self):
        target = self.path("ok", "later", "vp")
        link = self.path("link-vp")
        os.symlink(target, link)
        calls = []
        s = store.Store(link, exclude_backup=calls.append)
        s.ensure()
        self.assertTrue(os.path.islink(link))
        self.assertTrue(os.path.isdir(target))
        self.assertTrue(os.path.isfile(os.path.join(target, "README.txt")))
        self.assertEqual(os.stat(target).st_mode & 0o777, 0o700)
        self.assertEqual(calls, [target])   # excluded from backups once, at the folder that holds it
        s.ensure()
        self.assertEqual(calls, [target])
        s.write_print(MODEL_A.id, a_print("p-1"))
        self.assertEqual(os.listdir(os.path.join(target, MODEL_A.id, "prints")), ["p-1.json"])

    def test_the_darwin_default_runs_tmutil_addexclusion(self):
        seen = []

        def fake_run(args, **kw):
            seen.append(args)
            return subprocess.CompletedProcess(args, 0, "", "")
        with mock.patch.object(store.subprocess, "run", fake_run):
            fn = store.default_exclude_backup("darwin")
            self.assertTrue(callable(fn))
            fn(self.path("vp"))
        self.assertEqual(seen, [["tmutil", "addexclusion", self.path("vp")]])
        self.assertIsNone(store.default_exclude_backup("linux"))

    def test_a_failing_tmutil_raises_so_ensure_reports_it(self):
        def fake_run(args, **kw):
            return subprocess.CompletedProcess(args, 1, "", "denied")
        with mock.patch.object(store.subprocess, "run", fake_run):
            with self.assertRaises(Exception):
                store.default_exclude_backup("darwin")(self.path("vp"))


class AtomicWriteTest(Tmp):
    def test_round_trip(self):
        s = self.new_store()
        p = os.path.join(s.home, "x.json")
        s.write_json(p, {"name": "\u05d3\u05e0\u05d4", "n": 1})
        self.assertEqual(s.read_json(p), {"name": "\u05d3\u05e0\u05d4", "n": 1})
        self.assertIsNone(s.read_json(os.path.join(s.home, "missing.json")))
        self.assertEqual(s.read_json(os.path.join(s.home, "missing.json"), default=[]), [])

    def test_an_interrupted_write_leaves_the_old_file_and_no_temp(self):
        s = self.new_store()
        p = os.path.join(s.home, "x.json")
        s.write_json(p, {"v": "old"})
        with mock.patch.object(store.os, "replace", side_effect=OSError("power cut")):
            with self.assertRaises(OSError):
                s.write_json(p, {"v": "new"})
        self.assertEqual(s.read_json(p), {"v": "old"})
        self.assertEqual(sorted(os.listdir(s.home)), sorted([store.EXCLUDED_MARK, "README.txt", "x.json"]))


# --------------------------------------------------------------------------------------------------
class LayoutTest(Tmp):
    def test_paths_follow_the_design(self):
        s = self.new_store()
        self.assertEqual(s.model_dir("m1"), os.path.join(s.home, "m1"))
        self.assertEqual(s.print_path("m1", "p-1"), os.path.join(s.home, "m1", "prints", "p-1.json"))
        self.assertEqual(s.signature_dir("m1", AUDIO), os.path.join(s.home, "m1", "signatures", "ab", AUDIO))
        self.assertEqual(s.signature_path("m1", AUDIO, "7c1d09a4e2b1"),
                         os.path.join(s.home, "m1", "signatures", "ab", AUDIO, "7c1d09a4e2b1.json"))
        self.assertEqual(s.calibration_labels_dir(), os.path.join(s.home, "calibration-labels"))

    def test_a_path_component_cannot_escape(self):
        s = self.new_store()
        for bad in ("..", "a/b", "", ".", "a\\b"):
            with self.assertRaises(ValueError):
                s.model_dir(bad)
            with self.assertRaises(ValueError):
                s.print_path("m1", bad)

    def test_prints_round_trip(self):
        s = self.new_store()
        self.assertEqual(s.prints(MODEL_A.id), [])
        s.write_print(MODEL_A.id, a_print("p-2"))
        s.write_print(MODEL_A.id, a_print("p-1"))
        self.assertEqual([p["id"] for p in s.prints(MODEL_A.id)], ["p-1", "p-2"])

    def test_one_audio_one_diarisation_two_workspaces_is_one_file_two_records(self):
        s = self.new_store()
        s.write_signature(MODEL_A.id, signature(),
                          record={"workspace": "northwind-hq", "record": "meeting-recordings/2026/11/a"})
        s.write_signature(MODEL_A.id, signature(),
                          record={"workspace": "harbor-mutual", "record": "meeting-recordings/2026/11/b"})
        s.write_signature(MODEL_A.id, signature(),   # the same record again adds nothing
                          record={"workspace": "harbor-mutual", "record": "meeting-recordings/2026/11/b"})
        files = os.listdir(s.signature_dir(MODEL_A.id, AUDIO))
        self.assertEqual(files, ["7c1d09a4e2b1.json"])
        sig = s.read_signature(MODEL_A.id, AUDIO, "7c1d09a4e2b1")
        self.assertEqual(sig["records"], [
            {"workspace": "northwind-hq", "record": "meeting-recordings/2026/11/a"},
            {"workspace": "harbor-mutual", "record": "meeting-recordings/2026/11/b"},
        ])
        self.assertEqual(len(sig["labels"]["speaker_0"]["windows"]), 3)

    def test_a_second_diarisation_is_a_second_file_in_the_same_audio_folder(self):
        s = self.new_store()
        s.write_signature(MODEL_A.id, signature(diar="7c1d09a4e2b1"), record={"workspace": "w", "record": "r"})
        s.write_signature(MODEL_A.id, signature(diar="0011aabbccdd"), record={"workspace": "w", "record": "r"})
        self.assertEqual(sorted(os.listdir(s.signature_dir(MODEL_A.id, AUDIO))),
                         ["0011aabbccdd.json", "7c1d09a4e2b1.json"])
        self.assertEqual([x["diarization"]["id"] for x in s.signatures_for_audio(MODEL_A.id, AUDIO)],
                         ["0011aabbccdd", "7c1d09a4e2b1"])
        self.assertEqual(s.signatures_for_audio(MODEL_A.id, "cd" * 32), [])

    def test_remove_windows_records_removed_and_a_later_write_keeps_it_removed(self):
        s = self.new_store()
        s.write_signature(MODEL_A.id, signature(), record={"workspace": "w", "record": "r"})
        self.assertTrue(s.remove_windows(MODEL_A.id, AUDIO, "7c1d09a4e2b1", "speaker_1"))
        sig = s.read_signature(MODEL_A.id, AUDIO, "7c1d09a4e2b1")
        self.assertEqual(sig["removed"], ["speaker_1"])
        self.assertEqual(sig["labels"]["speaker_1"]["windows"], [])
        self.assertEqual(len(sig["labels"]["speaker_0"]["windows"]), 3)
        # another workspace writing the same diarisation again brings no window of a removed label back
        s.write_signature(MODEL_A.id, signature(), record={"workspace": "w2", "record": "r2"})
        sig = s.read_signature(MODEL_A.id, AUDIO, "7c1d09a4e2b1")
        self.assertEqual(sig["removed"], ["speaker_1"])
        self.assertEqual(sig["labels"]["speaker_1"]["windows"], [])
        self.assertEqual(len(sig["records"]), 2)
        self.assertFalse(s.remove_windows(MODEL_A.id, AUDIO, "ffffffffffff", "speaker_0"))

    def test_a_signature_file_holds_no_persons_name(self):
        s = self.new_store()
        s.write_print(MODEL_A.id, a_print())
        s.write_signature(MODEL_A.id, signature(),
                          record={"workspace": "northwind-hq", "record": "meeting-recordings/2026/11/a"})
        raw = Path(s.signature_path(MODEL_A.id, AUDIO, "7c1d09a4e2b1")).read_text()
        for name in CAST:
            self.assertNotIn(name, raw)
            self.assertNotIn(name.lower().replace(" ", "-"), raw)
        self.assertNotIn("known_as", raw)
        self.assertNotIn('"name"', raw)

    def test_a_signature_carrying_a_name_is_refused(self):
        s = self.new_store()
        for key, where in (("name", "top"), ("speakers", "top"), ("name", "label"), ("known_as", "top")):
            sig = signature()
            if where == "top":
                sig[key] = {"speaker_0": "Dana Oren"} if key == "speakers" else "Dana Oren"
            else:
                sig["labels"]["speaker_0"][key] = "Dana Oren"
            with self.assertRaises(ValueError):
                s.write_signature(MODEL_A.id, sig, record={"workspace": "w", "record": "r"})
        self.assertFalse(os.path.exists(s.signature_path(MODEL_A.id, AUDIO, "7c1d09a4e2b1")))


class NeverForgottenTest(Tmp):
    def test_never_and_forgotten_round_trip_with_offset_instants(self):
        s = self.new_store()
        self.assertEqual(s.never(), [])
        self.assertEqual(s.forgotten(), [])
        n = {"workspace": "northwind-hq", "person": "contacts/sam-diaz", "name": "Sam Diaz",
             "at": "2026-11-20T10:02:11+02:00"}
        f = {"print": "p-3f9a1c2e",
             "known_as": [{"workspace": "northwind-hq", "person": "users/dana-oren", "name": "Dana Oren"}],
             "at": "2026-11-21T09:00:00-05:00"}
        s.add_never(n)
        s.add_never(n)   # the same entry twice is kept once
        s.add_forgotten(f)
        self.assertEqual(s.never(), [n])
        self.assertEqual(s.forgotten(), [f])
        self.assertEqual(store.parse_instant(s.forgotten()[0]["at"]).utcoffset().total_seconds(), -5 * 3600)
        self.assertTrue(os.path.isfile(os.path.join(s.home, "never.json")))
        self.assertTrue(os.path.isfile(os.path.join(s.home, "forgotten.json")))

    def test_an_instant_without_an_offset_is_refused(self):
        s = self.new_store()
        for bad in ("2026-11-20", "2026-11-20T10:02:11", None):
            with self.assertRaises(ValueError):
                s.add_forgotten({"print": "p-1", "known_as": [], "at": bad})
            with self.assertRaises(ValueError):
                s.add_never({"workspace": "w", "person": "contacts/x", "name": "Sam Diaz", "at": bad})

    def test_now_is_an_instant_with_an_offset(self):
        self.assertIsNotNone(store.parse_instant(store.now()).utcoffset())
        self.assertIsNotNone(store.parse_instant("2026-11-20T08:02:11Z").utcoffset())


# --------------------------------------------------------------------------------------------------
class Line11(Tmp):
    """A voice print made with one speaker model is refused when another model is active and the
    message names the command that rebuilds it"""

    def test_another_models_print_is_refused_naming_prints_rebuild(self):
        p = a_print("p-3f9a1c2e", model=MODEL_A)
        for active in (MODEL_B, MODEL_A._replace(sha256="c" * 64), MODEL_A._replace(dim=192)):
            with self.assertRaises(store.ModelMismatch) as cm:
                store.check_model(p, active)
            msg = str(cm.exception)
            self.assertIn("prints rebuild", msg)
            self.assertIn("voice print p-3f9a1c2e was made with eres2netv2-test aaaaaaaa", msg)
            self.assertIn(f"the active speaker model is {active.id} {active.sha256[:8]}", msg)
        self.assertEqual(
            str(self._mismatch(p, MODEL_B)),
            "voice print p-3f9a1c2e was made with eres2netv2-test aaaaaaaa; the active speaker model is "
            "campplus-test bbbbbbbb \u2014 run `prints rebuild` to make it again")
        store.check_model(p, MODEL_A)   # the same model passes

    def _mismatch(self, obj, model):
        try:
            store.check_model(obj, model)
        except store.ModelMismatch as e:
            return e
        self.fail("no ModelMismatch")

    def test_the_same_shape_for_a_signature(self):
        e = self._mismatch(signature(model=MODEL_A), MODEL_B)
        self.assertIn("voice signature", str(e))
        self.assertIn("7c1d09a4e2b1", str(e))
        self.assertIn("prints rebuild", str(e))

    def test_a_print_with_no_model_is_refused(self):
        p = a_print()
        del p["model"]
        self.assertIn("prints rebuild", str(self._mismatch(p, MODEL_A)))

    def test_the_store_refuses_another_models_print_on_load(self):
        s = self.new_store()
        s.write_print(MODEL_A.id, a_print("p-1", model=MODEL_A))
        s.write_print(MODEL_A.id, a_print("p-2", model=MODEL_B))   # a stray file of another model
        with self.assertRaises(store.ModelMismatch) as cm:
            s.prints(MODEL_A.id, model=MODEL_A)
        self.assertIn("p-2", str(cm.exception))
        self.assertIn("prints rebuild", str(cm.exception))
        self.assertEqual(len(s.prints(MODEL_A.id)), 2)   # no model given: no check
        s.write_signature(MODEL_A.id, signature(model=MODEL_A), record={"workspace": "w", "record": "r"})
        with self.assertRaises(store.ModelMismatch):
            s.read_signature(MODEL_A.id, AUDIO, "7c1d09a4e2b1", model=MODEL_B)

    def test_a_signature_of_another_model_is_never_merged(self):
        s = self.new_store()
        s.write_signature(MODEL_A.id, signature(model=MODEL_A), record={"workspace": "w", "record": "r"})
        with self.assertRaises(store.ModelMismatch):
            s.write_signature(MODEL_A.id, signature(model=MODEL_A._replace(sha256="c" * 64)),
                              record={"workspace": "w2", "record": "r2"})
        self.assertEqual(len(s.read_signature(MODEL_A.id, AUDIO, "7c1d09a4e2b1")["records"]), 1)


# --------------------------------------------------------------------------------------------------
WORKER = r"""
import os, sys, time
sys.path.insert(0, sys.argv[1])
from voiceprints import store
home, ws, n, go, sig_path = sys.argv[2], sys.argv[3], int(sys.argv[4]), sys.argv[5], sys.argv[6]
import json
sig = json.load(open(sig_path))
s = store.Store(home, exclude_backup=lambda h: None)
deadline = time.time() + 30
while not os.path.exists(go) and time.time() < deadline:
    time.sleep(0.002)
for i in range(n):
    s.write_signature("m1", sig, record={"workspace": ws, "record": "meeting-recordings/r%03d" % i})
"""


class LockTest(Tmp):
    @unittest.skipUnless(POSIX, "fcntl")
    def test_two_processes_merging_one_signature_file_keep_every_record(self):
        s = self.new_store()
        s.ensure()
        sig_path = self.path("sig.json")
        Path(sig_path).write_text(json.dumps(signature()))
        go = self.path("go")
        n = 40
        procs = [subprocess.Popen([sys.executable, "-B", "-c", WORKER, str(SKILL), s.home, ws, str(n), go, sig_path],
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                 for ws in ("northwind-hq", "harbor-mutual")]
        time.sleep(0.2)
        Path(go).write_text("go")
        for p in procs:
            out, err = p.communicate(timeout=120)
            self.assertEqual(p.returncode, 0, err.decode())
        sig = s.read_signature("m1", AUDIO, "7c1d09a4e2b1")
        got = {(r["workspace"], r["record"]) for r in sig["records"]}
        self.assertEqual(len(sig["records"]), 2 * n)
        for ws in ("northwind-hq", "harbor-mutual"):
            for i in range(n):
                self.assertIn((ws, "meeting-recordings/r%03d" % i), got)

    @unittest.skipUnless(POSIX, "fcntl")
    def test_the_lock_file_is_0600_and_excludes_another_process(self):
        s = self.new_store()
        probe = ("import fcntl, os, sys\n"
                 "fd = os.open(sys.argv[1], os.O_RDWR)\n"
                 "try:\n    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)\nexcept OSError:\n    sys.exit(3)\n"
                 "sys.exit(0)\n")
        for model_id, lock_file in (("m1", os.path.join(s.home, "m1", ".lock")),
                                    (None, os.path.join(s.home, ".lock"))):
            with s.lock(model_id):
                self.assertEqual(os.stat(lock_file).st_mode & 0o777, 0o600)
                held = subprocess.run([sys.executable, "-c", probe, lock_file])
                self.assertEqual(held.returncode, 3, "another process took a held lock")
            free = subprocess.run([sys.executable, "-c", probe, lock_file])
            self.assertEqual(free.returncode, 0, "the lock was not released")

    def test_the_lock_is_reentrant_within_a_thread(self):
        s = self.new_store()
        with s.lock("m1"):
            with s.lock("m1"):
                s.write_signature("m1", signature(), record={"workspace": "w", "record": "r"})
            s.remove_windows("m1", AUDIO, "7c1d09a4e2b1", "speaker_0")
        with s.lock(None):
            s.add_forgotten({"print": "p-1", "known_as": [], "at": "2026-11-20T10:00:00+00:00"})
        self.assertEqual(s.read_signature("m1", AUDIO, "7c1d09a4e2b1")["removed"], ["speaker_0"])

    def test_a_second_store_object_on_the_same_home_shares_the_lock_in_process(self):
        a, b = self.new_store(), self.new_store()
        with a.lock("m1"):
            with b.lock("m1"):   # same thread, same lock file: re-entrant, not a deadlock
                b.write_signature("m1", signature(), record={"workspace": "w", "record": "r"})


if __name__ == "__main__":
    unittest.main()
