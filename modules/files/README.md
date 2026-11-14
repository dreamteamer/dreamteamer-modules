# @dreamteamer/files

The files under your mounted folders — a synced drive, a cloud folder, a local archive — as records.
A `file-drives` record names one folder and the subfolders you want indexed; `npx dreamteamer files
sync` walks it and keeps one `files` record per file or folder, so "which files does nothing
reference", "what landed in this folder" and "what did I note about that PDF" are queries rather
than a `find`.

```bash
npm install @dreamteamer/files
npx dreamteamer compile
```

## setup

One input: `FILES_FOLDER`, the mounted root your `file-drives` records resolve under. The module's
setup unit, `files`, has the engine write it into `.env`:

```bash
npx dreamteamer setup files --input files_folder=<folder>
npx dreamteamer status          # configured once the key is set and the folder exists; blocked when it is not mounted
```

Nothing downloads and nothing reaches the network. [SETUP.md](SETUP.md) is the reference; the
`working-with-files` skill and `/sync-files` carry the procedure.

## the two collections

- **`file-drives`** — one record per mounted folder. `path` is a `${env:NAME}` template (declare
  `NAME` in your workspace's `dreamteamer.vars`, set it in `.env`); `include` lists the top-level
  subfolders to index by name (empty = everything; a nested `rnd/sub` matches nothing), `exclude`
  skips a name at any depth (`trash`), a path from the drive's folder (`rnd/old`), or an extension
  (`*.log`). `index` picks one line of a newline-separated variable.
- **`files`** — one record per file or folder, id `<drive>/<relative path>`, stored at
  `data/files/<drive>/<relative path>.file.md`, so the index mirrors the folder tree. Sync owns the
  derived fields (path, kind, size, modified, hash, local, status, preview, referenced_by) and never
  writes `description`, `tags` or the notes body — those are yours.

## the verbs

```bash
npx dreamteamer files sync                    # every drive
npx dreamteamer files sync drive/rnd          # one subfolder of one drive
npx dreamteamer files sync --dry-run          # the plan, no writes
npx dreamteamer files status                  # per drive: mounted, entries, missing, cloud-only
```

A second sync over an unchanged tree writes nothing. A file that vanished is marked `missing`, never
deleted; a file whose hash reappears under a new name is a rename, so typed references follow; a
`${env:…}` string pointer does not. Hashing
reads only files whose bytes are on disk and at most `hash_max_bytes` (64 MB by default) — a file a
sync client evicted to the cloud is marked `local: false` and left alone.

Other modules point at a file either as a string `${env:NAME}/<relative path>` or as a typed
reference `files/<drive>/<relative path>`; both resolve to the same record and both count in
`referenced_by`. A record that points at a file is listed in that file's `referenced_by`, so `npx dreamteamer rm`
of the pointing record names the files record — pass `--force`, and the next sync drops the stale
entry.

`npx dreamteamer doctor` shows each drive's state on this machine; `npx dreamteamer check` reports an
entry whose id disagrees with its drive and path.

## 0.3.1 — the nav is nav.yaml (cr-dt-008)

`display.nav.order` and `display.nav.section` removed from its two descriptors — the nav is `nav.yaml` at the workspace root (engine 0.49), which you arrange; `display.nav.icon` stays. Nothing to do.

## 0.3.0 — on engine 0.48.0: the engine writes `.env` (CR-dt-007)

Nothing to do but `dt update @dreamteamer/files` on dreamteamer 0.48.0 or later, then `dt compile`; nothing a
workspace's records do changes. `FILES_FOLDER` is now an env action the engine writes into `.env` (confined, fingerprint-checked, refused when git would commit `.env`, never printed); the module carries no copy of the setup kit and no `apply` for it.

## 0.2.0 — on engine 0.47.0 (CLI-first module lifecycle, CR-dt-006)

Nothing to do but `dt compile` after `dt update @dreamteamer/files` on dreamteamer 0.47.0 or later (the engine floor is `>=0.47.0`). New: the `files` setup unit (`dt setup files`): FILES_FOLDER recorded in `.env` by `dt install`.
