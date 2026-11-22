# Work 0.2

```sh
npm install @dreamteamer/work @dreamteamer/projects @dreamteamer/tasks @dreamteamer/sessions @dreamteamer/users
```

Work provides Goals and a Strategies collection for operational, conversational and unblocking methods. This full release requires canonical Projects, Tasks, Sessions and Users packages. Projects retains Decisions ownership; Tasks and Sessions retain their collection ownership. Runtime 0.53 can compile views of missing peer collections but validation rejects those views. This release therefore requires those owners rather than promising a schema-only standalone installation. A local preview with its own Tasks or Sessions base must migrate ownership first or keep using the preview.

Sessions can reference Goals and Tasks. Decisions can reference Goals, Sessions, Strategies, and Tasks. Author Decision → Tasks once; Task → Decisions is computed. Session work status is separate from whether the run ended. Links confer no authority. Brain stays separate. This package carries no records, hooks or capture behavior.

Legacy Activities, Action Patterns, and Conversation Patterns are readable for upgrades but not added to default navigation.

## Saved views and renderer compatibility

Tasks includes Active, All Tasks, To Do, Doing, Blocked, Done, Closed and Graph. Suggested and legacy List/Board views still come from Tasks. Goals includes Graph, Gantt, Unscheduled, By Parent, Active and Archived. Sessions includes Recaps and Sessions Graph; Decisions includes Decision Log; Strategies includes one Catalog and three optional category views. No view overrides the default collection route or installs workspace-specific filters. Goal Gantt uses optional planned dates and does not manufacture dates. Diagram labels report status, but this package neither includes nor upgrades a renderer; enhanced layout, wrapping, status-colored goal nodes and hover behavior depend on the installed Electron/Web version. No laboratory or development renderer is shipped with Work.
