"""The per-user voice-print store (design section 8): where it lives, where it may never live, its
layout, atomic writes, an advisory lock per model folder, and the model pin.

One store per user, shared by all of that user's workspaces:

    <store>/
      README.txt
      .backup-excluded                written once Time Machine excluded the store (darwin)
      never.json                      people whose voice must not be stored
      forgotten.json                  who was forgotten and when
      .lock                           Store.lock(None): never.json and forgotten.json
      <model id>/
        .lock                         Store.lock(<model id>): prints and signatures of this model
        prints/p-3f9a1c2e.json        one person, this model
        signatures/ab/ab12...ef/      one recording, keyed by the sha256 of its audio
          7c1d09a4e2b1.json           one diarisation of it, keyed by its diarisation id
        calibration.json              optional local override of the shipped calibration
      calibration-labels/             the developer's labelling answers; absent for a user

Folders 0700, files 0600, every write a temp file in the same folder and an `os.replace`. A
signature file holds no person's name: `write_signature` refuses one that carries a name-like key.
A folder or lock file whose real path leaves the store's real path (a model folder linked into a
synced folder, say) is refused before anything is made or written there.

Standard library only (the `engines.py` rule), so a bare python3 runs everything that judges a voice
print; only `embed.py` needs numpy and sherpa-onnx.
"""
from __future__ import annotations

import contextlib
import json
import ntpath
import os
import posixpath
import subprocess
import sys
import tempfile
import threading
from collections import namedtuple
from datetime import datetime, timezone
from pathlib import PurePath

Model = namedtuple("Model", "id sha256 dim")

SYNC_NAMES = (
    "Dropbox", "Google Drive", "GoogleDrive", "OneDrive", "iCloud Drive", "iCloudDrive", "Box",
    "Box Sync", "pCloud Drive", "MEGA", "Sync", "Nextcloud", "ownCloud", "Resilio Sync", "SyncThing",
    "Syncthing",
)
_SYNC = frozenset(n.casefold() for n in SYNC_NAMES)

# Keys that would put a person's name into a signature file; refused at any depth.
_NAME_KEYS = frozenset((
    "name", "names", "known_as", "person", "persons", "people", "speakers", "speaker_names",
    "display_name",
))

README = """\
This folder is a dreamteamer voice-print store.

It holds the voice prints of people you named on your recordings and the voice signatures of every
speaker of every recording you transcribed, for all of your dreamteamer workspaces. A voice print is
biometric data: keep this folder on this machine only.

Do not sync, share, back up to a cloud service, or commit this folder. dreamteamer refuses a store
inside a git working tree, a workspace, a files or inbox folder, or a folder of a sync or cloud
service, and on a Mac marks it excluded from Time Machine (and tries again, saying so, until that works).

To remove a person's voice, run `prints forget <person>` in the workspace that knows them; to remove
one recording's signatures, `prints forget-recording <record>`. Delete the whole folder to remove
everything.
"""


class StoreRefused(Exception):
    """The store's location is one it may never live in. `reason` says which rule; nothing was
    created."""

    def __init__(self, reason, path=""):
        self.reason = reason
        self.path = path
        super().__init__(f"the voice-print store may not be {reason}: {path} — set VOICE_PRINTS_HOME "
                         f"to a folder on this machine that nothing syncs")


class ModelMismatch(Exception):
    """A print or signature was made with another speaker model than the active one."""


# --------------------------------------------------------------------------------------------------
# Location

def _user_home(env, platform):
    h = env.get("HOME") or (env.get("USERPROFILE") if platform == "win32" else None)
    return h or os.path.expanduser("~")


def _expand_tilde(p, env, platform):
    if p == "~" or p.startswith("~/") or p.startswith("~\\"):
        return _user_home(env, platform) + p[1:]
    return p


