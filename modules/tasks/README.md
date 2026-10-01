# @dreamteamer/tasks

Concrete commitments: what has to be done, by whom, and by when. Each task names its owner as one
`users` record, and an empty owner means the workspace's own person. Ships an inbox, a board, a
by-person view, and the skill an agent follows to create, assign and close tasks.

```bash
npm install @dreamteamer/tasks @dreamteamer/users @dreamteamer/tags
npx dreamteamer compile
```

| alone | with others |
|---|---|
| tasks, the inbox (`/inbox`), the board (`/tasks/board`), tasks by person (`/tasks/by-assignee`) | **meetings** links a call's critique to the tasks it produced · **projects** (not yet in this repo) lets a task hang off a project or a plan rung |

Without the projects module, a task that names a project is refused by name rather than written.
