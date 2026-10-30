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
dt list rnd/tests --where '{"covers":{"_contains":"rnd/change-requests/<id>"}}'        # and the plan's: "rnd/implementation-plans/<id>"
dt get rnd/tests/<id>                                            # runner, steps, expected
```

`covers` holds several values, so an equality filter on it misses a test that also covers something else; `_contains` finds it.

## Do this

1. Each test with a `runner`, `held-out` ones included — they exist for this stage: run it exactly as written, read the output to the end, compare with `expected`. `dt set rnd/tests/<id> status=passing|failing|flaky last_run=<now>`. Keep the output; the review quotes it.
2. Each `manual` test: a person follows `steps`. Attended, ask them and record the answer. Unattended, leave it `planned`, name it in the review, and do not claim it ran.
3. Each `acceptance` line on the change request with no test proving it: `dt add rnd/tests` for it, `status: planned`, and say so. A promise with no test is the gap this stage exists to find.
4. A failing test: `dt add rnd/issues --name … --repo repos/<id>` with the output as evidence, and the test now also `covers` that issue, so the fix is a regression test by construction. The issue takes the quick path: `/rnd:plan rnd/issues/<id>`.
5. Open the review with `/rnd:review`, kind `test`, subject the change request or the plan. One finding per failing or missing proof. `approve` only when every covered test is `passing`, at least one of them `e2e` or `acceptance`, and every acceptance line has one. On `approve`, stamp ONE record: `dt set rnd/change-requests/<id> verified_on=<now>` when the plan has a change request, else `dt set rnd/implementation-plans/<id> verified_on=<now>` — never both. That one stamp is what `dt next` reads as done here, and the gate deploy reads.
6. Commit the tests, the issues and the review by id.

## Don't

- Don't set `passing` from a run you did not do in this session. Fresh output, or nothing.
- Don't run a subset and call it the suite. The runner is the whole command.
- Don't let a `manual` test pass because it probably would. Unrun is `planned`.
- Don't fix code here. A failure is an issue and a trip back to implement; this stage stays the judge.
- Don't approve with a `flaky` test. Flaky is a finding.

## Done when

Every covered test has a `status` from this session's runs and a `last_run`, every acceptance line has a test, the test review is `closed` with a verdict, and on `approve` `verified_on` is set on the one record — the change request when there is one, else the plan — and `dt next rnd/change-requests/<id>` answers `/rnd:deploy`.