def default_home(platform=sys.platform, env=os.environ):
    """The store's folder for `platform`: macOS `~/Library/Application Support/dreamteamer/voice-prints`,
    Linux `${XDG_DATA_HOME:-~/.local/share}/dreamteamer/voice-prints`, Windows
    `%LOCALAPPDATA%\\dreamteamer\\voice-prints`. A non-empty `VOICE_PRINTS_HOME` (with `~` expanded)
    overrides all three."""
    override = env.get("VOICE_PRINTS_HOME")
    if override:
        return _expand_tilde(override, env, platform)
    if platform == "win32":
        base = env.get("LOCALAPPDATA") or ntpath.join(_user_home(env, platform), "AppData", "Local")
        return ntpath.join(base, "dreamteamer", "voice-prints")
    home = _user_home(env, platform)
    if platform == "darwin":
        return posixpath.join(home, "Library", "Application Support", "dreamteamer", "voice-prints")
    xdg = env.get("XDG_DATA_HOME")
    if not xdg or not posixpath.isabs(xdg):
        xdg = posixpath.join(home, ".local", "share")
    return posixpath.join(xdg, "dreamteamer", "voice-prints")


def _forms(path):
    """The path as given (absolute) and its real path — symlinks resolved, and for a path that does
    not exist yet its nearest existing ancestor resolved (`os.path.realpath` is non-strict)."""
    p = os.path.abspath(os.path.expanduser(path))
    return [p] if os.path.realpath(p) == p else [p, os.path.realpath(p)]


def _key(p):
    # Case-folded: macOS and Windows file systems are case-insensitive by default, and refusing a
    # look-alike on Linux costs nothing.
    return os.path.normcase(os.path.normpath(p)).casefold()


def _inside(p, root):
    p, root = _key(p), _key(root)
    if p == root:
        return True
    return p.startswith(root if root.endswith(os.sep) else root + os.sep)


def _ancestors(p):
    while True:
        yield p
        parent = os.path.dirname(p)
        if parent == p:
            return
        p = parent


# Sync names that are also ordinary words: a bare hyphen after them ("Box-art", "sync-scripts") is
# not taken for an account suffix. Box's own "Box-Box" lives under ~/Library/CloudStorage, refused
# there.
_WORDS = frozenset(("box", "sync", "mega"))


def _is_sync_name(component):
    """A sync service's folder name (`SYNC_NAMES`, case-insensitive) alone, or followed by an account
    or team suffix: `<name> - <suffix>` (`OneDrive - Northwind`), `<name> (<suffix>` (Dropbox's team
    form, `Dropbox (Northwind)`), or `<name>-<suffix>` (`Dropbox-Northwind`) — the last not for the
    ordinary words in `_WORDS`. `Boxes` or `Synchronised` is no sync name."""
    c = component.casefold()
    if c in _SYNC:
        return True
    for n in _SYNC:
        if not c.startswith(n):
            continue
        rest = c[len(n):]
        seps = (" - ", " (") if n in _WORDS else (" - ", " (", "-")
        for sep in seps:
            if rest.startswith(sep) and rest[len(sep):].strip():
                return True
    return False


def _roots(value):
    if not value:
        return []
    if isinstance(value, str):
        value = value.splitlines()
    return [v.strip() for v in value if v and v.strip()]


def check_location(home, guard=None):
    """Raise `StoreRefused(reason)` when the store's path — as given or real — is inside a git working
    tree, inside `guard["workspace"]`, a `guard["files_folder"]` or any `guard["inbox_folders"]` root
    (a list, or a newline-separated string), under `~/Library/CloudStorage` or
    `~/Library/Mobile Documents`, or has a component named for a sync service (`SYNC_NAMES`,
    case-insensitive, also with an account suffix — see `_is_sync_name`). There is no override.
    Creates nothing."""
    guard = guard or {}
    forms = _forms(home)

    for p in forms:
        for a in _ancestors(p):
            if os.path.lexists(os.path.join(a, ".git")):
                raise StoreRefused(f"inside a git working tree ({a})", home)

    checks = [("inside the workspace", _roots([guard.get("workspace")])),
              ("inside the files folder", _roots([guard.get("files_folder")])),
              ("inside an inbox folder", _roots(guard.get("inbox_folders")))]
    for reason, roots in checks:
        for root in roots:
            for r in _forms(root):
                if any(_inside(p, r) for p in forms):
                    raise StoreRefused(reason, home)

    for uh in _forms(os.path.expanduser("~")):
        for sub, what in (("CloudStorage", "under ~/Library/CloudStorage, a cloud-backed folder"),
                          ("Mobile Documents", "under ~/Library/Mobile Documents, an iCloud folder")):
            if any(_inside(p, os.path.join(uh, "Library", sub)) for p in forms):
                raise StoreRefused(what, home)

    for p in forms:
        for part in PurePath(p).parts:
            if _is_sync_name(part):
                raise StoreRefused(f"inside a folder named for a sync service ({part})", home)


