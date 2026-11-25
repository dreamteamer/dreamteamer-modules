# Work 0.3

```sh
npm install @dreamteamer/work @dreamteamer/projects @dreamteamer/tasks @dreamteamer/sessions @dreamteamer/users
```

Work provides Goals and a Strategies collection for operational, conversational and unblocking methods. This full release requires canonical Projects, Tasks, Sessions and Users packages. Projects retains Decisions ownership; Tasks and Sessions retain their collection ownership. Runtime 0.53 can compile views of missing peer collections but validation rejects those views. This release therefore requires those owners rather than promising a schema-only standalone installation. A local preview with its own Tasks or Sessions base must migrate ownership first or keep using the preview.

Sessions can reference Goals and Tasks. Decisions can reference Goals, Sessions, Strategies, and Tasks. Author Decision → Tasks once; Task → Decisions is computed. Session work status is separate from whether the run ended. Links confer no authority. Brain stays separate. This package carries no records, hooks or capture behavior.

Legacy Activities, Action Patterns, and Conversation Patterns are readable for upgrades but not added to default navigation.

## What 0.3 adds: a ready everyday setup

0.3 ships, as the package's defaults, the Work setup a team runs every day: the sub-views of each Work collection, the fields those views name, and a goals interview.

- **Goals** — Gantt, 3D (the desktop app's `tree3d` layout, each goal's sessions drawn beside it), Graph and By project. A goal lists its tasks and its decisions back, generated, and can name the project it serves.
- **Tasks** — All Tasks, Suggested, Queued, To Do, Doing, Blocked, Done, Closed, By goal, By parent, By project, List, Board, Active and Graph. A task carries a `task_code` (`TASK-` and three or more digits), a one-line `latest_update`, the `goals` it serves and an optional `parent_task`. An ask is a `queued` task with the asker's words in `raw_input`, `asked_by` and `ask_sessions`.
- **Sessions** — By status (a board), By goal, Needs a person, Blocked, Active, Planned, Verified done, No status, By project, Recaps and Sessions Graph. A session says whether it needs a person (`needs_operator`), who takes the next step (`next_step_owner`: person, agent or external) and what that step is.
- **Decisions** — Open decisions, Parked decisions, Decision Log and By project. An open question is a decision with `status: open`, a `question` and its `options`; it may name no decider and no date until it is decided, and a decision with no status still needs its decision, who made it and when.
- **Strategies** — Catalog and the three category views, listed newest first and grouped by category.
- **`/work:goals-interview`** — the `goals-interview` skill: run once in a new workspace, it reads the sessions and meetings already there, asks about each client and the outcome wanted for it, proposes one goal tree by client and the companies and contacts it implies (when the CRM modules are installed), and writes only what is confirmed. It is one self-contained prompt, short enough for a small model.

## The nav

A package cannot reorder a workspace's own `nav.yaml`. Work's fragment places Work's rows in the everyday order — Work: goals, tasks, sessions, decisions, then a Brain folder with strategies — only where the workspace has not placed them yet. With the core preset installed, core's fragment is merged first and places tasks, decisions and sessions in its own folders; to draw the everyday order there, move the rows in the editor, or put this in `nav.yaml`, removing each row from wherever else the file places it (a collection is placed once; leave out a row whose module is not installed):

```yaml
tree:
  - folder: Work
    items:
      - goals
      - tasks
      - sessions
      - decisions
      - folder: Brain
        items:
          - agents
          - skills
          - commands
          - routines
          - risks
          - strategies
          - projects
          - teams
          - users
      - folder: CRM
        items:
          - meetings
          - engagements
          - companies
          - contacts
hidden:
  - activities
  - action-patterns
  - conversation-patterns
```

## Saved views and renderer compatibility

No view overrides the default collection route or installs workspace-specific filters. Goal Gantt uses optional planned dates and does not manufacture dates. Diagram labels report status, but this package neither includes nor upgrades a renderer; the 3D tree, enhanced layout, wrapping, status-colored goal nodes and hover behavior depend on the installed desktop app version, and a client without a layout draws the view's default list. No laboratory or development renderer is shipped with Work.
