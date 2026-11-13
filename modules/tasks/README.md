# @dreamteamer/tasks

Concrete commitments: what has to be done, by whom, and by when. Each task names its owner as one
`users` record, and an empty owner means the workspace's own person. Ships a focused Board and List, plus the skill an agent follows to create, assign and update tasks.

```bash
npm install @dreamteamer/tasks @dreamteamer/users
npx dreamteamer compile
```

| alone | with others |
|---|---|
| tasks, Board (`/tasks/board`) and List (`/tasks/list`) for unfinished work | **projects** lets a task name the project or activity it serves · **meeting-docs** extracts tasks from a call and lists them on its critique |

Without the projects module, a task that names a project keeps the reference as written; it resolves once projects is installed.

## Upgrading to 0.3.2: focused task navigation

Only Board and List appear in task subview navigation. They include `suggested`, `todo`, `doing`
and `blocked`, with creation dates, due dates and assignees. The board has status columns without
project swimlanes. Completed (`done`) and abandoned (`closed`) records remain in Tasks history;
this change does not delete records or alter statuses. `suggested` is a candidate, not an accepted
commitment. The collection's full list remains available for reviewing historical work.

The old inbox, Suggested, Assigned to me, By assignee and Gantt routes still resolve; they no longer
add navigation entries. Local workspace overlays can intentionally re-enable their nav or change
filters. Existing overlays take precedence, so inspect them when adopting the new defaults.
No data migration is needed. The separate experimental compact-tasks preset is not needed.

## Upgrading to 0.3.0: lanes become tags

0.3.0 drops the `lane` field. A task's domain is a tag like any other (`crm`, `finance`), and the
board bands by `project` instead. Records written under 0.2.x still carry `lane:`; one script moves
each value into `tags`:

```bash
npx dt-migrate-lanes-to-tags              # the plan (--dry-run is the default), nothing written
npx dt-migrate-lanes-to-tags --write      # apply it
# … [--root <workspace>] [--json]
```

Each `lane: X` becomes the tag `x`, kebab-cased (`R&D` → `r-d`) and added only when the task does
not already carry it; the `lane` key is removed. A task with no lane is untouched, so a second run
changes nothing (`records 0 · refs 0` — ids never change, so no reference is rewritten). A value
that kebab-cases to nothing is reported and its task left as it was. The script edits records only:
an overlay of `tasks` or a view in the workspace's own `modules/` that still names `lane` is listed
for you to remove, then `dt compile` and `dt check`.

## Task schedules

`start` is an optional datetime; `due` remains a date. Existing records need no migration.
Capture a known scheduled start with `--start '2026-07-30T09:00:00+03:00'` and a deadline
with `--due '2026-07-31'`. Leave unknown starts empty.

| Gantt view | Statuses |
|---|---|
| Planned (`/tasks/planned/gantt`) | todo |
| Active (`/tasks/active/gantt`) | doing, blocked |
| Retro (`/tasks/retro/gantt`) | done, closed |

All three use `start` to `due`, group by assignee and color by status. They display scheduled
windows, including for historical tasks; they do not claim actual time worked or actual
completion times. Populate both endpoints for meaningful bars.

New tasks default to `suggested`; scheduling explicitly sets `todo`. Existing-task retriage may preserve `previous_status`. Optional R&D links connect tasks to products, stories, journeys and change requests. `depends_on` and `estimate_days` describe a plan; dates are not a commitment unless its schedule basis says so.


### Current-user task view

The bundled `/tasks/mine` view contains the experimental `@me` assignee placeholder. It requires an editor that explicitly resolves it; marketplace extension 0.23.3 does not. A workspace using the marketplace should disable this bundled view and generate a private ordinary UI view with a concrete user reference from its local environment. Missing or invalid identity should match no tasks. Identity selection is a presentation preference, not authentication.

The `depends_on` task references expose a reverse `dependents` relation.

## 0.3.3

Engine floor `>=0.47.0` and the peer list mirrored for `dt install`'s closure; nothing else changes. `dt update @dreamteamer/tasks` then `dt compile`.
