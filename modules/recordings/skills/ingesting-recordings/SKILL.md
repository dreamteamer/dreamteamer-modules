---
name: ingesting-recordings
description: use when audio recordings need to come out of the INBOX_FOLDERS inbox and become meeting-recordings records — scanning for new files, deduping by content hash, parsing "[date] [who]" filenames, and importing the binary into its durable home under `${env:FILES_FOLDER}`. the mechanics behind /fetch-new-recordings.
---

# ingesting recordings

**core principle:** the inbox is a queue: **a file in it is pending, and a filed one is gone from it.** Every
`${env:INBOX_FOLDERS}` root's `meeting-recordings/` is scanned — a desktop may carry two roots (a
synced-drive one and a phone-share one), a cloud session one. `import` sha256-fingerprints the binary
and **finishes the job itself**: it copies the file to `${env:FILES_FOLDER}/meeting-recordings/<id>.<ext>`
— named after the record id, so the archive is self-indexing — verifies the copy by sha256, moves the
original into that inbox root's `trash/`, and prints the archive path as `recording_file` for the
record. One `import` call clears the file from the inbox; `trash/` is yours to empty, and until then it
is the undo.

**dedup is by sha256 of the file, never by filename.** Recordings get renamed by hand, often after they
already have a record; a content hash survives that and a filename does not. The same recording can
also land in more than one inbox root (dropped on the phone AND synced from the desktop) — `scan` flags
a cross-root duplicate rather than proposing it twice.

**but a hash cannot find a recording that has no binary.** A workspace migrated from an older system
can hold recordings (`scan` prints the count as `recordings_without_file`) that are `origin: audio`
with no `recording_file` — their transcript exists, their audio was unreachable at the migration. When
one of those files turns up in the inbox it looks brand new, and creating a record for it makes a
**second recording of one meeting**. `scan` therefore reports `orphan_candidates` per new file — attach
the binary to the existing recording instead of creating a record.

## when to use

`/fetch-new-recordings` was invoked; recordings were dropped into the inbox and you were told so; you
are about to create a `meeting-recordings` record for a file that came from the inbox.

**not for:** matching a recording to a meeting (`/match-recording-to-meeting`), transcribing
(`transcribing-recordings`), or anything about a recording that did not come from the inbox.

## two entry points

| entry | when |
|---|---|
| **A — the inbox** | audio sitting in an `${env:INBOX_FOLDERS}` root's `meeting-recordings/`. `detect.mjs` walks every root; it is a local-filesystem script, so this entry needs the inbox mounted on this machine |
| **B — attached to the message** | a file handed straight to the session. The route that works everywhere, including a cloud session with no inbox mounted |

### entry B — the audio is in the message

1. `npx dt add meeting-recordings --name "<who and what>" --date YYYY-MM-DD --origin audio`
2. Optional, and only where `FILES_FOLDER` is a local folder: `node $DET import <uploaded-file> --id <recording-id>`
   files the bytes and prints the `recording_file` and `fingerprint` to set on the record. `import`
   refuses a non-local `FILES_FOLDER` (a `gdrive://…` value) rather than creating folders inside the repo.
3. Transcribe it with the `transcribing-recordings` skill's direct-upload route.

Without step 2 the audio has no durable home and the **transcript is the durable artifact**. Say which
case you are in rather than implying the audio was kept when it was not.

### entry A — the inbox

`detect.mjs` does the mechanics:

1. **Scan.** `node $DET scan` walks every configured root's `meeting-recordings/` — sha256 fingerprint +
   `ffprobe` duration + filename parse for each file, JSON out. It moves any moot `.log` (below) into
   `trash/` as it goes; otherwise it is a pure read.
2. **Dedupe** by fingerprint against existing `meeting-recordings` records — `scan` already does this
   and reports `known` per file. A known file needs no record.
3. **Classify**: date · who · duration · sha256 fingerprint, from the filename convention `[date] [who]`
   plus `ffprobe`.
4. **File**: `node $DET import <file> --id <recording-id>` copies the binary to
   `${env:FILES_FOLDER}/meeting-recordings/<recording-id>.<ext>`, verifies it, moves the original into
   `trash/`, and prints `recording_file`. Then `npx dt add meeting-recordings` for the record.
5. **Then match, then transcribe**: `/match-recording-to-meeting` first, because the linked meeting's
   attendees give the transcriber its speaker count; then `/transcribe-recording`.

## the inbox log — working memory beside the payload

Open an inbox root's `meeting-recordings/` and it explains itself: a **bare payload is NEW**; a
`<exact-filename>.log` beside it is **IN FLIGHT** and says what already happened; a **processed file is
gone** — copied to `${env:FILES_FOLDER}/meeting-recordings/<id>.<ext>`, referenced by its record's
`recording_file`, the original in `trash/`, and its log deleted.

- `import` writes `seen` (sha256+size) at first touch, `refused` before it dies (FILES_FOLDER
  unresolved or not local, archive destination already taken, copy failed, copy verification failed),
  and **deletes the log** the moment the payload is fully filed. `scan` moves a moot log — one whose
  payload is already gone — into `<root>/trash/` at the start of every run.
