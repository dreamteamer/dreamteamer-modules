---
name: process-new-meetings
description: run the meeting pipeline end to end, from calendar sync to critique
argument-hint: "[week | YYYY-MM-DD | YYYY-MM-DD..YYYY-MM-DD] [--dry-run] [--no-analyze] [--stop-after <step>]"
---
run the meeting pipeline end to end for: $ARGUMENTS (default: today). This command **sequences existing
commands** — it adds no mechanics of its own, so every step keeps its own skill, gates and idempotency.

Each step is safe to re-run: recordings dedupe by sha256, screenshots leave the inbox once, `dt … set`
is idempotent, and a transcript is only written where one is missing. So a partial run is resumable by
just running this again.

## the sequence

1. **`/fetch-meetings <range>`** — the calendar is the spine; nothing downstream can match without it.
   **Always sync the range even if the workspace looks populated.** A meeting added or moved after an
   earlier sync is invisible until you re-fetch, and back-dated events are normal.
   When `/fetch-meetings` is not installed (it ships with `@dreamteamer/connectors-google-workspace`), skip the sync, say so in the report, and work from the meetings already in the workspace.
2. **`/fetch-new-recordings`** — audio inbox → recording records. Reports counts before writing.
3. **`/match-recording-to-meeting <recording refs>`** — for every recording with no `meeting`. Walks the
   ladder: in the workspace → sync that single date → shim. **Ask when two meetings fit.**
4. **`/transcribe-recording <recording refs>`** — for every recording with a `recording_file` and no
   `transcription`. The audio lives at the record's `recording_file`, rendered per machine by
   `dt resolve`.
   The speaker count comes from the meeting's `attendees_contacts`, so **check that list is real
   first**: an invite with no attendees produces a fabricated count, and a Zoom-grid screenshot (step 5) is better
   evidence. If screenshots for this meeting are already in hand, read one before choosing the count.
   A transcription writes no names; step 4b does.
4b. **`/identify-speakers <recording refs>`** — for every recording transcribed in this run, and every one
   still `speaker_naming: waiting` from an earlier run. **Run it yourself, as a step of this pipeline: the user
   types no command for it.** Run only its first step, `identify`, and report each label's line: named from a
   voice print (provisional), proposed, or why not. It asks nothing now — every recording's question waits for
   the one message at the end of the run (below). A meeting whose recording is left `waiting` has an open question.
   When the installed `@dreamteamer/recordings` has no `/identify-speakers`, skip this step, say so in the
   report, and go on with the names the transcripts already carry.
5. **`/fetch-meeting-screenshots <range>`** — visuals inbox → the meeting's `screenshots_folder`.
   **Look at each shot before uploading**: these are a client's screen and routinely carry third
   parties' personal data. Ask before uploading identity documents, signatures, account numbers.
**A meeting with `privacy: restricted` stops here.** It holds a third party's private material, so
steps 6-9 skip it: no summary, no tasks, no review, no engagement update. Name each one skipped in the
report. A meeting with no `privacy` value is `open`.

**Steps 6 and 7 run for every meeting with the names that exist** — a name step 4b wrote from a voice
print is provisional, and the summary and tasks mark it `(unconfirmed)`. **Steps 8 and 9 are held back** for
every meeting with a recording still `waiting` after step 4b: they run once, after the end-of-run answer
(below). A meeting with no open question runs steps 6 to 9 in one pass, as today.

