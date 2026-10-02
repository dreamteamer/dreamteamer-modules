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

Without the projects module, a task that names a project or an activity is refused by name rather than written.
