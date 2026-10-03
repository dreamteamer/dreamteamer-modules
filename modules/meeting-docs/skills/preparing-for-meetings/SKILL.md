---
name: preparing-for-meetings
description: Use when a meeting is coming up and you need to walk in knowing where things stand — "prep me for the Harbor Mutual weekly", "what do I need for tomorrow's call", "brief me before I talk to X". Produces a meeting-preps record — status, recap, goals, suggestions. The mechanics behind /prepare-for-meeting, and the prep half of /create-meeting. Not for writing up a call that already happened (summarize-meeting) or judging one (analyzing-meetings).
---

# preparing for meetings

**core principle: a prep is read once, five minutes before the call, standing up.** It exists to
change what you do in the room. Anything that would not change a sentence you say or a decision you
make does not belong in it.

Writes `meeting-preps` records — the collection descriptor has the fields, `using-dreamteamer` has
the CRUD.

## 1. resolve the meeting first, and say which one

```bash
npx dt list meetings --where '{"starts":{"_gte":"<today>"}}' --sort starts
npx dt get meetings/<id>
npx dt list meeting-preps --filter meeting=meetings/<id>
```

A hint is a company, a person or a day — "the Northwind call", "tomorrow 11:00", "Sam weekly".
**Name the resolved meeting back in one line before writing anything.** A hint that matched the wrong
call produces a prep that is wrong in every section, and nothing downstream catches it.

- **Two plausible candidates** — ask. Do not silently take the sooner one.
- **Nothing matches** — say so. `/create-meeting` makes a meeting and its prep together; this
  prepares for one that already exists. Do not invent the meeting to have something to prep.
- **A prep already exists for it** — update that record, never add a second. Re-running because the
  call moved, or because a summary landed since, is the normal case.

## 2. read, in this order — and stop when it stops changing the prep

| # | source | what it gives |
|---|---|---|
| 1 | the **meeting record** — `note`, `description`, attendees, the invite's own wording | often the only statement of why this meeting exists at all |
| 2 | the account's **`engagements` record** — the one whose `company` is the meeting's company; set it as the prep's `engagement` | the standing picture: `stage`, `phase`, `next_steps`, `recent_activity`. **This is the status section, already written** — your job is to check it is current, not to re-derive it. No engagement for the company: say so in the report |
| 3 | the last 2–4 **`meeting-summaries`** for the company or the attendees, newest first | the recap. Where a meeting has no summary, read the meeting record |
| 4 | the **previous `meeting-preps`** for the same thread | what was planned last time, and whether it happened — see §5 |
| 5 | each **`contacts`** record for the attendees — role, relation, notes | a person you have not met is worth a line; one you speak to weekly is not |
| 6 | open **`tasks`** whose `item` points at any of those meetings | what you owe, and what you are owed |
| 7 | any document record the summaries reference | only when a summary points at one |

**"previous relevant meetings" is not "same company ref".** A thread can live inside another org's
call — a new lead is often first raised in a debrief on another client's recording. Search summaries for
the attendees' names and the project name too, not only the company ref.

**Summaries, not transcripts.** A prep is not a review; if the exact wording matters,
`/analyze-meetings` owns it. The one exception: a meeting with a recording and **no summary** — read
that transcript, and report the gap.

## 3. the four sections, and what each is for

The order is the order you read them in, and you may stop after two.

**status — where this stands today** (3–6 lines). State, not history: what phase the engagement is
in, what is in flight, what is blocked and **for how long**. Age every blocker — "open since
2026-07-21", not "still pending". A blocker that stopped moving *is* the news.

**recap — what happened last time** (a short table, newest first). One row per prior session that
still matters: date, what was decided, what was left open, who owes it — each linked to its summary.
Three rows is usually plenty; a standing weekly needs one. **Every open thread carries the meeting it
came from**, cited inline, so any claim can be walked back to its record.

**goals — what this meeting is for** (at most 3, each falsifiable, ranked). *"Get a decision on
merging the content repo before the 9 Aug workshop"* is a goal. *"Align on next steps"* is not — it
cannot be failed, so it cannot be prepared for. Mark the one that makes the meeting worth having. A
goal passed in the arguments is #1, unedited.

**suggestions — what to actually do.** The part that earns the record. Each one carries the evidence
behind it. The shapes that keep paying:

- **the question to ask, worded** — especially the uncomfortable one deferred twice already.
- **what to say when X comes up** — an objection that got a non-answer last time.
- **what to cut if time runs short**, decided now rather than in the room.
- **a decision to make before walking in**, where the answer is yours and not the counterparty's.
- **something to fix quietly rather than raise** — not everything true belongs on an agenda.

Mark the single highest-leverage item.

## 4. the frontmatter that goes wrong

| field | rule |
|---|---|
| `meeting` | the meeting **being prepared for**. The earlier calls the material came from go in `sources`; pointing at them instead means the prep is never found for the meeting it serves |
| `date` | copied from the meeting's `starts` — not today |
| `company`, `attendees` | denormalized off the meeting, so the prep stands alone in a list |
| `goal` | one line, the top goal from §3. It is what the list view shows |
| `engagement` | the `engagements/<id>` read in §2 row 2, when there is one |
| `sources` | record refs (`meeting-summaries/…`, `engagements/…`) for everything actually read — never file paths, never "the summaries" |
| `status` | `draft`. `ready` is the reader's word once they have read it, not the agent's |
| `language` | the language the prep is written in, when it is not English |
| the quad | `author: agents/<harness>` (`agents/claude-code` under Claude Code), `source`, `creation_context` naming the model, `confidence` |

Pass `--id` explicitly — generated ids from long names are unusable:
`<meeting's YYYY-MM-DD>--<company>-<short-slug>`.

## 5. close the loop on the last prep

Before writing, open the previous prep for this thread and check its goals against the summary of the
call it prepared: **what was achieved, what was not, and what was never raised.** A goal now deferred
three weeks running is the most useful line in the new prep, and no other record surfaces it.

Where the last prep's suggestions were not taken and the reason is visible, say it in one clause.
Where it is not visible, say *that* — do not guess a motive.

## 6. discipline

| rationalization | reality |
|---|---|
| "more context is safer" | It gets five minutes. A prep you do not finish is worse than a short one — cut to what changes your behaviour |
| "no history, but I'll fill it out anyway" | Write "first contact, nothing prior" and go straight to goals. Padding buries the two lines that matter |
| "align / sync / touch base" as a goal | Not falsifiable, so not a goal. Name the decision or the answer you must leave with |
| "the summary says it, so it's true" | Where a summary flags low confidence or garbled ASR, carry the caveat forward. Do not launder it into a fact |
| "the engagement record is stale, I'll fix it" | Out of scope — `/update-engagements` owns it. **Flag** the drift in the report |
| "I'll list the tasks you should do" | A prep is not a task list. Work that comes out of the call is `/extract-tasks-from-meetings`, after it |
| "I read the transcripts to be thorough" | An hour spent to tell you what you already know from having been there. Summaries |

**Red flags in your own draft:** a goal that cannot be failed; a recap row with no meeting ref; a
suggestion with no evidence behind it; a status section that is history rather than state; anything
you could not act on before the call starts.

## 7. report

The meeting you resolved, the prep's id, the top goal, and the highest-leverage suggestion — then,
explicitly, **what you could not find**: a company with no engagement, a recording with
no summary, an attendee with no contact record, a blocker whose owner is unknown. Those gaps are the
part you act on. Flag anything the new reading **contradicts** in the engagement; do not fix it
here.
