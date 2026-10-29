---
name: executing-implementation-plans
description: use when an rnd/implementation-plans record is being executed — superpowers:executing-plans, superpowers:subagent-driven-development, "implement the plan", "continue task N" — in a workspace with the rnd module. Says how to read the plan from its record, how progress is written back (checkboxes, tasks_done, status), how test runs update rnd/tests, where defects and deviations go, and what "done" requires.
---

# executing implementation plans

**core principle:** the plan RECORD is the progress marker. A step is ticked in the record's body when
it lands, so any session — or person — can say where the build stands with one `dt get`. Execute
exactly as `superpowers:executing-plans` or `superpowers:subagent-driven-development` says; this skill
only names where they read and write.

## start

```bash
dt get rnd/implementation-plans/<id>      # the plan: header fields, tasks in the body
dt get rnd/design-docs/<spec id>          # the spec it argues from — executors read both
```

Refuse to start a plan whose `status` is `draft`: it has not been reviewed. Set `status: in-progress`
and `branch` (the branch or worktree the work lands on). A subagent is handed the plan's id and its task
number, never a pasted copy — the record is the one copy.

## while it runs

| event | write |
|---|---|
| a step lands | tick its `- [ ]` → `- [x]` in the plan body |
| a task's steps are all ticked, its tests green and committed | `tasks_done` + 1 |
| a test the plan names runs | its `rnd/tests` record: `status` (`passing` · `failing` · `flaky`) and `last_run`, from the run's output, never from reading the code |
| a defect found on the way that is not this task's to fix | `rnd/issues`, with the evidence, before moving on |
| the plan turns out wrong — a signature, a file, an order | an edit to the plan body under a `## Deviations` heading naming the task and why; a choice with alternatives is a `decisions` record where installed |
| a story the plan delivers is demonstrably working | `rnd/user-stories` `status: done` |
| a task's review | `recording-reviews` — one review per task gate, subject the plan |

Commit the plan and the records it touched with the code they describe, by id.

## done

`status: done` only when every task is ticked, `tasks_done` equals `tasks_total`, and the full suite has
run with its exit code quoted (superpowers:verification-before-completion). A plan given up is
`abandoned` with the reason at the top of the body — never deleted. The branch then ends per
superpowers:finishing-a-development-branch; the final whole-branch review is a `recording-reviews` record.
