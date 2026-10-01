---
name: fetch-meeting-screenshots
description: scan every INBOX_FOLDERS root's meeting-screenshots/ for shots taken during meetings and file each one against its meeting
argument-hint: "[--from YYYY-MM-DD] [--to YYYY-MM-DD] [--dry-run]"
---
load the `ingesting-meeting-screenshots` skill and bring the screenshot inbox into the vault for:
$ARGUMENTS (default: everything not already known).

`scan` first and **report the counts before writing anything** — total, then matched / ambiguous /
unmatched. if `$ARGUMENTS` contains `--dry-run`, stop there.

**the match tier is the judgment signal, not a formality.** an `exact` hit (inside the meeting's slot)
can be trusted. a `slack` hit only happens when nothing matched exactly — it means the call started
late or overran, so look at it. **more than one match in the same tier: show them and ask.** and
**never force an unmatched shot into the nearest meeting** — plenty of these screenshots have nothing
to do with a call, and a wrong one poisons that meeting's summary.

sanity-check any shot whose `captured_at_source` is `mtime` rather than `filename`; mtime is
re-stamped by a copy, so its time may be wrong.

⚠ **look at each shot before filing it.** these are screenshots of a client's screen and routinely
contain third parties' personal data — the first real run captured a signed fund LP signature page with
an investor's passport number, address and capital commitment. **ask before filing anything showing
identity documents, signatures, account numbers or addresses.** removal is a MOVE to that inbox
root's own `trash/`, never a delete — agents never delete.

then, per confirmed shot: **`archive` the file** — `node $DET archive "<local path>" "<meeting-id>"`
moves it straight into `${env:FILES_FOLDER}/meetings/<meeting-basename>/`, keeping the original
filename since that is what carries the capture time. There is no upload step and no staging copy —
the inbox and the destination sit in the same synced tree. Finally set `meetings.screenshots_folder`
**once per meeting** to the FULL template — `'screenshots_folder=${env:FILES_FOLDER}/meetings/<meeting-basename>'`,
single-quoted so the shell leaves `${…}` alone; there are no per-file records.

do **not** compute a transcript offset. that needs `meeting-recordings.recorded_at`, which has no
automatic source. the absolute time in the filename is what the summary should quote.

close with: which meetings gained visuals and how many each, the unmatched list, and confirmation
that the inbox is empty (or what is still sitting there and why).
