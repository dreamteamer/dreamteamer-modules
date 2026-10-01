---
name: ingesting-meeting-screenshots
description: Use when screenshots taken during meetings need to come out of the INBOX_FOLDERS inbox and onto the meeting's folder — scanning, reading the capture time out of the filename, matching each shot to the meeting it belongs to, and filing it. The mechanics behind /fetch-meeting-screenshots.
---

# ingesting meeting screenshots

**core principle:** the inbox is a queue, and an empty inbox means nothing is pending. Every
`${env:INBOX_FOLDERS}` root's `meeting-screenshots/` is scanned — desktop carries two roots (Drive-synced and
iCloud), web has one. A shot leaves the inbox **exactly once**, moved directly into
`${env:FILES_FOLDER}/meetings/<meeting-basename>/`. There is no `ingested/` staging any more: since
the 2026-08-22 files-folder restructure the inbox and the destination sit in the SAME synced tree, so
`archive` is one local move, not an upload-then-archive pair.

**One folder per meeting, named for the meeting's basename. No per-file records.** The vault
holds a single pointer — `meetings.screenshots_folder`, a FULL
`${env:FILES_FOLDER}/meetings/<meeting-basename>` template — and the folder holds the images
under their original names. The pointer is inert data; a reader renders it with
`dt resolve meetings/<id> screenshots_folder`, which gives a local Drive-for-Desktop path on this
machine and a `gdrive://…` address on a cloud session. A `meeting-screenshots` collection existed for
one day (2026-07-30→31) and was excessive: the only thing it added over the folder was restating a
capture time that is already in the filename.

**Idempotency comes from the queue, not a hash index.** A filed shot has left the inbox entirely — it
was **moved**, not copied — so a re-run cannot see it again. `archive` also REFUSES a same-name
collision at the destination rather than silently overwriting it. ⚠ A shot the operator RENAMES
before re-adding will file again under the new name — visible in the folder, and acceptable because
macOS names screenshots by timestamp and they are not normally renamed. (Recordings still
hash-dedupe; those *do* get renamed by hand.)

## ⚠ LOOK AT A SHOT BEFORE FILING IT

These are screenshots of whatever was on screen during a client call, so they routinely contain
**other people's personal data** — and the pipeline will file anything in the inbox sight unseen.
A shot taken during a call can hold a sensitive document someone shared on screen.

So:

- **Review each matched shot before `archive`.** `scan` is a pure read for exactly this reason.
- **Ask before filing anything showing identity documents, signatures, account numbers or
  addresses of a third party.** The operator may want it excluded, cropped, or kept local.
- **Never transcribe such content into a summary.** Reference it as *"a signed LP subscription page
  (investor PII, not transcribed)"* and stop there.
- **Removal is a MOVE to that inbox root's `trash/`, never a delete.** Agents never delete — see
  `common mistakes` below.

## why the capture time is the whole point

A screenshot exists so the summary can say **what was on screen when something was said**. The capture
time is therefore load-bearing — and it needs no field, because macOS writes the absolute instant into
the FILENAME: `Screenshot 2026-07-30 at 14.46.12.png`, to the second. That is why the filename is kept
verbatim on filing. `scan` parses it and reports `captured_at` + `captured_at_source: filename`;
anything else falls back to mtime with `confident: false`, because a copy re-stamps mtime while the
name survives it.

⚠ **The transcript OFFSET is a different question and usually unanswerable.** It needs
`meeting-recordings.recorded_at`, which has **no automatic source** — a recording file's
`creation_time` is when that copy was written, and the operator uploads to iCloud well after the call.
So do not compute `+16:22` unless a capture carries a trustworthy `recorded_at`. The absolute time
from the filename plus the meeting is what you normally have; say "at 14:26, during the call", not
"16 minutes in".

## paths

```bash
DET=<extensions>/modules/recordings/skills/ingesting-meeting-screenshots/bin/detect.mjs
```

Zero dependencies. `${env:FILES_FOLDER}` (the destination, `meetings/<basename>/`) and
`${env:INBOX_FOLDERS}` (every root's `meeting-screenshots/`, the queue) are the only two declared vars this
skill needs — both resolved by the engine, never parsed out of `.env` a second way. Run from the
repo root.

⚠ **There is no Drive folder id anywhere in this skill.** The destination is `${env:FILES_FOLDER}` plus
the plain NAME `meetings/<basename>` — never a second id to keep in sync with the root. This is the
fourth shape the destination has taken and each earlier one failed differently — see the header
comment in `detect.mjs` (a `mounts` record with an `adapter: gdrive|s3|git` enum, then a dedicated
Drive-folder-id key, then an `.env`-declared root key, then a folder id hard-coded in this script) —
all retired for the same reason: a second id for a folder the root already reaches is a
synchronisation problem wearing the costume of configuration.

## the split: script does mechanics, you do judgment

```bash
node $DET scan [--from YYYY-MM-DD] [--to YYYY-MM-DD]   # pure read — JSON, writes nothing (bar moot-log healing)
node $DET archive <file> <meeting-id>                  # move the original into meetings/<meeting-basename>/
```

`scan` gives per shot: `captured_at` + `captured_at_source` + `confident`, `fingerprint` (reported for
cross-root duplicate detection; nothing stores it long-term), `size`, `duplicate_of`, and `matches[]`.
It does NOT know what is already filed — the inbox is the queue, so anything filed is already gone
from it.

**±1 HOUR IS THE SCOPE BOUNDARY, and it is hard.** A screenshot is only ever considered for a
meeting whose slot it falls within **±1 hour** of. Outside that, it is **out of scope**: report it,
leave it in the inbox, never file it. Do not widen the window to reach a shot, and do not reason
your way to "it's obviously from that call" — if it is outside the hour, it is not in play.

**Matching is TIERED, and the tier is the judgment signal:**

- **`exact`** — the shot falls inside the meeting's slot (or a real recording span when
  `recorded_at` exists). Trust it.
