# @dreamteamer/connectors-macos

Apple Voice Memos into the `recordings` inbox, on a Mac. `npx dt-voice-memos` copies each memo recorded
since its last run into the first `INBOX_FOLDERS` root's `meeting-recordings/` folder, so
`/process-new-meetings` imports, matches and transcribes it — nobody renames or shares a memo by hand.

## Install

```
dt install @dreamteamer/connectors-macos
```

or, without the engine's installer:

```
npm install @dreamteamer/connectors-macos @dreamteamer/recordings @dreamteamer/meetings @dreamteamer/contacts @dreamteamer/assets @dreamteamer/companies @dreamteamer/users
```

## Setup, once per Mac

1. Install it (above) and `dt compile`. Needs `@dreamteamer/recordings` with
   `INBOX_FOLDERS` set, and Xcode's command-line tools (`xcode-select --install`) for the first run.
2. `npx dt-voice-memos --dry-run`. The first run builds the helper into
   `~/Library/Application Support/dreamteamer/voice-memos-helper/` and, until it is granted, prints its path.
3. System Settings → Privacy & Security → Full Disk Access → **+**, press ⌘⇧G, paste that path, switch it on.
4. `npx dt-voice-memos`, then `/process-new-meetings`. The `importing-voice-memos` skill does this for a session.

## How it reads the store

The Voice Memos store is readable only with Full Disk Access. The grant goes to one small helper
(`bin/voice-memos-helper.swift`, about forty lines, no network, no child process) that the tool starts as
a one-shot launchd job, so macOS checks the helper itself — not Terminal, the editor or an agent session.
The helper copies the store's database and recent audio into a staging folder; everything else runs
without the grant, against that copy. Nothing ever writes to the store.

## Behaviour

- Copies memos started since the last copied day; the first run, the last two days (`--since` reaches back).
- Skips Recently Deleted; `--folder "<name>"` takes one Voice Memos folder.
- Names a file `YYYY-MM-DD HHMM <title>.m4a`; a title already starting with a date is kept as it is.
- A `.qta` memo becomes an `.m4a` holding its stereo track (ffmpeg stream copy, no re-encode).
- Remembers what it copied in `~/.local/state/dreamteamer/voice-memos-copied.tsv`, so a second run copies nothing again.
- A memo still in iCloud and not on this Mac is reported and copied on a later run.

Environment: `VOICE_MEMOS_INBOX`, `VOICE_MEMOS_STORE`, `VOICE_MEMOS_STATE`, `VOICE_MEMOS_HELPER_DIR`, `DT_WORKSPACE`.

## Not yet

Running inside `/process-new-meetings` by itself, matching on the memo's recorded start instant,
recognising a memo imported earlier through the inbox, and a `dt doctor` check of the grant.
