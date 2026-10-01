---
name: working-with-tasks
description: create, triage and complete tasks — the ownership rule, relative due dates, backlinks to the record a task came out of
---

# working with tasks

tasks are md records in `data/tasks/` (`<id>.task.md`). **core principle:** a task is a record
created through the CLI — never a hand-written file — and it is the operator's commitment by
default: **there is no `assignee` field and no `users` collection** (both removed in engine 0.8.0).
Everything in `data/tasks/` is implicitly the operator's; work owed by someone else is named in the
body, not in a field.

## when to use

the operator asks to create / triage / complete a task or an action item; you're extracting action
items from a conversation or a meeting transcript; you're surfacing the inbox.

**not for:** the generic record rules (`using-dreamteamer` → `references/records.md`) — this skill
only adds the task-specific conventions.

## the commands

the verbs and their flags are `npm run --silent dt -- help`; the record rules are
`using-dreamteamer` → `references/records.md`. task-specific:

- **`--name`, `--due`, `--status`** on `add` — `add` generates the id (`<creation-date>--<name-slug>`)
  and materializes defaults. ⚠ **The field is `name`, not `title`.** `title` is rejected as an
  unknown field, and a *view* asking for a `title` column gets it dropped silently rather than
  falling back — which once rendered the whole inbox nameless.
- ⚠ **`add` writes; it does NOT commit** — `auto-commit` has been off since 2026-08-03. Publish with
  a scoped `dt commit tasks/<id>` when the logical change is complete, never a bare `dt commit`.
- **`--description "…"`** is the body (`x-body`) — pass it inline, or add the prose with an
  editor afterwards.
- **`--item`** is the backlink (see below).
- the inbox is a filtered list: `tasks list --status todo`.

## fields that matter

- **ownership** — the whole collection is the operator's. When an action item belongs to someone
  outside the workspace (a client, a contact), name the owner in the body — "**Harel →** run the
  benchmark" — and prefer folding it into the operator's own follow-up task ("chase X for Y") rather
  than letting it stand alone (decision #12). A task nobody in this vault can act on is a note, not
  a task.
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
- **status** — `todo` | `doing` | `done`, materialized explicitly.
- **backlinks** — a task about a record sets `item: <collection>/<id>` (polymorphic: the meeting,
  contact or lead it came out of). There is no `run` field: it pointed at `workflow-runs`, which was
  deleted with the rest of the run subsystem on 2026-07-31.
- **urgent** — a boolean, separate from `due`. A thing can be urgent with no date and dated with no
  urgency; collapsing them into one field loses the distinction that makes triage possible.

## worked example

> "create a task for reviewing the Q3 roadmap, due next friday"

```bash
date +%F                                    # → 2026-07-25 (a Saturday ⇒ next friday = 2026-07-31)
npm run --silent dt -- add tasks \
  --name "Review the Q3 roadmap" --lane CRM --due 2026-07-31 --status todo
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

There used to be a "gate task" — a task a workflow run parked on, whose completion resumed the run.
That machinery is gone (2026-07-31), and what remains is the more useful half: **when a pipeline
reaches something only the operator can decide, write the decision as a task with the evidence in the
body.** A measurement in a chat window is lost; a measurement in the inbox is not.

So: **never delete a task because it turned out to be the wrong ask** — complete it with the reason in
the body. The record of having decided not to is worth more than a clean list.

## common mistakes

| mistake | reality |
|---|---|
| `--assignee` on `add`, or an `assignee:` field | removed with the `users` collection (engine 0.8.0). rejected as an unknown field. the collection is the operator's by definition. |
| hand-writing `data/tasks/<something>.task.md` | skips validation, defaults and the id pattern. use `tasks add`. |
| an id built from the **due** date | ids come from the creation date and never change; `due` is mutable. |
| `--title` instead of `--name` | rejected as an unknown field — and in a view's `columns` it is dropped in silence. |
| `due: next friday` or `due: 31/07/2026` | `format: date` means `YYYY-MM-DD`. compute the real date. |
| assuming `add` committed | it wrote to disk only — `auto-commit` is off. publish with a scoped `dt commit tasks/<id>`. |
| deleting a task that became moot | set `status=done` with the reason in the body — the decided-against record is the value. |
| omitting `status` | write it explicitly — files should read without the schema. |
| `--module` on a task | the field is `--lane`. Rejected as an unknown field. |
| `--lane finance` beside an existing `Finance` | two lanes on the board — the value is the label, so reuse the workspace's exact spelling. |
| reaching for a lane when unsure | a lane names a REAL domain, not a bin. Leave the field empty when the domain is genuinely unclear — the unassigned pile on the board surfaces the residue. |
