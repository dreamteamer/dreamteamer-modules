---
name: prepare-for-meeting
description: prepare for an upcoming meeting — gather the client context and prior calls into its meeting-prep
argument-hint: <meetings/id | hint — a company, a person or a day> [goal]
---
load `preparing-for-meetings`. resolve the meeting from: $ARGUMENTS, then write — or update — its
`meeting-preps` record.

**Name the resolved meeting back before writing anything**: *"preparing for `<id>` — `<date> <time>`,
with `<attendees>`"*. A hint that matched the wrong call is wrong in every section and nothing
downstream catches it. Two plausible candidates: ask. None: say so — `/create-meeting` makes a
meeting and its prep together, this one prepares for a meeting that already exists. Already prepped:
update that record, do not add a second.

Read the standing picture first — the `engagements` record for the meeting's company, which the prep
points at as its `engagement` — then the last few `meeting-summaries` and the previous prep for the
same thread, then the attendees' `contacts` and the open `tasks`. Summaries, not transcripts; the exception is a meeting whose recording never got
summarized, which is a gap to read *and* to report.

Body, in this order: **status** (where it stands today, every blocker aged), **recap** (a short table
of the prior sessions that still matter, each linked to its summary), **goals** (at most 3, each
falsifiable, ranked), **suggestions** (each with the evidence behind it, the highest-leverage one
marked). Cite record ids inline so every claim is traceable. Say plainly when there is no prior
history rather than padding.

If a goal was passed after the meeting ref, it is goal #1, unedited.

Frontmatter as `preparing-for-meetings` §4 lists it: `meeting`, `date` copied from the meeting's
`starts`, `engagement`, `company`, `attendees`, `goal`, `sources`, `status: draft`, and the quad
(`author: agents/<harness>` — `agents/claude-code` under Claude Code — with the model in
`creation_context`).

Then report: the top goal, the highest-leverage suggestion, and **what you could not find** — a
company with no engagement, a recording with no summary, an attendee with no contact.
Flag anything the new reading **contradicts** in the engagement; do not fix it here.
