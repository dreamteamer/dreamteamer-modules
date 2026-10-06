# @dreamteamer/files

The files under your mounted folders — a synced drive, a cloud folder, a local archive — as records.
A `file-drives` record names one folder and the subfolders you want indexed; `dt files sync` walks it
and keeps one `files` record per file or folder, so "which files does nothing reference", "what
landed in this folder" and "what did I note about that PDF" are queries rather than a `find`.

```bash
npm install @dreamteamer/files
npx dreamteamer compile
```

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
`referenced_by`. A record that points at a file is listed in that file's `referenced_by`, so `dt rm`
of the pointing record names the files record — pass `--force`, and the next sync drops the stale
entry.

`dt doctor` shows each drive's state on this machine; `dt check` reports an entry whose id disagrees
with its drive and path.
