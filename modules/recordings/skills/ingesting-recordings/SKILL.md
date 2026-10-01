---
name: ingesting-recordings
description: use when audio recordings need to come out of the INBOX_FOLDERS inbox and become meeting-recordings records — scanning for new files, deduping by content hash, parsing the operator's "[date] [who]" filenames, and importing the binary into its durable home under `${env:FILES_FOLDER}`. the mechanics behind /fetch-new-recordings.
---

# ingesting recordings

**core principle:** the inbox is a queue, and **an empty inbox means nothing is pending.** Every
`${env:INBOX_FOLDERS}` root's `meeting-recordings/` is scanned — desktop carries two roots (a Drive-synced
one and an iCloud one, for the phone's zero-friction share sheet), web has one. `import`
sha256-fingerprints the binary and **finishes the job itself**: it moves the original out of the inbox
into its durable home under `${env:FILES_FOLDER}/meeting-recordings/<year>/<month>/` — the path below the
folder IS the record id — and prints that path as `recording_file` for the record. There is no staging
step and **no `media/` copy** — `media/` was retired 2026-08-23 (nothing in the scan path ever read it;
the Drive archive is the only copy), and since the 2026-08-22 files-folder restructure the inbox and the
archive sit in the SAME synced tree, so one `import` call clears the inbox.

**dedup is by sha256 of the file, never by filename.** The operator renames recordings by hand, often
after they are already in the vault; a content hash survives that and a filename does not. The same
recording can also land in more than one inbox root (dropped on the phone AND synced via Drive) —
`scan` flags a cross-root duplicate rather than proposing it twice.

⚠ **but a hash cannot find a recording that has no binary.** A workspace migrated from an older system
can hold dozens of recordings (`scan` prints the live count as `recordings_without_file`) that are
`origin: audio` with no `recording_file` — their transcript exists, their audio was unreachable at the
migration. When one of those files turns up in the inbox it looks brand new, and creating a record for
it makes a **second recording of one meeting**. This is not hypothetical: it happened on the first real
run with `Sam jul23.m4a`. `scan` therefore reports `orphan_candidates` per new file — attach the binary to the
existing recording instead of creating a record.

## when to use

`/fetch-new-recordings` was invoked; the operator dropped recordings and said so; you are about to
create a `meeting-recordings` record for a file that came from the inbox.

**not for:** matching a recording to a meeting (`/match-recording-to-meeting`), transcribing
(`transcribing-recordings`), or anything about a recording that did not come from the inbox.

## the recordings inbox flow

⚠ **Transport facts this skill needs, stated here on purpose.** This module is self-contained and
may not cite a file in another module. On desktop, every `${env:INBOX_FOLDERS}` root is a plain synced
folder — scan, hash, file and log-append are ordinary filesystem operations, no Drive API call anywhere
in this recurring flow. On web the transport is the **claude.ai Google Drive connector**
(`mcp__claude_ai_Google_Drive__*`) — web, mobile and CLI. It **reads and copies but CANNOT move or
delete**: `search_files`, `list_recent_files`, `get_file_metadata`, `get_file_permissions`,
`read_file_content`, `download_file_content`, `copy_file`, `create_file`.

⚠ **Every `create_file` here MUST pass `disableConversionToGoogleType: true`.** The connector converts
uploaded content into a Google first-party type by default, so an uploaded `.m4a` (or a log written as
`text/markdown`) could land as a **Google Doc**. Audio has no Google equivalent and should pass through
untouched, but pass the flag on every upload rather than remembering which types are safe. Not yet
measured live — the connector session expired before the probe ran, so this comes from the tool's own
contract. **Read back `mimeType` with `get_file_metadata` on the first upload of a session.**

**Two entry points. Both converge at step 2.**

| entry | when |
|---|---|
| **A — the inbox** | audio sitting in an `${env:INBOX_FOLDERS}` root's `meeting-recordings/`. Desktop: `detect.mjs scan` walks every root. Web: the connector reads the one Drive root directly, since `detect.mjs` is a local-fs script and cannot run there |
| **B — attached to the message** | **the primary path on web and mobile** |

### entry B — the audio is in the message

