---
name: summarize-meeting
description: write a meeting-summary record from the transcript and any visuals captured during the call
argument-hint: <meetings/id> [more meeting refs…] [focus]
---
load `using-dreamteamer` (record rules: `references/records.md`). for each meeting ref in:
$ARGUMENTS — write one `meeting-summaries` record.

**first, read the meeting's `privacy`.** When it is `restricted`, write nothing for that meeting and
answer in one line — *"`meetings/<id>` has `privacy: restricted`: no summary is written"* — then go
on to the next ref. A restricted meeting holds a third party's private material, so its pipeline
ends at the transcript. A meeting with no `privacy` value is `open`.

**the summary's id is the meeting's id.** Pass `--id <the meeting's id>` — the part after
`meetings/` — so the summary is filed beside the meeting it summarises, under the month the call was
held, not on the day it was written. The id the descriptor generates comes from `created`, which is
the writing date, so it is only a fallback. One summary per meeting (`meeting` is unique): a
re-summary updates the existing record with `dt set`, never adds a second.

```bash
npx dt add meeting-summaries --id <meeting id> --name "<the meeting's name>" \
  --meeting meetings/<meeting id> --date <the meeting's starts> \
  --author agents/<harness> --source meeting-recordings/<id> [--source meeting-recordings/<id> …]
```

**read two sources, in this order:**

1. **the transcript**, from the meeting's **recordings** (`recordings` → each recording's body; several
   recordings are several parts of one call, read in `date` order). On each recording, read these
   two fields before the body:
   - `transcription.speakers` — the map from transcript labels (`speaker_0`) to people. A label the
     map does not name has no person behind it: never attribute a quote through an unmapped label,
     or through labels the map or the notes say are conflated.
   - `transcription.notes` — the transcriber's own caveats, written inside the block it produces:
     a speaker count it corrected, labels it could not map, attribution it does not trust.
   - `notes` — the recording's top-level field, a person's note about the capture itself: bad
     audio, a missing first minute, who was off-mic. Both are caveats; they come from different hands.
2. **the visuals**, when the meeting has `screenshots_folder` — a
   `${env:FILES_FOLDER}/meetings/<the meeting's id>/screenshots` template. Let the engine render it,
   then LOOK at each image:
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

**write the summary in the language the meeting was held in** — the transcript's
`transcription.language` — so a quote reads as it was said.

frontmatter:

| field | value |
|---|---|
| `name` | the meeting's own title |
| `date` | the meeting's `starts` — the call's instant, never today |
| `who` | the participants as spoken or written, free text |
| `meeting` | `meetings/<id>` |
| `author` | `agents/<harness>`, the name of the harness running this command: `agents/claude-code` under Claude Code, `agents/codex` under Codex. Not `agents/dreamteamer`, which names the engine's routing agent rather than the harness that wrote the record. Your model goes in `creation_context` |
| `source` | every recording whose transcript you read, one `meeting-recordings/<id>` element each (`--source` repeated), never the meeting. A recording you could not read is not a source |
| `creation_context` | the model, how many screenshots informed the summary, and the reason whenever `confidence` is `low` |
| `confidence` | how legible the sources were — rough ASR is the usual reason for `low` |

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
