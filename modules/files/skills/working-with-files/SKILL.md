---
name: working-with-files
description: use when files on a mounted folder — a synced drive, a cloud folder, an inbox — should be known to the workspace as records, when `data/files` has to be brought level with the disk, when a record should point at a file, or when asked which files nothing references. The mechanics behind /sync-files and the `file-drives` · `files` collections.
---

# working with files

**core principle:** the index mirrors the disk, and you annotate the index. A `file-drives` record
names a folder; `dt files sync` keeps one `files` record per file or folder under it, at the same
relative path under `data/files/`. Sync owns the derived fields; `description`, `tags` and the
`notes` body are yours, and sync never writes them.

## the two collections

- **`file-drives`** — one per mounted folder. `path` is a `${env:NAME}` template (declare `NAME` in
  the workspace's `dreamteamer.vars`, set it in `.env`); `include` names the top-level subfolders to
  index — EMPTY MEANS EVERYTHING, so a folder that also holds material this workspace must not see
  lists only what it may see; `exclude` prunes a prefix (`trash`) or an extension (`*.log`), and a
  name starting with a dot is always skipped; `index` picks one line of a newline-separated
  variable; `preview` and `hash_max_bytes` tune what sync reads. Sync stamps `last_synced` and
  `entries` on the drive on its first sync and on any sync that changed the drive's records or its
  entry count — a run that changes nothing leaves the drive record as it was, so `git status` stays
  clean.
- **`files`** — id `<drive>/<relative path>`, verbatim. Sync writes `drive` · `path` · `name` · `kind`
  · `ext` · `mime` · `bytes` · `modified` · `local` · `status` · `hash` · `preview` · `referenced_by`.
  You write `description`, `tags` and `notes`.

## the verbs

```bash
npx dt files sync                 # every drive
npx dt files sync drive           # one drive
npx dt files sync drive/rnd       # one subfolder — records outside it are not touched
npx dt files sync --dry-run       # the plan, nothing written
npx dt files sync --hash          # fill in hashes still missing
npx dt files sync --rehash        # recompute every hash
npx dt files sync --prune         # remove missing entries nobody annotated or references
npx dt files status               # per drive: mounted here, entries, missing, cloud-only, last synced
```

Read the summary line per drive: `walked · added · updated · moved · missing · unchanged`, followed
by `pruned N` and `unhashed N` when either is non-zero. A second run over an unchanged tree reports
`added 0 · updated 0` and writes nothing. A sync writes records but does not commit them; when it
wrote any, it prints the pending line `dreamteamer commit file-drives/<drive> files/<drive>/…`. The
`…` is not a target: `dt commit` takes a whole collection or one `<collection>/<id>`, matched
exactly, never a prefix. `git status --short --untracked-files=all data/files data/file-drives` lists
the records this run wrote; name each of them in the commit, never an unscoped commit.

## what sync does, and does not

- **Changed** means `bytes` or `modified` differ, or a file first seen evicted (`local: false`) now
  has its bytes on disk. Only then is it re-hashed and re-previewed — unless you pass `--hash`
  (fills hashes still missing) or `--rehash` (recomputes all).
- **Hashing** reads a file only when its bytes are on disk (`local: true`) and it is at most the
  drive's `hash_max_bytes`. A cloud client that evicted a file leaves a size and no blocks; reading
  it would download it, so sync does not. A file that could not be read is counted `unhashed` and
  left without a `hash`.
- **Previews** are written for text-like files (markdown, text, csv, tsv, json, yaml, html, eml,
  log) whose bytes are on disk, cut at 32 KB of characters. A file over 8 MB, or one holding binary
  bytes, gets no `preview`; neither does a PDF or a Word document. `preview: false` on the drive
  turns them off.
- **Missing** is a state, not a deletion: a file gone from disk leaves its record with
  `status: missing`, because the record may carry your notes and inbound references.
- **A move** is a new file whose hash a vanished record carries: the record is renamed, and every
  typed reference to it is rewritten by the engine's rename; a `${env:…}` string naming the old
  path is not. An empty file never matches a move — every empty file has the same hash.
- **`--prune`** removes a missing entry only when it has no `description`, `tags` or `notes`, no
  record anywhere holds `files/<id>`, and no record holds its `${env:…}` string either.
- **`referenced_by`** is rebuilt from every other collection's records: a typed reference
  `files/<drive>/<relative path>`, or the string `${env:NAME}/<relative path>` as modules already
  write it. Prose mentioning a path does not count. For a drive with `index` set only the typed form
  counts, because the string form cannot say which line it means.
- **A skipped drive** — its variable undeclared or unset on this machine, an `index` that does not
  pick a line, or the folder absent — is reported and left alone; the run still exits 0, so a clone
  without the mount syncs nothing cleanly.

## pointing at a file from another record

Either form resolves to the same `files` record and both count in its `referenced_by`:

- a string field: `${env:NAME}/<relative path>` — what a module that knows nothing about this module writes;
- a reference field of type `files`: `files/<drive>/<relative path>` — rename-safe, link-rendered.

## adding a drive

```bash
npx dt add file-drives "Drive" --path '${env:FILES_FOLDER}' --include rnd --include meetings --exclude trash
npx dt files sync drive --dry-run
npx dt files sync drive
```

Repeat `--include` once per subfolder. Before the first real sync, read the dry run: its `added`
count is the number of records about to be written.

## when something looks wrong

- `dt files status` says the drive does not resolve: the variable is not in `dreamteamer.vars`, has
  no value in this machine's `.env`, or the drive's `index` picks no line of it. `dt doctor` shows
  every drive under one `files` capability, each failing row with its fix; one drive that does not
  resolve marks the capability UNAVAILABLE.
- Every file reports as updated on a run where you changed nothing: the sync client rewrote the
  dates. Sync re-reads those files and writes the new `modified`; a local file under `hash_max_bytes`
  keeps its `hash` where the bytes did not change; an evicted one has its hash cleared until it lands
  and is re-read. The next run is quiet again.
- `dt check` reports an id that disagrees with drive and path: the record was hand-edited; fix the
  field or `dt rename` the record.
