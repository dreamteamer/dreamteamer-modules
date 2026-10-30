---
name: ingesting-meeting-screenshots
description: Use when screenshots taken during meetings need to come out of the INBOX_FOLDERS inbox and onto the meeting's folder — scanning, reading the capture time out of the filename, matching each shot to the meeting it belongs to, and filing it. The mechanics behind /fetch-meeting-screenshots.
---

# ingesting meeting screenshots

**core principle:** the inbox is a queue, and an empty inbox means nothing is pending. Every
`${env:INBOX_FOLDERS}` root's `meeting-screenshots/` is scanned — a desktop may carry several roots
(a Drive-synced one, an iCloud one), a cloud session one. A shot leaves the inbox **exactly once**,
moved directly into `${env:FILES_FOLDER}/meetings/<meeting-id>/screenshots/`. When the inbox and the
destination sit in the same synced tree, `archive` is one local move.

**One folder per meeting, named for the meeting's full id. No per-file records.** The workspace
holds a single pointer — `meetings.screenshots_folder`, a FULL
`${env:FILES_FOLDER}/meetings/<meeting-id>/screenshots` template — and the folder holds the images
under their original names. The pointer is inert data; a reader renders it with
`npx dt resolve meetings/<meeting-id> screenshots_folder`, which gives a local path on a machine with
the synced folder and a `gdrive://…` address on a cloud session. The capture time is already in each
filename, so no record restates it.

**Idempotency comes from the queue, not a hash index.** A filed shot has left the inbox entirely — it
was **moved**, not copied — so a re-run cannot see it again. `archive` also refuses a same-name
collision at the destination rather than overwriting it. A shot renamed before it is re-added files
again under the new name, which is visible in the folder; screenshots are named by timestamp and are
not normally renamed.

## LOOK AT A SHOT BEFORE FILING IT

These are screenshots of whatever was on screen during a call, so they routinely contain **other
people's personal data**, and the script will file anything in the inbox sight unseen.

- **Review each matched shot before `archive`.** `scan` is a pure read for exactly this reason.
- **Ask before filing anything showing identity documents, signatures, account numbers or
  addresses of a third party.** The person may want it excluded, cropped, or kept local.
- **Never transcribe such content into a summary.** Reference it as *"a signed form (third-party
  personal data, not transcribed)"* and stop there.
- **Removal is a MOVE to that inbox root's `trash/`, never a delete.** Agents never delete.

## why the capture time is the whole point

A screenshot exists so a summary can say **what was on screen when something was said**. The capture
time needs no field: macOS writes it into the FILENAME, `Screenshot YYYY-MM-DD at HH.MM.SS.png`, to
the second, which is why the filename is kept verbatim on filing. That time carries no zone, so `scan`
reads it in each candidate meeting's own zone (its `timezone`, else the offset on its `starts`) and
reports the instant and zone it matched on per match (`captured_instant`, `zone`). It reports
`captured_at` + `captured_at_source: filename`; a name without a time falls back to mtime with
`confident: false`, because a copy re-stamps mtime while the name survives it.

**The transcript OFFSET is a different question and usually unanswerable.** It needs
`meeting-recordings.recorded_at` from the recordings module, which has **no automatic source** — a
recording file's `creation_time` is when that copy was written, often well after the call. So do not
compute `+16:22` unless a recording carries a trustworthy `recorded_at`. The absolute time from the
filename plus the meeting is what you normally have; say "at 14:26, during the call", not "16 minutes
in".

## paths

```bash
DET=.dreamteamer/skills/ingesting-meeting-screenshots/bin/detect.mjs
```

Zero dependencies. `${env:FILES_FOLDER}` (the destination, `meetings/<meeting-id>/screenshots/`) and
`${env:INBOX_FOLDERS}` (every root's `meeting-screenshots/`, the queue) are the only two declared vars
this skill needs — both resolved by the engine, never parsed out of `.env` a second way. Run from the
workspace root.

There is no Drive folder id anywhere in this skill. The destination is `${env:FILES_FOLDER}` plus the
plain name `meetings/<meeting-id>/screenshots`, so there is no second id to keep in sync with the root.

## the split: script does mechanics, you do judgment

```bash
node $DET scan [--from YYYY-MM-DD] [--to YYYY-MM-DD]   # pure read — JSON, writes nothing (bar moot-log healing)
node $DET archive <file> <meeting-id>                  # move the original into meetings/<meeting-id>/screenshots/
```

`scan` gives per shot: `captured_at` + `captured_at_source` + `confident`, `fingerprint` (for
cross-root duplicate detection; nothing stores it), `size`, `duplicate_of`, and `matches[]`. It does
not know what is already filed — the inbox is the queue, so anything filed is already gone from it.

**±1 HOUR IS THE SCOPE BOUNDARY, and it is hard.** A screenshot is only ever considered for a meeting
whose slot it falls within **±1 hour** of. Outside that, it is **out of scope**: report it, leave it
in the inbox, never file it. Do not widen the window to reach a shot, and do not reason your way to
"it's obviously from that call" — if it is outside the hour, it is not in play.

**Matching is TIERED, and the tier is the judgment signal:**

- **`exact`** — the shot falls inside the meeting's slot (or a real recording span when
  `recorded_at` exists). Trust it.
