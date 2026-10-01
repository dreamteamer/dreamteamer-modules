---
name: summarize-meeting
description: write a meeting-summary record from the transcript and any visuals captured during the call
argument-hint: <meetings/id> [more meeting refs…] [focus]
---
load `using-dreamteamer` (record rules: `references/records.md`). for each meeting ref in:
$ARGUMENTS — write a `meeting-summary` record mirroring the meeting's `YYYY/MM` path and
basename.

**read two sources, in this order:**

1. **the transcript**, from the meeting's **recordings** (`recordings` → each recording's body; several
   recordings means several parts of one call, in date order). Read each recording's
   `transcription.notes` FIRST — it says what is and is not trustworthy, and a recording whose speakers
   are unmapped or whose labels are conflated must not have quotes attributed to a person.
2. **the visuals**, when the meeting has `screenshots_folder` — a
   `${env:FILES_FOLDER}/meetings/<basename>` template. Let the engine render it, then LOOK at
   each image:
   ```bash
   DIR=$(npx dt resolve meetings/<id> screenshots_folder)
   ls "$DIR"
   # then read each image by its path: "$DIR/<filename>"
   ```
   Where that resolves to a local folder (a synced drive), **no Drive API call is needed** — read the
   files straight off disk. Where it resolves to a `gdrive://…` address, walk it with the Drive
   connector.
   Each filename carries the **absolute capture time** (`Screenshot YYYY-MM-DD at HH.MM.SS.png`), so
   a visual can be placed in the conversation: *"at 14:26 they walked through the compliance folder"*.
   Do **not** convert that to a transcript offset (`+16:22`) unless the recording carries a
   trustworthy `recorded_at` — it usually does not, because a recording file's timestamp is when the
   copy was written. Absolute clock time is what you have; quote it as such.

frontmatter: name, date, who, the meeting ref, and the quad — `author: agents/<harness>` (e.g.
`agents/claude-code`, your model in `creation_context`), `source: meeting-recordings/<id>` (the recording you actually read, not the meeting; add
`+ <n> screenshots` when visuals informed it), `confidence` reflecting how legible the sources were,
with the reason in `creation_context` when it is `low`. rough ASR is the usual reason.

body: context, key points, decisions — ending with an **Action items** section. weave the visuals in
where they carry the content (a diagram, a screen, a document on display) rather than listing them at
the end; name the file when a reader would want to open it. if a focus was passed after the refs,
weight the summary toward it.

**never transcribe third-party personal data out of a visual.** A screenshot of a client's screen
can show identity documents, signatures, account numbers or addresses belonging to someone who is not
in the meeting. Reference such an image by what it IS — "a signed LP subscription page (investor PII,
not transcribed)" — and move on. The summary is a workspace record that gets read and quoted later.

**say what you could not read.** a screenshot you failed to materialize, a transcript with unusable
speaker attribution, a meeting with no recording at all — each belongs in `creation_context`, not
silently omitted.
