---
name: extract-tasks-from-meetings
description: turn a meeting's transcript and summary into task records — my concrete commitments only
argument-hint: <meetings/id> [more meeting refs…]
---
load `working-with-tasks`. for each meeting ref in: $ARGUMENTS — read its summary (and the transcript
on its recordings where the summary is thin) and extract **my** concrete commitments into `tasks` records.

**first, read the meeting's `privacy`.** A meeting with `privacy: restricted` gets no tasks: say so in
one line — *"`meetings/<id>` has `privacy: restricted`: no tasks extracted"* — and go on to the next
ref. A meeting with no `privacy` value is `open`.

**write each task in the language the meeting was held in** — the transcript's
`transcription.language`.

**a name a machine wrote is unconfirmed.** on each recording, `transcription.speaker_sources` says who wrote
each name in `transcription.speakers`: a label whose entry has `status: provisional` was named from a voice
print and no person has confirmed it. write that speaker as `<Name> (unconfirmed)` wherever a statement is
attributed to them — in a task's body, and when deciding whose commitment it is — and say in
`creation_context` that the names were machine-written from voice prints. mark it only when the label's name
in `transcription.speakers` still equals its entry's `name` and that entry has `status: provisional`. a name
whose text differs from its entry's `name` — edited by hand — is unverified, and so is a name with no entry
(every name written before voice prints): a confirmed or unverified name is used as today, unmarked. With no
`speaker_sources` key at all, read the names as today.

**do not task-bomb.** a task is something I said I would do, concretely enough that I would recognise it
as owed. what somebody else took on belongs in the summary, not in my inbox — name them in the body of a
task only when I owe them the follow-up. if a meeting produced no commitment of mine, say so and write
nothing.

one task per item. `assignee` **only** when the owner maps to a workspace `users` record (empty means
the workspace's own person) — otherwise name them in the body rather than guessing a ref. `item` points at the meeting. `due` when a date was said —
**and when the task blocks a dated event, that event's date is the due date**, even if nobody said the
words "due by".

the quad: `author: agents/<harness>` (`agents/claude-code` under Claude Code), `source: meetings/<id>`,
`creation_context` naming your model and where in the call it came from, `confidence: low` for anything you inferred rather than heard.

skip aspirations ("we should think about…"), restatements of existing tasks, and anything already
tracked — check `tasks list` before writing. report what you extracted and, explicitly, what you
judged not to be a commitment.