- **The payload stays authoritative for state; the log is narrative only.** Nothing here or downstream
  ever decides from the log — every action is payload-first, log-second.

## paths

Run from the workspace root:

```bash
DET=.dreamteamer/skills/ingesting-recordings/bin/detect.mjs
```

Zero dependencies. Needs `ffprobe` on PATH (already a `transcribing-recordings` prerequisite) and
`${env:INBOX_FOLDERS}` resolving to at least one usable root; `import` also needs `${env:FILES_FOLDER}`.

## the split: the script does mechanics, you do judgment

```bash
node $DET scan                                # pure read — JSON, nothing written or moved (bar moot logs)
node $DET import <file> --id <recording-id>   # copy → verify → original to trash/; prints recording_file
```

`scan` gives you, per file: `known` (the recording id it already matches, or `null`), `duplicate_of` (a
cross-root duplicate fingerprint), `proposed_id`, `name`, `name_is_transliterated`, `date`,
`time_hint`, `duration`, `fingerprint`, `size_mb`, `date_source`, `confident`, and for a new file
`orphan_candidates`.

**What the script deliberately will not decide:**

- **a Hebrew or garbled name.** `name_is_transliterated: true` means the slug came from a character
  map, not a translation. Write `name` as `<original> (English gloss)` the way `fetching-meetings`
  does for Hebrew titles — the slug in the id stays the transliteration.
- **whether `confident: false` is acceptable.** That means no date was parseable and the file's mtime
  was used. Keep it, but set `confidence: low` and say so in `creation_context`.
- **whether a file is worth a record at all.** A 1–2 minute recording is usually a false start. Ask
  before importing it rather than filing noise.
- **whether an `orphan_candidate` is the same recording.** `strength: strong` means a record literally
  names this filename — trust it. `plausible` means same date + duration within 15s, which is good
  evidence but not proof; two back-to-back calls of similar length would look the same. The
  candidate's duration comes from ASR and the incoming file's from ffprobe, so they agree to a few
  seconds, never exactly.

## steps

1. **`scan`.** Report the counts first — `total` / `already_in_vault` / `duplicates_across_roots` /
   `new` — before touching anything.
2. **Review the new ones.** Fix names (Hebrew gloss, obvious typos), sanity-check any
   `confident: false` date, and ask about suspiciously short files.
3. **Check `orphan_candidates` BEFORE creating anything.** For a `strong` candidate (and a `plausible`
   one you have confirmed): `import` the binary under the **existing** recording's id, then write
   `recording_file:` and `fingerprint:` onto that record, move `confidence` up from `low`, and say in
   `creation_context` that the binary was recovered. Do **not** create a new record — that is a second
   recording of one meeting, and the meeting already points at the first.
4. **Per genuinely new file: `import` first, then create the record.** Import is the side-effecting
   step; if it fails the workspace is untouched. Once it succeeds, set the record from its output:
   ```bash
   npx dt add meeting-recordings \
     --id <proposed_id> --name "<name>" --date <date> \
     --recording_file '<recording_file from import, as the ${env:FILES_FOLDER}/… template>' \
     --duration <duration> --fingerprint <fingerprint> --origin audio \
     --author agents/<harness> \
     --source "file:<the original inbox path>" \
     --creation_context "<your model>; detected in \${env:INBOX_FOLDERS} meeting-recordings/ on <today>; <anything worth knowing>"
   ```
   `--author` names the harness (`agents/claude-code`); the model goes in `creation_context`.
   **No `meeting` ref** — that is `/match-recording-to-meeting`'s job, and its absence is exactly what
   makes that command show as *available*.
5. **Report** the imported ids, the skipped-as-known count, anything you asked about, and confirm the
   inbox is empty (or name what is still sitting there and why).

## common mistakes

| mistake | reality |
|---|---|
| deduping on filename | files get renamed; hash on content, which is what `scan` does |
| `import` before deciding the id | the archive file is named after the id — importing twice under two ids leaves two copies |
| removing the original before verifying the copy | `import` is copy → sha256-verify → move to `trash/`, in that order, on purpose |
| setting `meeting:` here | skips the match step, where the meeting is chosen on evidence (`/match-recording-to-meeting`) |
| creating a record when `orphan_candidates` has a strong hit | that's a second recording of one meeting. attach the binary to the recording that has been waiting for it. |
| running from a harness skill folder (`.claude/skills/…`) | compile regenerates those copies; run `.dreamteamer/skills/ingesting-recordings/bin/detect.mjs` from the workspace root |
| **reading an empty inbox as "nothing is pending"** | it can equally mean **nothing can arrive** — a phone whose cloud storage is full holds recordings back while every scan reports a clean inbox. When an inbox root is cloud-synced, check the quota too |
| deleting a local original because the upload "looked fine" | equal byte counts are not proof of equal bytes. `import` only lets go of the original after its own sha256 check passes |
