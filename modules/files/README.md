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
  subfolders to index (empty = everything), `exclude` prunes prefixes (`trash`) and extensions
  (`*.log`). `index` picks one line of a newline-separated variable.
- **`files`** — one record per file or folder, id `<drive>/<relative path>`, stored at
  `data/files/<drive>/<relative path>.file.md`, so the index mirrors the folder tree. Sync owns the
  derived fields (path, kind, size, modified, hash, local, status, preview, referenced_by) and never
  touches `description`, `tags` or the notes body — those are yours.

## the verbs

```bash
npx dreamteamer files sync                    # every drive
npx dreamteamer files sync drive/rnd          # one subfolder of one drive
npx dreamteamer files sync --dry-run          # the plan, no writes
npx dreamteamer files status                  # per drive: mounted, entries, missing, cloud-only
```

A second sync over an unchanged tree writes nothing. A file that vanished is marked `missing`, never
deleted; a file whose hash reappears under a new name is a rename, so references follow. Hashing
reads only files whose bytes are on disk and at most `hash_max_bytes` (64 MB by default) — a file a
sync client evicted to the cloud is marked `local: false` and left alone.

Other modules point at a file either as a string `${env:NAME}/<relative path>` or as a typed
reference `files/<drive>/<relative path>`; both resolve to the same record and both count in
`referenced_by`.

`dt doctor` shows each drive's state on this machine; `dt check` reports an entry whose id disagrees
with its drive and path.
