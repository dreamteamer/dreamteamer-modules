---
name: recording-reviews
description: >-
  use when anything built is reviewed — a design doc, a change request, an implementation plan, a prototype, a test run, a code change or a pull request; superpowers:requesting-code-review, superpowers:receiving-code-review, a per-task reviewer gate. The review stage of the R&D lifecycle: every review is an rnd/reviews record, every problem an rnd/review-findings record, and an approve verdict is what moves the subject to the next stage.
---

# recording-reviews

## What you are doing

You judge one record — a design doc, a change request, a plan, a prototype, a test run, a code change — and leave an `rnd/reviews` record with one `rnd/review-findings` record per problem. When you approve, you move the subject's status forward. That status is the gate the next stage reads.

## Before you start

```bash
dt get <subject>                                   # the record under review, whole
dt get rnd/design-docs/<spec>                      # for a plan or a change: the design it argues from
dt list rnd/reviews --filter subject=<subject>     # earlier reviews: do not re-raise what was closed
```

For code, read the diff from the base commit to the head, the plan's `review_focus` lines, and the spec.

## Do this

1. Open the review:
   ```bash
   dt add rnd/reviews --name "<subject> — <lens>" --kind design|code|ux|test|security|compliance|other \
     --subject <collection>/<id> --product rnd/products/<id> --reviewer agents/<harness> --reviewed_on <date>
   ```
   A code review sets `repo` and `change_ref` (the pull request, the commit range). A review of one task of a plan: subject the plan, the task number in `name`. The body holds the scope — what you looked at and what you did not — the method, and the summary.
2. Get fresh eyes when you can. Dispatch a reviewer agent with the subject's id, the spec's id and the review focus lines, never your session's history. Without one, review as a separate pass and say so in the body.
3. One problem, one record:
   ```bash
   dt add rnd/review-findings --key <short> --review rnd/reviews/<id> --name "<the claim, one line>" \
     --severity blocker|major|minor|nit --location "<file:line, a field, a state>" \
     --failure_scenario "<the inputs or state, and the wrong outcome>" --evidence "<the quoted line, the output, the path>"
   ```
   Grade by what a person gets if it ships, not by whether the spec named the input.
4. Receive it like an engineer. Read every finding, restate it, check it against the code or the record, then set its `status`: `accepted` (agreed, not yet fixed), `fixed` (only once the fix exists, named in `resolution`), `wontfix` (the technical reason in `resolution`), `duplicate` (`duplicate_of` set). No "great point". Push back with reasons when a finding is wrong.
5. Close it: every finding has a final status, then `dt set rnd/reviews/<id> status=closed verdict=approve|changes-requested|reject`.
6. On `approve`, move the gate. A design doc: `status=active`. A change request: `status=accepted`. A plan: `status=approved` and `execution=subagent-driven|native`, which the person chooses. A test review moves nothing: the tests' own `status` is the record.
7. Commit the review, its findings and the subject by id.

## Don't

- Don't list findings as bullets in the body. A bullet cannot be filtered, assigned or closed.
- Don't grade a finding minor because the spec was silent. Grade the effect.
- Don't close a review while a finding is `open`.
- Don't hide real work in `resolution`. A fix that is work of its own is an `rnd/issues` or `rnd/change-requests` record, linked from the finding.
- Don't approve a design in the same breath you wrote it. A separate pass with fresh eyes, or an agent, is the floor.

## Done when

The review is `closed` with a verdict, every finding has a final status, and on `approve` the subject's status moved: `dt next <subject>` now names the next stage.