1. `dt add meeting-recordings --name "<who and what>" --date YYYY-MM-DD --origin audio`
2. Transcribe straight from the uploaded path — `run` takes any path ffmpeg can open:
   `cd <extensions>/modules/recordings/skills/transcribing-recordings && uv run python transcribe_meeting.py run "<abs record.md>" "<abs audio>" --speakers N --language he|en`
3. Optionally upload the bytes to `${env:FILES_FOLDER}/meeting-recordings/<year>/<month>/` with `create_file`
   (`base64Content` + `contentMimeType` + `disableConversionToGoogleType: true`).

⚠ **Step 3 is optional, and skipping it matters.** Without it the audio has no durable home and the
**transcript is the durable artifact**; with it, the audio's home is Drive. Say which case you're in
rather than implying the audio was kept when it was not.

### entry A — the inbox

**On the connector (web), no `detect.mjs`.** Search the inbox root's `meeting-recordings/` for a name not
already known, `download_file_content` to read it, and follow the same classify → dedupe → file steps
by hand, writing the `<name>.log` sidecar yourself (see "the inbox log" below) since there is no
script to do it. **On desktop, `detect.mjs` does all of this:**

1. **Scan.** `node $DET scan` walks every configured root's `meeting-recordings/` — sha256 fingerprint +
   `ffprobe` duration + filename parse for each file, JSON out, and it moots any stray `.log` (below)
   into `trash/` as it goes. Otherwise pure read.
2. **Dedupe** by fingerprint against existing `meeting-recordings` records — `scan` already does
   this and reports `known` per file. ⚠ **Not optional** — on web the original stays in the inbox
   until it is filed, so a second run sees the same file again.
3. **Classify**: date · who · duration · sha256 fingerprint, from the filename convention
   `[date] [who]` plus `ffprobe`.
4. **File**: `node $DET import <file> --id <recording-id>` fingerprints the binary and moves the
   original into `${env:FILES_FOLDER}/meeting-recordings/<year>/<month>/`, printing that path as
   `recording_file`. Then `dt add meeting-recordings` for the record.
5. **Transcribe** (`transcribe_meeting.py run`), then match to a meeting.
   ⚠ **Pass `--speakers N`.** Unknown-count diarization can bus-error inside sherpa-onnx when the
   audio resolves to one voice; the run survives via a subprocess guard but loses speaker turns.
   Use `--speakers 1` for a genuinely solo recording — it skips diarization entirely.

## the inbox log — working memory beside the payload

Open an inbox root's `meeting-recordings/` and it explains itself: a **bare payload is NEW**; a
`<exact-filename>.log` beside it is **IN FLIGHT** and says what already happened; a **processed file
is simply gone** — moved to `${env:FILES_FOLDER}/meeting-recordings/<year>/<month>/`, referenced by its record's
`recording_file`, and its log deleted.

- `import` writes `seen` (sha256+size) at first touch, `refused` before it dies (destination already
  exists, copy-verification failed, archive-destination already taken, archive move failed), and
  **deletes the log** the moment the payload is fully filed. `scan` heals a moot log — one whose
  payload is already gone — into `<root>/trash/` at the start of every run.
- **The payload stays authoritative for state; the log is narrative only.** Nothing here or
  downstream ever decides from the log — every action is payload-first, log-second.
- **Web appends the same way every transport does, per the design's §3.2b recipe**: the connector has
  no content-update call, so appending a line means read the existing log (if any) → `create_file`
  with the **same name** and the merged content → `trash_file` the OLD log by its id. Creating before
  trashing means the worst-case crash leaves two logs with the same name (a reader takes the newest),
  never zero.
- `bin/clear-pending.mjs` (desktop, pure fs) executes any unfinished `pending <action>` line and
  appends `done` — this skill's flow rarely produces one, since filing here is already a single move.

## paths

This skill executes from its **module source**, not the generated `.claude/skills/` copy — compile
overwrites and prunes that one.

```bash
DET=<extensions>/modules/recordings/skills/ingesting-recordings/bin/detect.mjs
```

Zero dependencies. Needs `ffprobe` on PATH (already a `transcribing-recordings` prerequisite) and
`${env:INBOX_FOLDERS}` resolving to at least one usable root. Run from the repo root so `.env`
resolves.

