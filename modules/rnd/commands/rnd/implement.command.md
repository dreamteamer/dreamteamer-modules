---
name: rnd/implement
description: build the plan — task by task, red then green, the record as the progress marker
argument-hint: <rnd/implementation-plans/id | rnd/change-requests/id> [task N]
---
load the `rnd-implement` skill. for $ARGUMENTS (a change request means its approved plan): refuse a `draft` plan; set it `in-progress` on a branch; work each task's steps in order with the failing test first; tick steps, set `tasks_done`, set tests from runs, write deviations and issues; when every task is done, quote the suite's exit code, set `status: done`, and ask how the branch should finish. the code review of the branch is the next gate, and it is never yours.