6. **`/summarize-meeting <meeting refs>`** — transcript + visuals → a `meeting-summary`.
7. **`/extract-tasks-from-meetings <meeting refs>`** — only if the summary produced action items worth tracking.
8. **`/analyze-meetings <meeting refs>`** — the critique pass: validate and scrutinise what was said,
   into a `meeting-analyses` record. **Gated, not default** — run it only for meetings where
   you were selling, advising or negotiating — a call with a client or a prospect.
   Internal standups and status calls do not get reviewed; a review of a call with nothing at stake is
   noise, and this step reads raw transcripts, so it is the expensive one. One report per **arc**
   (both of a day's calls with the same client → one record), and it needs the transcript, so it
   cannot run where step 4 was skipped. `--no-analyze` skips it outright.
9. **`/update-engagements`** — fold the new summaries into each account's `engagements` record,
   **once at the end over every meeting processed**, not per meeting — an account should take one
   coherent update from the whole batch rather than a commit per call. When a question is open, step 9
   waits for the end of the run (below).
10. **`/update-contacts-from-meetings <meeting refs>`** — stamp every attendee's contact record with
    `recent_meeting` + `recent_meeting_date`. Pure mechanics (one script, forward-only, idempotent), run
    **once over the whole batch** after the attendee lists are final — a corrected attendee list from
    step 5's visuals is exactly what this step needs to have already landed. Never skipped: a contact
    you have just spoken to is the definition of recent, whatever the meeting was about.

**Why analysis comes BEFORE the engagement update:** a review routinely concludes that the obvious next
step is the wrong one, and `next_steps` is written in step 9. Run it after, and the lead's plan gets
written from the summaries alone and then quietly contradicted by a report filed underneath it. Run it
before, and step 9 can absorb the conclusions. `/analyze-meetings` flags such conflicts rather than
fixing them, so **read its report before running step 9.**

`--stop-after <step>` halts after that step (`sync`, `recordings`, `match`, `transcribe`, `identify`,
`screenshots`, `summarize`, `actions`, `analyze`). `--dry-run` runs only step 1's read plus the two `scan`s,
and writes nothing.

## at the end of the run

When step 4b left any recording `waiting`, the run ends with **one message** — never one per recording, never
in the middle of the run:

1. `identify --question` over every recording with an open question, all their refs in one call:
   ```bash
   node node_modules/@dreamteamer/recordings/bin/transcribe.mjs identify --question meeting-recordings/<id> [more refs…]
   ```
   Its `message` goes to the person as it is, in the same message as the pipeline's other end-of-run
   questions. Right after asking, `identify --shown` with the same refs.
2. **Attended run** — a person is in the conversation. Wait for the reply, then, in this order:
   1. `identify --answer`, one call per recording, with only the labels the person answered (the
      `identifying-speakers` skill has the answer strings). A label they skip stays open for the next attended
      run's question.
   2. for each meeting whose names changed, `/summarize-meeting` and `/extract-tasks-from-meetings` again —
      the summary is updated in place, and a task already tracked is not written twice.
   3. the held-back critiques, `/analyze-meetings` — still gated as step 8 is.
   4. then one `/update-engagements` over the batch, for every held-back meeting, **answered or skipped**: a
      skipped label stays open for the next attended run's question, but its meeting's engagement takes the
      call now, once, with the names that exist.

   That is the pipeline's own order — summary, tasks, critique, then one engagement update — so each
   engagement folds each call once, from the named summary, and absorbs the critique.
3. **Unattended run** — nobody is there to answer. Ask nothing, run no `--shown` and no `--answer`; the
   recordings stay `waiting`. Step 8 runs only for meetings with no open question. Step 9 runs as
   `/update-engagements engagements/<id>`, once for each engagement **none of whose meetings in this batch
   waits**; an engagement with a waiting meeting is held whole — none of its calls folded — and listed in the
   report. The next attended run picks those recordings up at step 4b, asks their questions, and folds each
   held engagement once.

**Only a person answers.** An agent never answers the question itself and never runs `identify --answer` or
`--confirm` without a person's reply in the conversation — not from the attendee list, not from the
transcript, not because a proposal looks right.

## how to run it

Work **one meeting at a time through steps 3-7** (4b included), then run steps 8 and 9 over the batch — 8 grouped per
client (one report per arc), 9 once for everything. Per meeting: a
single meeting reaching a summary is worth more than five half-processed ones, and the corrections found
along the way (a real attendee list, a better meeting name) feed the later steps for that same meeting.

Transcription is the long pole. Start it in the background and do steps 5-6's reading while it runs, but do not summarize before it lands.

**Let the visuals correct the record.** A Zoom grid names participants an empty invite cannot, and its
window title is often a better meeting name than the calendar's. When a screenshot contradicts a record,
the screenshot is usually right — fix the record and say so in the report. A corrected name or time
is a new id: `dt rename` moves the meeting and every reference to it, but not the files under
`screenshots_folder` or a summary whose id is the old meeting id — move the folder, set
`screenshots_folder` to the new path, and rename the summary to the new meeting id.

## report

Per meeting: what was synced/created, the recording and whether it transcribed, each label's line from
step 4b (or that step 4b was skipped, and why), how many visuals landed, whether a summary was written, and
**every correction the visuals forced**. Then **every document written before a name it now carries**: the
summary, tasks and critique that `identify --answer`'s reply names as written from the transcript before the
names — each one written again in this run, or listed as written before the name. Then every meeting whose
steps 8 and 9 were held back and why (its question open, or the run unattended), and every engagement held
whole. Then, for each meeting step 8
reviewed, its one-line verdict and any conflict it flagged with the engagement's existing records — and
which meetings were deliberately not reviewed, and which were skipped as `privacy: restricted`, so
each gate is visible rather than silent. Then which engagements step 9 moved, and what it could not
place. Then the leftovers — unmatched screenshots, recordings with
no meeting, meetings with no recording. End with the two inboxes' state, because an empty inbox is the
signal that nothing is pending.