- **`slack`** — only reached when nothing matched exactly: the slot widened by ±1 hour, to rescue a
  shot from a call that started late or overran. A `slack` hit deserves a look.
- **`out_of_scope: true`** — no meeting within ±1 h. Reported and left alone. Plenty of screenshots
  have nothing to do with any call.

Slack never competes with an exact hit, so a generous window on a 12:00 meeting cannot reach into the
14:00 one and turn clean matches into ambiguities.

**More than one match in the same tier = ask.** Never pick.

### the bias is OMIT, and when unsure you ASK

Anything outside the window is out of scope, and a shot you are unsure about is a question for the
person, not a decision for you. Two reasons:

- **The cost is asymmetric.** A missed screenshot is recoverable — it sits in the inbox and can be
  filed later. A wrongly matched one files **one client's screen into another client's folder**, and
  fixing it means moving the file back out and telling both meetings apart from the log.
- **The overrun case is given up on purpose.** A call that runs far past its slot leaves shots more
  than an hour after it; those are out of scope, and the right move is to **ask**.

**Never widen the window as a workaround.** If a batch looks systematically out of scope, that is a
finding to report — a wrong meeting time, a missing calendar sync — not a matching problem to solve
by loosening `SLACK_MS`.

## the inbox log — working memory beside the payload

Open an inbox root's `meeting-screenshots/` and it explains itself: a **bare payload is NEW**; a
`<exact-filename>.log` beside it is **IN FLIGHT**; a **processed file is simply gone** — moved to
`${env:FILES_FOLDER}/meetings/<meeting-id>/screenshots/`, with nothing left behind but the meeting's
own `screenshots_folder` pointer.

- `archive` writes `seen` (sha256+size) at first touch, `refused` if the destination already holds a
  same-name file, and **deletes the log** the instant the shot is fully filed. `scan` moves a moot
  log — payload already gone — into `<root>/trash/` at the start of every run, and never reads a
  `*.log` as a payload.
- **The payload is authoritative for state; the log is narrative only.**
- **A connector without a content-update call appends the same way**: read the log →
  `create_file` with the same name and merged content → `trash_file` the old log by its id. Creating
  before trashing means the worst-case crash duplicates a log line rather than losing one.

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
   into `${env:FILES_FOLDER}/meetings/<meeting-id>/screenshots/`, where `<meeting-id>` is the full id
   (`2026/08/2026-08-30--…`) and its slashes become folders. On a cloud session there is no
   `detect.mjs`; do the equivalent through the Drive connector (`copy_file` into the destination +
   `trash_file` the inbox original).
4. **Point the meeting at the folder** — once per meeting, not per file, and write the FULL
   template. Single-quote it so the shell does not expand `${…}`; nothing substitutes until
   `dt resolve` is called:
   ```bash
   npx dt set meetings/<meeting-id> \
     'screenshots_folder=${env:FILES_FOLDER}/meetings/<meeting-id>/screenshots'
   # check it renders on this machine:
   npx dt resolve meetings/<meeting-id> screenshots_folder
   ```
5. **`npx dreamteamer check`**, then **report**: which meetings gained visuals and how many, the
   unmatched shots, and anything you asked about.

## common mistakes

| mistake | reality |
|---|---|
| looking for an `ingested/` staging folder | there is none — `archive` moves the shot straight to its destination |
| looking for a Drive folder id in `.env` or in `detect.mjs` | every inbox root is a line of `${env:INBOX_FOLDERS}`, and the destination is `${env:FILES_FOLDER}/meetings/<meeting-id>/screenshots` by name |
| pointing `screenshots_folder` at `meetings/<meeting-id>` without the `screenshots` leaf | `archive` files into the `screenshots/` leaf; a pointer without it renders an empty folder |
| computing a transcript offset without `recorded_at` | there is no automatic anchor; `captured_at` is absolute and that is what you have |
| forcing an unmatched shot into the nearest meeting | many screenshots are unrelated; report them |
| treating a `slack` hit like an `exact` one | slack exists to rescue, not to decide |
| widening `SLACK_MS` to make a shot match | ±1 h is the scope boundary, not a tuning knob. A systematically out-of-scope batch is a finding (wrong meeting time, missing sync), not a matching problem |
| filing an out-of-scope shot because it "obviously" belongs | outside the hour it is not in play. Ask, or leave it |
| resolving an ambiguous shot yourself to save a round trip | ask. Omitting is cheap; a wrong file puts one client's screen in another's folder |
| creating a record per screenshot | the folder is the container; the workspace holds one pointer |
| slugging or renaming the file on filing | the original filename IS the capture time — keep it |
| deleting a shot instead of moving it | agents never delete — removal is a move to the inbox root's own `trash/`, which a person empties by hand |