## the split: the script does mechanics, you do judgment

```bash
node $DET scan                          # pure read — JSON, nothing written or moved (bar moot-log healing)
node $DET import <file> --id <recording-id>   # fingerprint → move the original into meeting-recordings/<year>/<month>/
```

(`backfill-fingerprints` was a third verb until 2026-08-23 — it hashed records that had a `media/`
path but no fingerprint, and retiring `media/` left it nothing to read, so it went with the folder.)

`import` finishes the job in one call: the original leaves the inbox for its durable archive. There
is no second stage to run after it, and no local copy — the printed `recording_file` is the only home.

`scan` gives you, per file: `known` (the recording id it already matches, or `null`), `duplicate_of` (a
cross-root duplicate fingerprint), `proposed_id`, `name`, `date`, `time_hint`, `duration`,
`fingerprint`, `size_mb`, `date_source`, `confident`.

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
  evidence but not proof; two back-to-back calls of similar length would look the same. Note the
  candidate's duration comes from ASR and the incoming file's from ffprobe, so they agree to a few
  seconds, never exactly.

## steps

1. **`scan`.** Report the counts first — total / already-in-vault / cross-root duplicates / new —
   before touching anything.
2. **Review the new ones.** Fix names (Hebrew gloss, obvious typos), sanity-check any
   `confident: false` date, and ask about suspiciously short files.
3. **Check `orphan_candidates` BEFORE creating anything.** For a `strong` candidate (and a `plausible`
   one you have confirmed): `import` the binary under the **existing** recording's id, then write
   `recording_file:` and `fingerprint:` onto that record, move `confidence` up from `low`, and say in
   `creation_context` that the binary was recovered. Do **not** create a new record — that is a second
   recording of one meeting, and the meeting already points at the first.
4. **Per genuinely new file: `import` first, then create the record.** Import is the side-effecting
   step; if it fails the vault is untouched. Once it succeeds, set the record from its output:
   ```bash
   npm run --silent dt -- add meeting-recordings \
     --id <proposed_id> --name "<name>" --date <date> \
     --recording_file '<recording_file from import, as the ${env:FILES_FOLDER}/… template>' \
     --duration <duration> --fingerprint <fingerprint> --origin audio \
     --author "agents/dreamteamer (<your model>)" \
     --source "file:<the original inbox path>" \
     --creation_context "detected in \${env:INBOX_FOLDERS} meeting-recordings/ on <today>; <anything the operator should know>"
   ```
   **No `meeting` ref** — that is `/match-recording-to-meeting`'s job, and its absence is exactly what
   makes that command show as *available*.
6. **Report** the imported ids, the skipped-as-known count, anything you asked about, and confirm the
   inbox is empty (or name what is still sitting there and why).

## common mistakes

| mistake | reality |
|---|---|
| deduping on filename | the operator renames files; hash on content, which is what `scan` does |
| `import` before deciding the id | the id is in the media filename — importing twice under two ids leaves two copies |
| moving the original before verifying the copy | `import` is copy → sha256-verify → move, in that order, on purpose |
| setting `meeting:` here | breaks the two-way invariant (`check`'s `x-inverse` rule) and hides the match step |
| creating a record when `orphan_candidates` has a strong hit | that's a second recording of one meeting. attach the binary to the recording that has been waiting for it. |
| running from `.claude/skills/ingesting-recordings/` | compile overwrites that copy; run from the module source |
| looking for `ingested/` or `processed/` | retired 2026-08-22 — `import` moves the original straight to its durable archive in one call, no staging |
| looking for `$RECORDINGS_DIR` in `.env` | retired the same day — every inbox root is a line of `${env:INBOX_FOLDERS}` |
| **reading an empty inbox as "nothing is pending"** | it can equally mean **nothing can arrive**. On 2026-08-05 four recordings were stuck on the phone behind a full iCloud while four `/process-new-meetings` runs all reported a clean inbox. When an inbox root is cloud-synced, check the quota too |
| deleting a local original because the upload "looked fine" | equal byte counts are not proof of equal bytes. `import` only moves the original after its own sha256 check passes |
