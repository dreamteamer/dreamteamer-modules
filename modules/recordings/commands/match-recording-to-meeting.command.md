---
name: match-recording-to-meeting
description: link a recording to the meeting it records — finding, syncing, or shimming that meeting
argument-hint: <meeting-recordings/id> [more recording refs…]
---
load `using-dreamteamer` (record rules: `references/records.md`). for each recording ref in:
$ARGUMENTS — resolve the meeting
it records, walking this ladder and **stopping at the first hit**:

1. **already in the workspace.** match on the recording's `date` plus the company/attendee hints in its
   `name`, cross-checked against `duration` vs the meeting's `ends - starts` (a ±5 min fit is strong
   evidence; a 20 min gap is not a match). if two meetings fit, **show both and ask** — never guess.
2. **not in the workspace.** load `fetching-meetings` and sync that single date first: the event may exist
   on a calendar nobody has snapshotted yet. then retry step 1.
3. **still nothing.** create a **shim** meeting: `origin: recording`, `confidence: low`,
   `source: meeting-recordings/<id>`, `creation_context` saying no calendar event was found and that
   date/participants are estimated from the recording filename, `starts` from the recording's `date`
   (with the filename's time when it has one, else 00:00), `company` from the hint when it is
   unambiguous. attendees resolve against `contacts` — create missing people as `status: draft`
   placeholders with the quad filled, and never scrape here.

then set **both** ref directions in one commit — `meeting.recordings` gains the recording,
`recording.meeting` gains the meeting. `check`'s `x-inverse` rule fails a one-sided link, so a
half-written match will not pass.

report, per recording: which rung of the ladder resolved it, the meeting id, and the evidence you used.
