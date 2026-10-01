---
name: working-with-tasks
description: create, assign, triage and complete tasks — who owes it, relative due dates resolved to absolute ones, backlinks to the record a task came out of
---

# working with tasks

tasks are md records in `data/tasks/` (`<id>.task.md`). **core principle:** a task is a record
created through the CLI — never a hand-written file — and it is owed by exactly one person in this
workspace: its `assignee`, a `users` record. **An empty `assignee` means the workspace's own
person**, which is the honest default for a personal list: a workspace with one person never has to
fill it in, and a workspace with several fills it on every task that is not the default person's.

## when to use

someone asks to create / assign / triage / complete a task or an action item; you're extracting
action items from a conversation or a meeting transcript; you're surfacing an inbox — a person's, or
the whole workspace's.

**not for:** the generic record rules (`using-dreamteamer` → `references/records.md`) — this skill
only adds the task-specific conventions.

## the commands

the verbs and their flags are `npm run --silent dt -- help`; the record rules are
`using-dreamteamer` → `references/records.md`. task-specific:

- **`--name`, `--assignee`, `--due`, `--status`** on `add` — `add` generates the id
  (`<creation-date>--<slug>` when `--slug` is given, `<creation-date>--<name-slug>` otherwise) and
  materializes defaults. ⚠ Pass **`--slug`** whenever the name is not in latin script: a name with no
  latin characters still gets an id, but a hashed one nobody can read or type. ⚠ **The field is `name`, not `title`.** `title` is rejected as an
  unknown field, and a *view* asking for a `title` column gets it dropped silently rather than
  falling back — which once rendered the whole inbox nameless.
- ⚠ **`add` writes; it does NOT commit** — `auto-commit` has been off since 2026-08-03. Publish with
  a scoped `dt commit tasks/<id>` when the logical change is complete, never a bare `dt commit`.
- **`--description "…"`** is the body (`x-body`) — pass it inline, or add the prose with an
  editor afterwards.
- **`--item`** is the backlink (see below).
- an inbox is a filtered list: `npm run --silent dt -- list tasks --filter status=todo`, plus
  `--filter assignee=users/<id>` for one person's.

## fields that matter

- **assignee — one `users` record, or empty.** Never a contact and never a free-text name: a task
  is owed by someone who does work in this workspace. Resolve "me" by listing `users` and matching
  the person, not by guessing an id. Leave it empty for the workspace's own person.
- **work owed by someone OUTSIDE the workspace** (a client, a contact) — name the owner in the body —
  "**Sam →** send the benchmark" — and prefer folding it into one of our own follow-up tasks ("chase
  Sam for the benchmark") rather than letting it stand alone. A task nobody in this workspace can act
  on is a note, not a task.
- **lane** — OPTIONAL, a short display-ready label naming the DOMAIN of the task (`CRM`, `Finance`,
  `R&D`…). It is what splits the board into lanes so the domain of a task is one glance away. The
  VOCABULARY IS THE WORKSPACE'S OWN — this module ships no enum, because every workspace splits its
  work differently; pick a small set and reuse it exactly, since the board groups rows by the raw
  value and `finance` and `Finance` are two lanes. A task with no lane still lands, in an
  "unassigned" pile — omit the field when the domain is genuinely unclear rather than reaching for
  a bin. Read the task's own words: a task extracted from a client meeting whose actual WORK is a
  finance obligation belongs to the finance lane, not the CRM one, even if `item` points at a
  meeting. **Infer it when clear**; **leave it EMPTY when unclear** — the unassigned pile is what
  surfaces the residue for a later pass. To close the set, add an `enum` to the field
  (`dt set-field tasks --name lane …`).
- **due** — a `YYYY-MM-DD` date string. resolve relative phrases ("next friday", "eow") against
  today's actual date before writing; quote it if you're hand-editing YAML.
- **status** — `todo` | `doing` | `blocked` | `done` | `closed`, materialized explicitly. `blocked`
  means the next move is someone else's; `closed` means it left the board WITHOUT being met.
- **backlinks** — a task about a record sets `item: <collection>/<id>` (polymorphic: the meeting,
  contact or lead it came out of).
- **project / activity** — when the projects module is installed, a task can hang off a plan:
  `--project projects/<id>` or `--activity activities/<id>`. Without it, leave both empty.
- **urgent** — a boolean, separate from `due`. A thing can be urgent with no date and dated with no
  urgency; collapsing them into one field loses the distinction that makes triage possible.

## worked example

> "create a task for reviewing the Q3 roadmap, due next friday"

```bash
date +%F                                    # → 2026-07-25 (a Saturday ⇒ next friday = 2026-07-31)
npm run --silent dt -- add tasks \
  --name "Review the Q3 roadmap" --lane CRM --due 2026-07-31 --status todo
# for someone else in the workspace: add --assignee users/sam-diaz
# ✔ data/tasks/2026-07-25--review-the-q3-roadmap.task.md   (written, NOT yet committed)
npm run --silent dt -- commit tasks/2026-07-25--review-the-q3-roadmap
```

**`--lane` is optional.** Pass it when the domain is clear, using the workspace's own lane words: a
task extracted from a finance meeting takes `--lane Finance`; from a change to the tooling,
`--lane 'R&D'` (quote the `&`); a straight CRM follow-up is `--lane CRM`. When the domain is
genuinely unclear, omit it — the
unassigned pile on the board surfaces the residue. The tag column continues to say which SUB-DOMAIN
inside the lane (`tax` / `vat` / `insurance` within a finance lane, for example) — a lane is not a
replacement for tags, it is the axis above them.

## a task is the record of a DECISION someone owes

**When a pipeline reaches something only a person can decide, write the decision as a task with the
evidence in the body**, assigned to whoever decides. A measurement in a chat window is lost; a
measurement in the inbox is not.

So: **never delete a task because it turned out to be the wrong ask** — complete it with the reason in
the body. The record of having decided not to is worth more than a clean list.

## common mistakes

| mistake | reality |
|---|---|
| `--assignee contacts/<id>` or a free-text name | the field references `users`; a contact is rejected. name an outside owner in the body. |
| `--assignee` set to the workspace's own person on every task | empty already means them — fill it only when the task is someone else's. |
| hand-writing `data/tasks/<something>.task.md` | skips validation, defaults and the id pattern. use `tasks add`. |
| an id built from the **due** date | ids come from the creation date and never change; `due` is mutable. |
| `--title` instead of `--name` | rejected as an unknown field — and in a view's `columns` it is dropped in silence. |
| `due: next friday` or `due: 31/07/2026` | `format: date` means `YYYY-MM-DD`. compute the real date. |
| assuming `add` committed | it wrote to disk only — `auto-commit` is off. publish with a scoped `dt commit tasks/<id>`. |
| deleting a task that became moot | set `status=closed` with the reason in the body — the decided-against record is the value. |
| omitting `status` | write it explicitly — files should read without the schema. |
| `--module` on a task | the field is `--lane`. Rejected as an unknown field. |
| `--lane finance` beside an existing `Finance` | two lanes on the board — the value is the label, so reuse the workspace's exact spelling. |
| reaching for a lane when unsure | a lane names a REAL domain, not a bin. Leave the field empty when the domain is genuinely unclear — the unassigned pile on the board surfaces the residue. |
