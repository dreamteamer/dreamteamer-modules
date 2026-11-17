---
name: importing-voice-memos
description: use on a Mac before /process-new-meetings or /fetch-new-recordings, or when asked to "get my voice memos", "import the memo I just recorded", "transcribe my Voice Memos" — copies new Apple Voice Memos into the recordings inbox with `npx dt-voice-memos`, so the pipeline picks them up without anyone renaming or sharing a file.
---

# importing voice memos

## What you are doing

You copy the memos recorded since the last run out of Apple Voice Memos into the recordings inbox. The
pipeline then treats them like any file dropped there: `/fetch-new-recordings` imports, matches and
`/transcribe-recording` transcribes. You never read the Voice Memos store yourself — a small helper with
its own Full Disk Access grant does, and this session never needs one.

## Do this

1. From the workspace root: `npx dt-voice-memos --dry-run`. It lists what it would copy.
2. If it says the helper could not read the store, stop and give the person the path it prints and the
   one step: System Settings → Privacy & Security → Full Disk Access → **+**, ⌘⇧G, paste the path, switch
   it on. Never grant it to Terminal, the editor or yourself instead.
3. `npx dt-voice-memos`. Each memo lands in `<first INBOX_FOLDERS root>/meeting-recordings/` as
   `YYYY-MM-DD HHMM <title>.m4a` (a title that already starts with a date keeps it); a `.qta` memo is
   stream-copied to `.m4a`.
4. Continue with `/process-new-meetings` (or `/fetch-new-recordings`).

## Flags

- `--since YYYY-MM-DD` reaches further back. The first run copies only the last two days on purpose:
  older memos usually came in through the inbox already, and a phone share is never byte-identical, so
  the inbox cannot tell the two copies apart. Ask before reaching back past memos already imported.
- `--folder "<name>"` copies one Voice Memos folder only. Recently Deleted is never copied.

## Don't

- Don't grant Full Disk Access to anything but the helper path the tool prints.
- Don't rebuild the helper: a new build voids the grant (switch its entry off and on to restore it).
- Don't run it off a Mac; it says so and stops.
