# @dreamteamer/compact-tasks

An opt-in navigation preset, not a new task model or a cleanup job.

```sh
npm install @dreamteamer/core @dreamteamer/compact-tasks
npm install dreamteamer
npx dreamteamer compile
npx dreamteamer check
```

Engine >=0.43.0 and core >=0.9.0 are required. Board and List show unfinished work including
`suggested`, `todo`, `doing`, `blocked`. Both show creation date, due date, assignee and project;
the board removes project swimlanes. Done and closed records stay in the task collection history.
`done` means delivered; `closed` means not delivered. This preset never changes task statuses.

Core's Suggested, Assigned to me, By assignee and three Gantt routes remain available through
deep links, but are hidden from navigation. Board remains `/tasks/board`; List is `/tasks/list`.
Workspace-specific domain routes are not removed or rewritten. If those should be hidden, retain
their local overlays explicitly. Installing this package cannot prune unknown custom views.

Existing local full views or overlays may conflict with this preset. Compare on a disposable
copy, remove only replaced local display sources, compile/check, and verify that all data hashes
are unchanged. Uninstalling the preset and recompiling restores core's default navigation.