- **`slack`** — only reached when NOTHING matched exactly: the slot widened by ±1 hour, to rescue a
  shot from a call that started late or overran. A `slack` hit deserves a look.
- **`out_of_scope: true`** — no meeting within ±1 h. Reported and left alone. Plenty of the
  operator's screenshots have nothing to do with any call.

Slack never competes with an exact hit, deliberately: a generous window on a 12:00 meeting otherwise
reaches into the 14:00 one and turned nine clean matches into ambiguities (measured 2026-07-30).

**More than one match in the same tier = ask.** Never pick.

### the bias is OMIT, and when unsure you ASK

Operator instruction, 2026-08-02, and it overrides any urge to be helpful by filing more:

> anything outside that window out of scope. unsure about a screenshot? check with me. better to be
> safe than sorry / omit on these ones

Two consequences worth stating plainly, because they are the whole reason for the rule:

- **The cost is asymmetric.** A missed screenshot is recoverable — it sits in the inbox and can be
  filed later. A wrongly matched one files **one client's screen into another client's folder**, and
  fixing it means moving the file back out and telling both meetings apart from the log.
- **This deliberately gives up the overrun case.** The window used to be asymmetric — 15 min before,
  90 after — to catch an 87-minute call in a 30-minute slot. That reach is intentionally
  surrendered. A shot 90 minutes after a slot is now out of scope, and the right move is to **ask**,
  not to restore the old window.

**Never widen the window as a workaround.** If a batch looks systematically out of scope, that is a
finding to report — a wrong meeting time, a missing calendar sync — not a matching problem to solve
by loosening `SLACK_MS`.

## the inbox log — working memory beside the payload

Open an inbox root's `meeting-screenshots/` and it explains itself: a **bare payload is NEW**; a
`<exact-filename>.log` beside it is **IN FLIGHT**; a **processed file is simply gone** — moved to
`${env:FILES_FOLDER}/meetings/<meeting-basename>/`, no record of it left behind but the meeting's own
`screenshots_folder` pointer.

- `archive` writes `seen` (sha256+size) at first touch, `refused` if the destination already holds a
  same-name file, and **deletes the log** the instant the shot is fully filed. `scan` heals a moot
  log — payload already gone — into `<root>/trash/` at the start of every run, and never reads a
  `*.log` as a payload.
- **The payload stays authoritative for state; the log is narrative only.**
- **Web appends the same way every transport does**: no content-update call on the connector, so a
  log write there is read → `create_file` with the same name and merged content →
  `trash_file` the OLD log by its id. Creating before trashing means the worst-case crash duplicates
  a log line rather than losing one.

## steps

1. **`scan`.** Report the counts first — total, then matched / ambiguous / unmatched — before touching
   anything.
2. **Review.** Confirm each `exact` match is plausible, look hard at every `slack` one, and list the
   unmatched rather than forcing them somewhere.
3. **Per confirmed shot: `archive`.**
   ```bash
   node $DET archive "<local path>" "<meeting-id>"
   ```
   This moves the file — keeping its original filename, since that is what carries the capture time —
   straight into `${env:FILES_FOLDER}/meetings/<meeting-basename>/`. On web there is no `detect.mjs`;
   do the equivalent through the connector (`copy_file` into the destination + `trash_file` the
   inbox original), since the connector cannot rename-in-place across folders the way a local `mv`
   can.
4. **Point the meeting at the folder** — once per meeting, not per file, and write the FULL
   template. Single-quote it so the shell does not expand `${…}`; nothing substitutes until
   `dt resolve` is called:
   ```bash
   npm run --silent dt -- set meetings/<meeting-id> \
     'screenshots_folder=${env:FILES_FOLDER}/meetings/<meeting-basename>'
   # check it renders on this machine:
   npm run --silent dt -- resolve meetings/<meeting-id> screenshots_folder
   ```
5. **`npm run check`**, then **report**: which meetings gained visuals and how many, the unmatched
   shots, and anything you asked about.

## common mistakes

| mistake | reality |
|---|---|
| looking for `ingested/` | retired 2026-08-22 — `archive` moves the shot straight to its destination, there is no staging copy |
| looking for `$SCREENSHOTS_LOCAL_DIR` or a Drive folder id in `.env` or in `detect.mjs` | retired — every inbox root is a line of `${env:INBOX_FOLDERS}`, and the destination is `${env:FILES_FOLDER}/meetings/<basename>` by NAME |
| computing a transcript offset without `recorded_at` | there is no automatic anchor; `captured_at` is absolute and that is what you have |
| forcing an unmatched shot into the nearest meeting | many screenshots are unrelated; report them |
| treating a `slack` hit like an `exact` one | slack exists to rescue, not to decide |
| widening `SLACK_MS` to make a shot match | ±1 h is the operator's scope boundary, not a tuning knob. A systematically out-of-scope batch is a finding (wrong meeting time, missing sync), not a matching problem |
| filing an out-of-scope shot because it "obviously" belongs | outside the hour it is not in play. Ask, or leave it |
| resolving an ambiguous shot yourself to save a round trip | the operator asked to be checked with. Omitting is cheap; a wrong file puts one client's screen in another's folder |
| creating a record per screenshot | the folder is the container; the vault holds one pointer |
| slugging or renaming the file on filing | the original filename IS the capture time — keep it |
| deleting a shot instead of moving it | agents never delete — removal is a move to the inbox root's own `trash/`, which the operator empties by hand |
