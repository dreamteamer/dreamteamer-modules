---
name: working-with-tasks
description: Use when creating, assigning, triaging or closing a task — capturing an action item from a conversation or a meeting, resolving "next friday" to a due date, deciding who owes it, or listing an inbox for one person or the whole workspace.
---

# working with tasks

Tasks are md records in `data/tasks/` (`<id>.task.md`). A task is created through the CLI, never as
a hand-written file, and it is owed by exactly one person in this workspace: its `assignee`, a
`users` record. An empty `assignee` means the workspace's own person, so a workspace with one person
never has to fill it in.

The generic record rules are `using-dreamteamer` → `references/records.md`; this skill adds only
what is specific to tasks.

## the commands

```bash
date +%F            # today; on a Saturday, "next friday" is six days later
npx dt add tasks --name "Review the Q3 roadmap" --due '2026-07-31'
# someone else's:  --assignee users/sam-diaz
# written by an agent:  --author agents/claude-code --creation_context "<model>; from <where>"
# ✔ data/tasks/2026-07-25--review-the-q3-roadmap.task.md   (written, not yet committed)
npx dt commit tasks/2026-07-25--review-the-q3-roadmap
```

- `add` generates the id from the creation date and `--slug`, or the name when no slug is given, and
  fills `status: suggested`; explicitly set `--status todo` for scheduled work. Pass `--slug` whenever the name is not in latin script, or the id is a hash
  nobody can read or type.
- `add` writes but does not commit. Publish with a scoped `npx dt commit tasks/<id>` once the change
  is complete, never a bare `npx dt commit`.
- `--description "…"` is the body: what was actually said and what "done" looks like.
- An inbox is a filtered list: `npx dt list tasks --filter status=todo`, plus
  `--filter assignee=users/<id>` for one person's.

## fields that matter

- **name** — the commitment in one line, starting with a verb. The field is `name`, not `title`.
- **assignee** — one `users` record, or empty for the workspace's own person. Never a contact and
  never a free-text name. Resolve "me" by listing `users` and matching the person, not by guessing
  an id.
- **work owed by someone outside the workspace** (a client, a contact) — name the owner in the body
  ("**Sam →** send the benchmark") and prefer one of your own follow-up tasks ("chase Sam for the
  benchmark"). A task nobody in this workspace can act on is a note, not a task.
- **lane** — optional, a short display-ready label for the domain of the work (`CRM`, `Finance`,
  `R&D`). The board bands its rows by the raw value, so reuse the workspace's exact spelling:
  `finance` and `Finance` are two lanes. Infer it from the task's actual work, not from where it was
  surfaced, and leave it empty when the domain is unclear — the board's unassigned pile surfaces
  the residue. Quote `'R&D'` on the command line.
- **tags** — the sub-domain inside a lane (`client:northwind`, `decision`). A lane is the axis above
  tags, not a replacement for them.
- **start** — optional scheduled start as an ISO 8601 datetime with timezone, for example
  `--start '2026-07-30T09:00:00+03:00'`. Capture an agreed start, never invent it from
  creation time or status. Together with `due`, this supplies the Gantt schedule.
- **due** — a `YYYY-MM-DD` date. Resolve relative phrases ("next friday", "eow") against today's
  date before writing.
- **status** — `suggested` (unaccepted candidate) · `todo` · `doing` · `blocked` · `done` · `closed`. `blocked` means the next move is
  someone else's; `closed` means it left the board without being met.
- **urgent** — separate from `due`. A thing can be urgent with no date and dated with no urgency.
- **item** — the record the task came out of: `--item meetings/<id>`, a contact, a lead.
- **project** — with the projects module installed, `--project projects/<id>`. Without it, leave it empty.

## a task is the record of a decision someone owes

When work reaches something only a person can decide, write the decision as a task with the
evidence in the body, assigned to whoever decides. A measurement in a chat window is lost; a
measurement in the inbox is not.

Never delete a task because it turned out to be the wrong ask: close it (`status: closed`) with the
reason in the body. The record of having decided not to is worth more than a clean list.

## common mistakes

| mistake | reality |
|---|---|
| `--assignee contacts/<id>` or a free-text name | the field references `users`; a contact is rejected. Name an outside owner in the body. |
| `--assignee` set to the workspace's own person on every task | empty already means them. Fill it only when the task is someone else's. |
| hand-writing `data/tasks/<something>.task.md` | skips validation, defaults and the id pattern. Use `npx dt add tasks`. |
| an id built from the due date | ids come from the creation date and never change; `due` does. |
| `due: next friday` or `due: 31/07/2026` | `format: date` means `YYYY-MM-DD`. Compute the real date. |
| assuming `add` committed | it wrote to disk only. Publish with a scoped `npx dt commit tasks/<id>`. |
| deleting a task that became moot | set `status=closed` with the reason in the body. |
| `--lane finance` beside an existing `Finance` | two lanes on the board. Reuse the exact spelling. |
| reaching for a lane when unsure | a lane names a real domain, not a bin. Leave it empty. |
