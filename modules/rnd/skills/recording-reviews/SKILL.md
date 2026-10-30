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
   dt add rnd/reviews --name "<subject> — <lens>" --kind design|acceptance|code|ux|test|security|compliance|other \
     --subject <collection>/<id> --product rnd/products/<id> --reviewer agents/<harness> --reviewed_on <date> --round 1
   ```
   A code review sets `repo` and `change_ref` (the pull request, the commit range). A change request is reviewed with kind `acceptance`: its acceptance lines, each one failable and naming something a person sees. A review of one task of a plan: subject the plan, the task number in `name`. `round` is 2 for the review after a fix pass. The review of a plan also writes the plan's held-out tests — one `--visibility held-out` `rnd/tests` record per input class the plan's `## Held-out` section names, `covers` the change request (or the plan) — so the builder never sees them. The body holds the scope — what you looked at and what you did not — the method, and the summary. Re-run what the evidence claims: a test the builder says passed is run again here, never trusted.
2. Get fresh eyes when you can. Dispatch the `qa-manager` agent with the subject's id, the spec's id and the review focus lines, never your session's history — it reads everything and writes only the review. Without an Agent tool, review as a separate pass and say so in the body.
3. One problem, one record:
   ```bash
   dt add rnd/review-findings --key <short> --review rnd/reviews/<id> --name "<the claim, one line>" \
     --severity blocker|major|minor|nit --location "<file:line, a field, a state>" \
     --failure_scenario "<the inputs or state, and the wrong outcome>" --evidence "<the quoted line, the output, the path>"
   ```
   Grade by what a person gets if it ships, within the ask: a `major` or `blocker` names the acceptance line or story it breaks; a finding about an input or behaviour the acceptance lines and stories never name is `minor` at most and carries a proposed acceptance line in its body.
4. Set the verdict — yours alone, as the reviewer: `dt set rnd/reviews/<id> verdict=approve|changes-requested|reject`. When a person must sign off — a client's acceptance, a security review, a release — set `human_reviewer` to them, leave `verdict` empty, and hand them the review's id: their word closes it, never yours.
5. Receive it like an engineer — this is the builder's step, and the only writes the builder makes on a review are on its findings. Read every finding; one you do not understand stops you until it is clear, because findings are related. Restate it, check it against the code or the record, ask "is this used at all" before building what a reviewer calls proper, then answer each: `fixed` (only once the fix exists, named in `resolution`) or `wontfix` (the technical reason in `resolution`); `duplicate` with `duplicate_of` set. No "great point". Push back with reasons when a finding is wrong — in `resolution`, never by closing it. Then ask for round N+1; you never set `verdict` or `status` on the review.
6. Close it — the reviewer, never the builder. On `approve`, `dt set rnd/reviews/<id> status=closed` once no finding is `open` (a minor left for later is `accepted`). On `changes-requested` the review stays `open` until the builder has answered every finding; the reviewer of round N+1 closes round N when every finding has a final status. On `approve`, move the gate. A design doc: `status=active`. A change request: `status=accepted`, `accepted_by` and `accepted_on`. A plan: `status=approved`, keeping the `execution` the plan proposed — the person may change it before the build starts. A test review: the test stage stamps `verified_on` on ONE record from this verdict — the change request when the plan has one, else the plan. On `changes-requested`: the stage that built the subject gets one fix pass on the findings, then a `round: 2` review; a second `changes-requested` is a person's decision, and before stopping on it you write an `rnd/open-questions` record of kind `needs-decision` whose `blocks` names the subject and whose body names both reviews — the stop is a record a person finds, not a silent end.
7. Commit the review, its findings and the subject by id.

## Don't

- Don't list findings as bullets in the body. A bullet cannot be filtered, assigned or closed.
- Don't grade a finding by whether the spec named the input. Grade the effect, within the ask: outside the acceptance lines and stories it is `minor` at most, with a proposed line.
- Don't close a review while a finding is `open`, and don't close one as the builder: the reviewer opens it, sets the verdict and closes it; the builder answers findings and asks for the next round.
- Don't hide real work in `resolution`. A fix that is work of its own is an `rnd/issues` or `rnd/change-requests` record, linked from the finding.
- Don't approve a design in the same breath you wrote it. A separate pass with fresh eyes, or an agent, is the floor.
- Don't set `verdict` on a review that names a `human_reviewer`. The findings are yours; the verdict is theirs.
- Don't close a review of anything customer-facing, security-relevant or visual without a `human_reviewer`. Those are the verdicts people keep for themselves.

## Done when

The review is `closed` with a verdict, every finding has a final status, and on `approve` the subject's status moved: `dt next <subject>` now names the next stage.
