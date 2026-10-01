---
name: fetch-new-recordings
description: scan every INBOX_FOLDERS root's meeting-recordings/ for recordings not yet in the vault and import each one as a meeting-recording
argument-hint: "[--dry-run]"
---
load the `ingesting-recordings` skill and bring the inbox into the vault.

`scan` first and **report the counts before writing anything** — total / already-in-vault /
cross-root duplicates / new. if `$ARGUMENTS` contains `--dry-run`, stop there.

**check `orphan_candidates` before creating anything.** A recording with a transcript but no binary
cannot be hash-matched — attach the file to that existing record rather than minting a duplicate. A
`strong` candidate names the filename outright; a `plausible` one is same-date + duration-within-15s
and wants a second look.

then, for each genuinely new file: fix the name (Hebrew gets `<original> (English gloss)`),
sanity-check any `confident: false` date, ask before importing anything under ~2 minutes, `import` the
binary, and create the `meeting-recordings` record — one commit each, and **no `meeting` ref**, which
is what leaves `/match-recording-to-meeting` showing as available.

if the scan reports `fingerprints_backfillable > 0`, backfill those first: a recording with a file and
no fingerprint gets re-hashed on every scan and can never survive a rename.

`import` finishes the job itself — the original moves straight to `${env:FILES_FOLDER}/meeting-recordings/<year>/<month>/`
once the copy verifies, so there is no staging step after it. close by confirming the inbox
is empty, or naming what is still sitting there and why.
