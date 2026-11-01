---
name: rnd-plan
description: >-
  use when an accepted change request or an active design doc has to become a build plan — "plan the build of X", superpowers:writing-plans, "how do we implement this". The plan stage of the R&D lifecycle: an rnd/implementation-plans record an engineer who never saw the codebase can build from, and one rnd/tests record per proof it promises; never a file under docs/.
---

# rnd-plan

## What you are doing

You turn an accepted change request or an active design doc into one `rnd/implementation-plans` record an engineer who has never seen the codebase can build from, and one `rnd/tests` record per proof the plan promises. You leave the plan `draft`, queued for review.

## Before you start

```bash
dt get rnd/change-requests/<id>                          # the change, its acceptance lines, the designs it names
dt get rnd/design-docs/<id>                              # the spec: the plan argues from it, so executors read both
dt list rnd/tests --filter product=rnd/products/<id>     # tests that already prove nearby things
```

Read the repo the work lands in. Map the files that will be created or changed before you write a task. A spec that covers several independent subsystems is several plans, one each. A confirmed `rnd/issues` record takes the quick path: `--issue rnd/issues/<id>`, no design doc, usually one task.

## Do this

1. Open the record with the header as fields:
   ```bash
   dt add rnd/implementation-plans --name "<feature>" --spec rnd/design-docs/<id> --change_request rnd/change-requests/<id> \
     --product rnd/products/<id> --repo repos/<id> --goal "<one sentence>" --architecture "<two or three sentences>" \
     --tech_stack "<a>" --tech_stack "<b>" --global_constraints "<one line, values verbatim from the spec>" \
     --review_focus "<an input class the reviewer should probe beyond the plan's own tests, and what a person would expect>"
   ```
   `review_focus` is the reviewer's list, not a promise of tests: one line per input class the plan's tests leave to the review.
2. The body starts at `### Task 1` — the header lives in the fields, once. Then the `### Task N` blocks. Each task has **Files** (exact paths), **Interfaces** (consumes and produces, exact signatures) and `- [ ]` steps. A task is the smallest unit with its own test cycle. A step is one action with a checkable result: write the failing test · run it, expected FAIL · implement the signature · run it, expected PASS · commit these paths.
3. One `rnd/tests` record per promise someone will ask "is this covered" about — a story, an acceptance line, a defect:
   ```bash
   dt add rnd/tests --key <k> --name "<what it proves>" --product rnd/products/<id> --covers rnd/change-requests/<id> \
     --kind unit|integration|e2e|manual|acceptance --repo repos/<id> --runner "<the exact command>" --expected "<what passing looks like>" --status planned
   ```
   Name the test's id in the step that writes it, so the implementer can update it. The held-out tests are not yours to write: a `## Held-out` section in the body names the input classes the held-out set must cover, and the review of the plan writes the `--visibility held-out` records — the builder never reads them, the test stage runs them, so the build cannot be shaped to the test.
4. `tasks_total` is the number of task blocks; `tasks_done` starts at 0. Propose `execution` (`native` for a few coupled tasks, `subagent-driven` for many independent ones) with the reason in the body; the person who approves keeps or changes it.
5. Read it as the builder: every spec requirement points at a task; every step lets them write exactly one reasonable thing; a name used in task 7 matches task 3; the plan is shorter than the code it describes. Fix inline.
6. On a change request, move its stage: `dt set rnd/change-requests/<id> stage=plan-review`, committed with the plan by id — the plan is the record that moved it, so the two go in one commit. The `stage=` on these lines is rule (a) in recording-reviews: Write `stage` only on a request that already carries a `stage` or whose `$repo` in `dt get rnd/change-requests/<id> --json` is `.` (the workspace's own root) — read from the workspace the step writes from; on any other request, one a record layer holds whose home has not filled it, leave `stage=…` out and write the rest. When a `dt set` carrying `stage` is refused for an unknown field `stage` (the request's home runs an rnd without it), run the same `dt set` again without `stage`. Commit the plan and its tests by id. The next word is `/rnd:review rnd/implementation-plans/<id>` — on a change request, `dt next` on the request names the same review, and the review sets `change_request`. The review's `approve` sets `approved`.

## Don't

- Don't write a plan without a spec. A plan with nothing to argue from is a to-do list.
- Don't paste code the signature and the test already determine. A body appears only for an algorithm they do not pin.
- Don't write "handle edge cases", "add validation", "write tests for the above". A line that decides nothing is a gap.
- Don't write a test record for every helper, and don't skip the one a person will ask about. The record is for the question "is this covered".
- Don't write a `held-out` test. The reviewer writes those from your `## Held-out` section; a builder who wrote the acceptance test has read it.
- Don't set `status: approved` yourself. The review does; `execution` you propose, the person confirms.

## Done when

`rnd/implementation-plans/<id>` exists with the header fields, `tasks_total` set and `status: draft`, its visible tests `planned` and pointing at it, a `## Held-out` section naming what the reviewer's tests must cover, and `dt next rnd/implementation-plans/<id>` answers `/rnd:review`.
