# @dreamteamer/tasks

Concrete commitments: what has to be done, by whom, and by when. Each task names its owner as one
`users` record, and an empty owner means the workspace's own person. Ships an inbox, a board, a
by-person view, and the skill an agent follows to create, assign and close tasks.

```bash
npm install @dreamteamer/tasks @dreamteamer/users
npx dreamteamer compile
```

| alone | with others |
|---|---|
| tasks, the inbox (`/inbox`), the board (`/tasks/board`), tasks by person (`/tasks/by-assignee`) | **projects** lets a task name the project or activity it serves · **meeting-docs** extracts tasks from a call and lists them on its critique |

Without the projects module, a task that names a project keeps the reference as written; it resolves once projects is installed.

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
