---
name: process-new-meetings
description: run the whole meeting pipeline, ten steps in order — sync, ingest recordings, match, transcribe, ingest screenshots, summarize, extract tasks, analyze (gated), update engagement, update contacts; analysis runs BEFORE the engagement update so a critique is read before next_steps absorb it
argument-hint: "[week | YYYY-MM-DD | YYYY-MM-DD..YYYY-MM-DD] [--dry-run] [--stop-after <step>]"
---
run the meeting pipeline end to end for: $ARGUMENTS (default: today). This command **sequences existing
commands** — it adds no mechanics of its own, so every step keeps its own skill, gates and idempotency.

Each step is safe to re-run: recordings dedupe by sha256, screenshots leave the inbox once, `dt … set`
is idempotent, and a transcript is only written where one is missing. So a partial run is resumable by
just running this again.

## the sequence

1. **`/fetch-meetings <range>`** — the calendar is the spine; nothing downstream can match without it.
   ⚠ **Always sync the range even if the vault looks populated.** A meeting added or moved after an
   earlier sync is invisible until you re-fetch, and back-dated events are normal — this has bitten
   twice (a 07-29 meeting created the following morning, a 5pm follow-up absent from a same-day sync).
2. **`/fetch-new-recordings`** — audio inbox → recording records. Reports counts before writing.
3. **`/match-recording-to-meeting <recording refs>`** — for every recording with no `meeting`. Walks the
   ladder: in the vault → sync that single date → shim. **Ask when two meetings fit.**
4. **`/transcribe-recording <recording refs>`** — for every recording with a `recording_file` and no
   `transcription`. (The old `file` field died with `media/` on 2026-08-23; the binary lives only at
   the record's `recording_file`, rendered per machine by `dt resolve`.)
   ⚠ The speaker count comes from the meeting's attendees, so **check that list is real first**: an
   invite with no attendees produces a fabricated count, and a Zoom-grid screenshot (step 5) is better
   evidence. If screenshots for this meeting are already in hand, read one before choosing the count.
5. **`/fetch-meeting-screenshots <range>`** — visuals inbox → the meeting's Drive folder.
   ⚠ **Look at each shot before uploading**: these are a client's screen and routinely carry third
   parties' personal data. Ask before uploading identity documents, signatures, account numbers.
6. **`/summarize-meeting <meeting refs>`** — transcript + visuals → a `meeting-summary`.
7. **`/extract-tasks-from-meetings <meeting refs>`** — only if the summary produced action items worth tracking.
8. **`/analyze-meetings <meeting refs>`** — the critique pass: validate and scrutinise what was said,
   into a `meeting-analyses` record. **Gated, not default** — run it only for meetings where
   the operator was selling, advising or negotiating — a call with a client or a prospect.
   Internal standups and status calls do not get reviewed; a review of a call with nothing at stake is
   noise, and this step reads raw transcripts, so it is the expensive one. One report per **arc**
   (both of a day's calls with the same client → one record), and it needs the transcript, so it
   cannot run where step 4 was skipped. `--no-analyze` skips it outright.
9. **Fold the new summaries into the account's standing record** — ONLY where the workspace keeps
   one. A `clients`/`leads` funnel is not part of this module; a workspace that has one runs its own
   command here (in the dogfood vault, `/update-engagement-and-activity`), **once at the end over every
   meeting processed**, not per meeting — an account should take one coherent update from the whole
   batch rather than a commit per call. Skip when there is no such record.
10. **`/update-contacts-from-meetings <meeting refs>`** — stamp every attendee's contact record with
    `recent_meeting` + `recent_meeting_date`. Pure mechanics (one script, forward-only, idempotent), run
    **once over the whole batch** after the attendee lists are final — a corrected attendee list from
    step 5's visuals is exactly what this step needs to have already landed. Never skipped: a contact
    the operator has just spoken to is the definition of recent, whatever the meeting was about.

**Why analysis comes BEFORE the engagement update:** a review routinely concludes that the obvious next
step is the wrong one, and `next_steps` is written in step 9. Run it after, and the lead's plan gets
written from the summaries alone and then quietly contradicted by a report filed underneath it. Run it
before, and step 9 can absorb the conclusions. `/analyze-meetings` flags such conflicts rather than
fixing them, so **read its report before running step 9.**

`--stop-after <step>` halts after that step (`sync`, `recordings`, `match`, `transcribe`, `screenshots`,
`summarize`, `actions`, `analyze`). `--dry-run` runs only step 1's read plus the two `scan`s, and writes
nothing.

## how to run it

Work **one meeting at a time through steps 3-7**, then run steps 8 and 9 over the batch — 8 grouped per
client (one report per arc), 9 once for everything. Per meeting: a
single meeting reaching a summary is worth more than five half-processed ones, and the corrections found
along the way (a real attendee list, a better meeting name) feed the later steps for that same meeting.

Transcription is the long pole — measured 2026-08-30 at roughly **⅓× real time on this Mac** (44 min of
audio in ~15 min; the old "1× real time" claim was never re-measured after the int8 CTranslate2 build). Start
it in the background and do steps 5-6's reading while it runs, but do not summarize before it lands.

**Let the visuals correct the record.** A Zoom grid names participants an empty invite cannot, and its
window title is often a better meeting name than the calendar's. When a screenshot contradicts a record,
the screenshot is usually right — fix the record (`rename` moves the id, so the Drive folder and the
`ingested/` archive follow) and say so in the report.

## report

Per meeting: what was synced/created, the recording and whether it transcribed, how many visuals landed,
whether a summary was written, and **every correction the visuals forced**. Then, for each meeting step 8
reviewed, its one-line verdict and any conflict it flagged with the engagement's existing records — and
which meetings were deliberately not reviewed, so the gate is visible rather than silent. Then which
standing records step 9 moved, and what it could not place. Then the leftovers — unmatched screenshots, recordings with
no meeting, meetings with no recording. End with the two inboxes' state, because an empty inbox is the
signal that nothing is pending.