# --------------------------------------------------------------------------------------------------
# Backup exclusion

EXCLUDED_MARK = ".backup-excluded"


def _tmutil_exclude(home):
    r = subprocess.run(["tmutil", "addexclusion", home], capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise OSError(f"tmutil addexclusion exited {r.returncode}: {(r.stderr or '').strip()}")


def default_exclude_backup(platform=sys.platform):
    """The callable `Store.ensure` runs until the store carries its `EXCLUDED_MARK`: on darwin `tmutil
    addexclusion <home>`, elsewhere none."""
    return _tmutil_exclude if platform == "darwin" else None


def say_notices(store, say):
    """Say every notice `store` has not said yet (a backup exclusion that failed), each as `⚠ <notice>`
    through `say`; nothing for no store (or a stand-in that is not a Store). Every verb that opens the store
    calls it before it returns."""
    for n in (store.unsaid_notices() if isinstance(store, Store) else []):
        say(f"⚠ {n}")


# --------------------------------------------------------------------------------------------------
# Instants

def parse_instant(s):
    """An ISO 8601 instant WITH an offset (`2026-11-20T10:02:11+02:00`, or `...Z`) as an aware
    datetime; a date, a naive time or anything else raises ValueError."""
    if not isinstance(s, str) or not s:
        raise ValueError(f"an instant is an ISO 8601 string with an offset, got {s!r}")
    t = s[:-1] + "+00:00" if s[-1:] in ("Z", "z") else s
    try:
        d = datetime.fromisoformat(t)
    except ValueError:
        raise ValueError(f"not an ISO 8601 instant: {s!r}") from None
    if d.tzinfo is None or d.utcoffset() is None:
        raise ValueError(f"an instant carries an offset, {s!r} has none")
    return d


def now():
    """This instant, with the local offset, to the second."""
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


# --------------------------------------------------------------------------------------------------
# Model pin

def _as_model(model):
    if isinstance(model, Model):
        return model
    if isinstance(model, dict):
        return Model(model.get("id"), model.get("sha256"), model.get("dim"))
    return Model(*model)


def check_model(obj, model):
    """Raise `ModelMismatch` unless `obj` (a print or a signature) was made with `model` — same id,
    sha256 and dim. The message names the fix: `prints rebuild`."""
    active = _as_model(model)
    m = obj.get("model") if isinstance(obj, dict) else None
    m = m if isinstance(m, dict) else None
    if m and m.get("id") == active.id and m.get("sha256") == active.sha256 and m.get("dim") == active.dim:
        return
    if isinstance(obj, dict) and "diarization" in obj:
        diar = obj.get("diarization") or {}
        what = f"voice signature {str(obj.get('audio', '?'))[:12]}/{diar.get('id', '?')}"
    else:
        what = f"voice print {obj.get('id', '?') if isinstance(obj, dict) else '?'}"
    made = f"{m.get('id')} {str(m.get('sha256') or '')[:8]}" if m else "an unknown speaker model"
    act = f"{active.id} {str(active.sha256 or '')[:8]}"
    if m and m.get("id") == active.id and m.get("sha256") == active.sha256:
        made, act = f"{made} (dim {m.get('dim')})", f"{act} (dim {active.dim})"
    raise ModelMismatch(f"{what} was made with {made}; the active speaker model is {act} — run "
                        f"`prints rebuild` to make it again")


# --------------------------------------------------------------------------------------------------
# The lock (ruling D3)

class _Held:
    __slots__ = ("rlock", "count", "fd")

    def __init__(self):
        self.rlock = threading.RLock()
        self.count = 0
        self.fd = None


_LOCKS = {}
_LOCKS_GUARD = threading.Lock()

if os.name == "nt":  # pragma: no cover - exercised on Windows only
    import msvcrt

    def _lock_fd(fd):
        while True:
            try:
                os.lseek(fd, 0, os.SEEK_SET)
                msvcrt.locking(fd, msvcrt.LK_LOCK, 1)
                return
            except OSError:
                continue

    def _unlock_fd(fd):
        os.lseek(fd, 0, os.SEEK_SET)
        msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
else:
    import fcntl

    def _lock_fd(fd):
        fcntl.flock(fd, fcntl.LOCK_EX)

    def _unlock_fd(fd):
        fcntl.flock(fd, fcntl.LOCK_UN)


def _open_lock(path):
    fd = os.open(path, os.O_RDWR | os.O_CREAT | getattr(os, "O_BINARY", 0), 0o600)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return fd


# --------------------------------------------------------------------------------------------------
# The store

def _component(s, what="path component"):
    if not isinstance(s, str) or not s or s in (".", "..") or any(c in s for c in "/\\\0"):
        raise ValueError(f"not a safe {what}: {s!r}")
    return s


def _check_no_names(obj, where="signature"):
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in _NAME_KEYS:
                raise ValueError(f"a signature file holds no person's name: refused key {k!r} in {where}")
            if k != "vector" and isinstance(v, (dict, list)):
                _check_no_names(v, f"{where}.{k}")
    elif isinstance(obj, list):
        for x in obj:
            if isinstance(x, (dict, list)):
                _check_no_names(x, where)


class Store:
    """The store at `home`. Nothing touches the disk until `ensure()` (which every write and `lock`
    call first): it checks the location against `guard` (see `check_location`) every time, so a
    refused store creates nothing, then creates the folder 0700 with `README.txt` and runs
    `exclude_backup(home)` — by default `default_exclude_backup()`, which on darwin runs `tmutil` —
    whether or not the folder was there before, until it succeeds: a success leaves `EXCLUDED_MARK` in
    the store, so a later Store (the next verb, the next process) does not run it again; a failure is
    appended to `notices`, never raised, and tried again by the next Store, not by this one's next
    write (whole-branch review, `time-machine-exclusion-only-when-the-store-is-made`). Every verb says
    its notices (`say_notices`). Tests inject a fake `exclude_backup`.

    `lock(model_id)` serialises read-modify-write across processes (an advisory `flock` /
    `msvcrt.locking` on `<model>/.lock`, or `<store>/.lock` for `None`). It is RE-ENTRANT within a
    thread (any Store object on the same folder shares it), so a caller holding it may call
    `write_signature`, `remove_windows`, `add_never` and `add_forgotten`, which take it themselves.
    Lock order: take model locks before the root lock, never a model lock while holding `lock(None)`.
    """

    def __init__(self, home, exclude_backup=None, guard=None):
        self.home = os.path.abspath(os.path.expanduser(home))
        self.exclude_backup = exclude_backup if exclude_backup is not None else default_exclude_backup()
        self.guard = guard or {}
        self.notices = []
        self._said = 0
        self._exclusion_tried = False

    # -- the folder ---------------------------------------------------------------------------------
    def ensure(self):
        """Check the location, then make the store. A store path that is a link is made at the link's
        real target, which `check_location` has judged too (a link to a folder not made yet included)."""
        check_location(self.home, self.guard)
        real = os.path.realpath(self.home)
        created = not os.path.isdir(real)
        if created:
            parent = os.path.dirname(real)
            if parent and not os.path.isdir(parent):
                os.makedirs(parent, exist_ok=True)
            try:
                os.mkdir(real, 0o700)
            except FileExistsError:
                created = False
            if not os.path.isdir(real):
                raise OSError(f"the voice-print store {self.home} leads to {real}, which is not a folder")
        _chmod(real, 0o700)
        readme = os.path.join(real, "README.txt")
        if not os.path.exists(readme):
            _atomic_write(readme, README.encode("utf-8"))
        self._exclude(real)
        return self

    def _exclude(self, real):
        """Exclude the store from backups unless its mark says that was done; once per Store object."""
        mark = os.path.join(real, EXCLUDED_MARK)
        if not self.exclude_backup or self._exclusion_tried or os.path.isfile(mark):
            return
        self._exclusion_tried = True
        try:
            self.exclude_backup(real)
        except Exception as e:  # reported, never fatal
            self.notices.append(f"the voice-print store could not be excluded from Time Machine "
                                f"backups ({e}); exclude {real} by hand (`tmutil addexclusion {real}`) — "
                                f"the next run tries again")
            return
        try:
            _atomic_write(mark, f"excluded from Time Machine backups {now()}\n".encode("utf-8"))
        except OSError:
            pass  # excluded; the next Store excludes it again, which changes nothing

    def unsaid_notices(self):
        """The notices not said yet, now marked said: a verb says each once however often it asks."""
        new = self.notices[self._said:]
        self._said = len(self.notices)
        return new

    def _refuse_outside(self, path, what="folder"):
        """Raise `StoreRefused` unless the real path of `path` (symlinks resolved, also a link that
        points at nothing yet) is inside the store's real path: a sub-folder or a lock file linked out
        of the store — into a synced folder, say — never receives a print. Returns the real path."""
        real = os.path.realpath(path)
        if not _inside(real, os.path.realpath(self.home)):
            raise StoreRefused(f"holding a {what} linked out of it ({path} leads to {real})", self.home)
        return real

    def _dirs(self, folder):
        """Create `folder` and every missing folder between the store and it, each 0700 — at their
        real paths, after `_refuse_outside` has passed on the folder."""
        folder = os.path.abspath(folder)
        if not _inside(folder, self.home):
            raise ValueError(f"{folder} is outside the store")
        real = self._refuse_outside(folder)
        home = os.path.realpath(self.home)
        missing = []
        p = real
        while not os.path.isdir(p) and _key(p) != _key(home):
            missing.append(p)
            p = os.path.dirname(p)
        for d in reversed(missing):
            try:
                os.mkdir(d, 0o700)
            except FileExistsError:
                pass
            _chmod(d, 0o700)

    # -- JSON ---------------------------------------------------------------------------------------
    def write_json(self, path, obj):
        """Write `obj` to `path` atomically: a 0600 temp file in the same folder, fsync, `os.replace`.
        An interrupted write leaves the old file and no temp file."""
        self.ensure()
        path = os.path.abspath(path)
        self._dirs(os.path.dirname(path))
        data = json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n"
        _atomic_write(path, data.encode("utf-8"))

    def read_json(self, path, default=None):
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        except FileNotFoundError:
            return default

    # -- the lock -----------------------------------------------------------------------------------
    @contextlib.contextmanager
    def lock(self, model_id):
        self.ensure()
        folder = self.home if model_id is None else self.model_dir(model_id)
        self._dirs(folder)
        path = self._refuse_outside(os.path.join(folder, ".lock"), "lock file")
        with _LOCKS_GUARD:
            held = _LOCKS.get(path)
            if held is None:
                held = _LOCKS[path] = _Held()
        held.rlock.acquire()
        try:
            if held.count == 0:
                fd = _open_lock(path)
                try:
                    _lock_fd(fd)
                except BaseException:
                    os.close(fd)
                    raise
                held.fd = fd
            held.count += 1
            try:
                yield path
            finally:
                held.count -= 1
                if held.count == 0:
                    fd, held.fd = held.fd, None
                    try:
                        _unlock_fd(fd)
                    finally:
                        os.close(fd)
        finally:
            held.rlock.release()

    # -- layout -------------------------------------------------------------------------------------
    def model_dir(self, model_id):
        return os.path.join(self.home, _component(model_id, "model id"))

    def print_path(self, model_id, pid):
        return os.path.join(self.model_dir(model_id), "prints", _component(pid, "print id") + ".json")

    def calibration_labels_dir(self):
        return os.path.join(self.home, "calibration-labels")

    def signature_dir(self, model_id, audio):
        _component(audio, "audio key")
        return os.path.join(self.model_dir(model_id), "signatures", audio[:2], audio)

    def signature_path(self, model_id, audio, diar_id):
        return os.path.join(self.signature_dir(model_id, audio), _component(diar_id, "diarisation id") + ".json")

    def _json_files(self, folder):
        try:
            names = os.listdir(folder)
        except FileNotFoundError:
            return []
        return [os.path.join(folder, n) for n in sorted(names) if n.endswith(".json") and not n.startswith(".")]

    # -- prints -------------------------------------------------------------------------------------
    def prints(self, model_id, model=None):
        """Every print of the model folder, by id. With `model`, a print made with another model raises
        `ModelMismatch`."""
        out = []
        for path in self._json_files(os.path.join(self.model_dir(model_id), "prints")):
            p = self.read_json(path)
            if p is None:
                continue
            if model is not None:
                check_model(p, model)
            out.append(p)
        return out

    def write_print(self, model_id, p):
        self.write_json(self.print_path(model_id, p["id"]), p)

    # -- signatures ---------------------------------------------------------------------------------
    def read_signature(self, model_id, audio, diar_id, model=None):
        sig = self.read_json(self.signature_path(model_id, audio, diar_id))
        if sig is not None and model is not None:
            check_model(sig, model)
        return sig

    def signatures_for_audio(self, model_id, audio, model=None):
        out = []
        for path in self._json_files(self.signature_dir(model_id, audio)):
            sig = self.read_json(path)
            if sig is None:
                continue
            if model is not None:
                check_model(sig, model)
            out.append(sig)
        return out

    def write_signature(self, model_id, sig, record=None):
        """Write one diarisation's signature file, merging under `lock(model_id)` with what is there:
        `records` gains `record` ({workspace, record}) once per workspace and record; `removed` is the
        union, and a removed label keeps no windows whatever `sig` carries. A file made with another
        model raises `ModelMismatch`; a name-like key anywhere raises ValueError. Returns the file's
        new content."""
        _check_no_names(sig)
        if record is not None:
            _check_no_names(record, "record")
        audio = sig["audio"]
        diar_id = sig["diarization"]["id"]
        self._refuse_outside(self.signature_dir(model_id, audio))   # before the lock file is made
        with self.lock(model_id):
            path = self.signature_path(model_id, audio, diar_id)
            old = self.read_json(path) or {}
            if old and isinstance(old.get("model"), dict) and isinstance(sig.get("model"), dict):
                check_model(old, sig["model"])
            merged = dict(old)
            merged.update({k: v for k, v in sig.items() if k not in ("records", "removed")})
            merged.setdefault("version", 1)
            records, seen = [], set()
            for r in list(old.get("records") or []) + list(sig.get("records") or []) + ([record] if record else []):
                if not isinstance(r, dict) or not r.get("workspace") or not r.get("record"):
                    raise ValueError(f"a signature record is {{workspace, record}}, got {r!r}")
                k = (r["workspace"], r["record"])
                if k not in seen:
                    seen.add(k)
                    records.append({"workspace": r["workspace"], "record": r["record"]})
            removed = sorted(set(old.get("removed") or []) | set(sig.get("removed") or []))
            labels = {k: dict(v) for k, v in (merged.get("labels") or {}).items()}
            for label in removed:
                if label in labels:
                    labels[label]["windows"] = []
            merged["labels"] = labels
            merged["records"] = records
            merged["removed"] = removed
            self.write_json(path, merged)
            return merged

    def remove_windows(self, model_id, audio, diar_id, label):
        """Delete one label's windows from one signature file and add the label to `removed`. False when
        there is no such file."""
        self._refuse_outside(self.signature_dir(model_id, audio))   # before the lock file is made
        with self.lock(model_id):
            path = self.signature_path(model_id, audio, diar_id)
            sig = self.read_json(path)
            if sig is None:
                return False
            labels = sig.get("labels") or {}
            if label in labels:
                labels[label] = dict(labels[label], windows=[])
            sig["labels"] = labels
            sig["removed"] = sorted(set(sig.get("removed") or []) | {label})
            self.write_json(path, sig)
            return True

    # -- never.json and forgotten.json --------------------------------------------------------------
    def _entries(self, name):
        data = self.read_json(os.path.join(self.home, name)) or {}
        return list(data.get("entries") or [])

    def _add_entry(self, name, entry):
        if not isinstance(entry, dict):
            raise ValueError(f"an entry of {name} is an object, got {entry!r}")
        parse_instant(entry.get("at"))
        with self.lock(None):
            entries = self._entries(name)
            if entry not in entries:
                entries.append(entry)
            self.write_json(os.path.join(self.home, name), {"version": 1, "entries": entries})

    def never(self):
        """The entries of never.json: `{workspace, person, name, at}` — people whose voice must not be
        stored, matched by workspace and reference, and by name in other workspaces."""
        return self._entries("never.json")

    def add_never(self, entry):
        self._add_entry("never.json", entry)

    def forgotten(self):
        """The entries of forgotten.json: `{print, known_as, at}`, `at` an instant with an offset."""
        return self._entries("forgotten.json")

    def add_forgotten(self, entry):
        self._add_entry("forgotten.json", entry)


def _chmod(path, mode):
    try:
        os.chmod(path, mode)
    except OSError:
        pass


def _atomic_write(path, data):
    folder = os.path.dirname(path)
    fd, tmp = tempfile.mkstemp(prefix=".tmp-", suffix=".part", dir=folder)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        _chmod(tmp, 0o600)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
