---
name: create-meeting
description: create a meeting and its meeting-prep record from recent summaries, briefs, company and contacts
argument-hint: <who / what> [date, time]
---
load `using-dreamteamer` and `preparing-for-meetings`. create a meeting from: $ARGUMENTS — and
**write its `meeting-preps` record**, which is the actual point of this command. Two records.

the meeting's frontmatter: `origin: manual`, the people as `contacts/` refs in `attendees_contacts` —
creating missing people as `status: draft` placeholders; `attendees` is the calendar API's list and
stays empty for a meeting with no invite — `company`, `starts`/`ends` as date-times with your timezone's offset,
and the quad (`author: agents/<harness>` — `agents/claude-code` under Claude Code — `source: users/<your-id>`,
`creation_context` naming the model). `privacy` stays `open` unless you are told the meeting will hold
a third party's private material.

then the prep, exactly as `preparing-for-meetings` defines it — what to read, the four sections
(status · recap · goals · suggestions), and the frontmatter. skip only its step 1: the meeting was
just created here, so there is nothing to resolve and no existing prep to update.
