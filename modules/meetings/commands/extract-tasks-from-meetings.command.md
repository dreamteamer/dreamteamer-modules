---
name: extract-tasks-from-meetings
description: turn a meeting's transcript and summary into task records — my concrete commitments only
argument-hint: <meetings/id> [more meeting refs…]
---
load `working-with-tasks`. for each meeting ref in: $ARGUMENTS — read its summary (and the transcript
on its recordings where the summary is thin) and extract **my** concrete commitments into `tasks` records.

**do not task-bomb.** a task is something I said I would do, concretely enough that I would recognise it
as owed. what somebody else took on belongs in the summary, not in my inbox — name them in the body of a
task only when I owe them the follow-up. if a meeting produced no commitment of mine, say so and write
nothing.

one task per item. `assignee` **only** when the owner maps to a workspace user — otherwise name them
in the body rather than guessing a ref. `item` points at the meeting. `due` when a date was said —
**and when the task blocks a dated event, that event's date is the due date**, even if nobody said the
words "due by".

the quad: `author: agents/dreamteamer (<your model>)`, `source: meetings/<id>`, `creation_context`
naming where in the call it came from, `confidence: low` for anything you inferred rather than heard.

skip aspirations ("we should think about…"), restatements of existing tasks, and anything already
tracked — check `tasks list` before writing. report what you extracted and, explicitly, what you
judged not to be a commitment.
