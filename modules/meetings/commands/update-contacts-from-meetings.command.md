---
name: update-contacts-from-meetings
description: stamp each attendee's contact record with its latest past meeting — recent_meeting + recent_meeting_date
argument-hint: "<meetings/id> [more meeting refs…] | --all (backfill from every meeting)"
---
Bring `contacts.recent_meeting` and `contacts.recent_meeting_date` level with the meetings that have
actually happened. Scope: $ARGUMENTS — one or more `meetings/<id>` refs (the normal case, right after a
meeting is processed) or `--all` to backfill every contact from every meeting in the vault.

**This step is pure mechanics — run the script, do not do it by hand.** The rule is small and tested:
a contact's recent meeting is the latest by `starts` that lists them in `attendees`, has already
started, and is not cancelled; a record only ever moves forward, so re-running over any subset is safe.

```bash
node <extensions>/modules/meetings/skills/fetching-meetings/bin/touch-contacts.mjs <meetings/id …> [--dry-run]
node <extensions>/modules/meetings/skills/fetching-meetings/bin/touch-contacts.mjs --all [--dry-run]
```

It reads through `dt list --json` and writes through `dt set`, so every write is schema-validated and
each changed contact is one pathspec-scoped record. It prints each contact it moved and what it
replaced. Nothing is committed — publish with `dt commit contacts/<id> …` naming the records it listed
(or `dt commit contacts` after a `--all` backfill when nothing else is pending under contacts).

## what it deliberately does not do

- **Fix the attendee list.** A meeting whose `attendees` is wrong (an invite with none, a self-logged
  call) stamps nobody or the wrong people. Correct the meeting first — `fetching-meetings` owns that —
  and re-run; the forward-only rule makes the re-run free.
- **Count a future meeting.** The calendar sync writes next week's meetings too; "recent" means
  "has happened".
- **Touch a contact with no past meeting.** Both fields stay empty — that is the honest state, and it
  is what a "who have I not met" filter keys on.
- **Enrich anything.** It moves two fields. `/scrape-contact` is the enrichment queue.

## in the pipeline

`/process-new-meetings` runs this as its last step over every meeting in the batch. It is also
the right thing to run after `/fetch-meetings` corrects a past meeting's attendees, and after any
hand-logged meeting is added.
