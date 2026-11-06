---
name: rnd-implement
description: >-
  use when an approved rnd/implementation-plans record is being built — "implement the plan", "continue task N", superpowers:executing-plans, superpowers:subagent-driven-development. The implement stage of the R&D lifecycle: the plan record is the progress marker, tests are set from runs, deviations are written down.
---

# rnd-implement

## What you are doing

You build an approved plan task by task and leave the record as the progress marker: ticks in the body, `tasks_done`, each test's status from a run, every deviation written down. Any session can say where the build stands with one `dt get`.

## Before you start

```bash
dt get rnd/implementation-plans/<id>                                   # status approved or in-progress; execution says how
                                                                       # given a change request: its `implementation_plans` names the plan
dt get rnd/design-docs/<spec>                                          # the authority when the plan is wrong
dt list rnd/tests --where '{"covers":{"_contains":"rnd/implementation-plans/<id>"}}'   # and the change request's; --filter misses a many-valued covers
```

Work on a branch or a worktree, never on main. `dt set rnd/implementation-plans/<id> status=in-progress branch=<name>`. Resuming — after a compaction, a crash, a new session — start at the first unticked step; `tasks_done` and `git log` outrank your memory. If the spec's `last_modified` is later than the plan's approval, stop: the plan is stale and goes back to `/rnd:plan` — and its change request goes back with it: after the plan's own write, read `dt next rnd/change-requests/<id> --json` and write the stage of the earliest available binding (the binding → stage table in recording-reviews), `dt set rnd/change-requests/<id> stage=<that stage>`, committed with the plan by id. Before task 1, read every task's Interfaces against what the tasks before it produce and write any mismatch under `## Deviations` as a ruling.

## Do this

1. Take task N. Read its block from the record, not your memory of it.
2. Work the steps in order, red then green: write the test, run it and watch it fail, write the minimal code, run it and watch it pass, commit the paths the step names. A test you never saw fail proves nothing.
3. After every run, compare the output with the step's expected line. The code is wrong: find the cause, never patch the output. The plan is wrong: decide the smallest change the spec allows, write it under `## Deviations` in the body — the task, what, why, what it costs if wrong — and continue.
4. A visible test the plan names ran: `dt set rnd/tests/<id> status=passing|failing|flaky last_run=<now>`, from the output. A `held-out` test is not yours to read or run; the test stage does that. A defect you found and will not fix here: `dt add rnd/issues --name … --repo repos/<id>` with the evidence, then move on.
5. A task is done when every step is ticked `- [x]` in the body, its tests are green and committed, and the run is a line under `## Runs` in the body: date, command, exit code. `dt set rnd/implementation-plans/<id> tasks_done=<n>`. With `execution: subagent-driven`, a fresh implementer per task and a `qa-manager` review of the task before the next — the implementer never spawns its own reviewer, and its self-check never counts as the review. With `native`, you implement every task and one review of the whole branch comes at the end.
6. A story the plan delivers works on the running system: `dt set rnd/user-stories/<id> status=done`.
7. All tasks done: run the full suite, write its exit code under `## Runs`, and walk the flow the change exists for on the running thing — a green suite is not the feature. Then `dt set rnd/implementation-plans/<id> status=done`, and tag the plan's change request — `dt get rnd/change-requests/<id>` for its `tags`, then `dt set rnd/change-requests/<id> tags=<each existing> tags=implemented stage=code-review` — committed with the plan by id, the plan's `done` and the request's column in one commit — a `dt set` of `tags` replaces the list, so name every tag it already had, a person's free tags included (`<each existing>` is every tag it already has except `implemented`, so a re-run lists it once). The `stage=` on these lines is rule (a) in recording-reviews: Write `stage` only on a request that already carries a `stage` or whose `$repo` in `dt get rnd/change-requests/<id> --json` is `.` (the workspace's own root) — read from the workspace the step writes from; on any other request, one a record layer holds whose home has not filled it, leave `stage=…` out and write the rest. When a `dt set` carrying `stage` is refused for an unknown field `stage` (the request's home runs an rnd without it), run the same `dt set` again without `stage`. The next gate is the code review of the whole branch — `/rnd:review`, kind `code`, subject the plan, `change_ref` the range, `change_request` the request — given by someone else on the most capable model you have; its `approve` stamps `code_approved_on`. On `changes-requested`, fix blockers and majors in one pass, each with a test that failed first, answer each finding, and ask for round 2; a second round of changes is the person's call.
8. Commit the plan and every record you touched with the code, by id. Finish the branch the way the repo does — merge, pull request, keep — and ask: that choice is the person's.

## Don't

- Don't start a `draft` plan. It was not reviewed.
- Don't write production code before its failing test. Delete it and start from the test.
- Don't tick a step because the diff looks right. The tick follows the run.
- Don't set a test's status from reading the code. From the run, or not at all.
- Don't deviate in secret. A deviation without a line in the body is a decision nobody can find.
- Don't stop between tasks to ask "continue?". Stop for an irreversible action, a security-sensitive one, a push or a merge, or a plan so broken every path is a guess.

## Done when

Every task is ticked, `tasks_done` equals `tasks_total`, every named test has a status from a run, the suite's exit code is quoted and `status: done`. `dt next` on the plan (and on its change request) then answers `/rnd:review` — the code review — and after its `approve`, `/rnd:test`.
