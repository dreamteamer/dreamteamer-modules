---
name: update-engagements
description: bring engagement records level with the meeting summaries written since each was last updated — recent activity, next steps, stage, champion
argument-hint: "[engagements/<id> | companies/<id> | YYYY-MM-DD..YYYY-MM-DD] (default: every engagement, each from its own `updated`)"
---
Bring `engagements` records level with what has happened since each one's `updated` date. Scope:
$ARGUMENTS (default: every engagement that is not `closed`).

An engagement is the one standing record of a relationship; meeting summaries are the event stream.
This command folds the stream into the record. Read summaries, not transcripts: a meeting with a
recording and no summary is a gap to report, not to fill here.

## 1. what is new

```bash
npx dt list engagements --json
npx dt list meeting-summaries --json
```

Join a summary to an engagement through the summary's meeting and that meeting's `company`. When
the join is not clean, read before you write:

- a meeting with no `company` — match on its attendees' companies, then ask;
- a company with several engagements, or work delivered through a `vendor` — read each record's
  `description` and body before choosing;
- a company with summaries and no engagement — do not create one silently. Report it and ask: one
  introductory call may be a new `lead`, or nothing.

## 2. the fields, each with its own job

| field | what goes in | how to edit |
|---|---|---|
| `activity_summary` | the whole arc, oldest first, one bullet per event that mattered | append; rewrite an old bullet only when new evidence contradicts it |
| `recent_activity` | the last few weeks in detail, newest first, each line citing its summary | put new sessions on top; let the tail age into `activity_summary` |
| `next_steps` | what is owed, by whom, by when | drop what got done, add what was committed, keep what is open and say how long it has been open |
| `stage` | `lead`, `client` or `closed` | change only on evidence: work agreed makes a lead a client; an ending closes it, with `outcome` |
| `phase` | where it stands today, in one line | keep it current and specific |
| `champion` | the one person on the other side who wants it | set it when one emerges; change it when they leave or go quiet — that is news |
| `updated` | today | always |

Write decisions, blockers and commitments: what changed and who owes what. Leave conversational
detail in the summary, which the record cites.

## 3. report

One line per engagement touched: its stage, what changed, and anything that needs a person —
a company with no engagement, a summary you could not place, a champion who went quiet.
