---
name: rnd-test
description: >-
  use when a change has to be proved rather than claimed — "run the acceptance", "is this covered", "did the tests pass", before a deploy. The test stage of the R&D lifecycle: every rnd/tests record covering the change request or the plan runs, its status is set from the run, and a review of kind test says whether the proof is enough.
---

# rnd-test

## What you are doing

You prove a change against the records that promised the proof. Every `rnd/tests` record that covers the change request or the plan runs; its status is set from the run; a review of kind `test` says whether the proof is enough. Nothing is marked from reading code.

## Before you start

```bash
dt get rnd/change-requests/<id>                                  # acceptance: what the person said evidence looks like
dt list rnd/tests --filter covers=rnd/change-requests/<id>       # and --filter covers=rnd/implementation-plans/<id>
dt get rnd/tests/<id>                                            # runner, steps, expected
```

## Do this

1. Each test with a `runner`: run it exactly as written, read the output to the end, compare with `expected`. `dt set rnd/tests/<id> status=passing|failing|flaky last_run=<now>`. Keep the output; the review quotes it.
2. Each `manual` test: a person follows `steps`. Attended, ask them and record the answer. Unattended, leave it `planned`, name it in the review, and do not claim it ran.
3. Each `acceptance` line on the change request with no test proving it: `dt add rnd/tests` for it, `status: planned`, and say so. A promise with no test is the gap this stage exists to find.
4. A failing test: `dt add rnd/issues --name … --repo repos/<id>` with the output as evidence, linked from the test's body. It goes back to `/rnd-implement`.
5. Open the review with `/rnd-review`, kind `test`, subject the change request or the plan. One finding per failing or missing proof. `approve` only when every covered test is `passing` and every acceptance line has one.
6. Commit the tests, the issues and the review by id.

## Don't

- Don't set `passing` from a run you did not do in this session. Fresh output, or nothing.
- Don't run a subset and call it the suite. The runner is the whole command.
- Don't let a `manual` test pass because it probably would. Unrun is `planned`.
- Don't fix code here. A failure is an issue and a trip back to implement; this stage stays the judge.
- Don't approve with a `flaky` test. Flaky is a finding.

## Done when

Every covered test has a `status` from this session's runs and a `last_run`, every acceptance line has a test, the test review is `closed` with a verdict, and on `approve` `dt next rnd/change-requests/<id>` answers `/rnd-deploy`.
