---
name: recording-reviews
description: >-
  use when anything built is reviewed — a design doc, a change request, an implementation plan, a prototype, a test run, a code change or a pull request; superpowers:requesting-code-review, superpowers:receiving-code-review, a per-task reviewer gate. The review stage of the R&D lifecycle: every review is an rnd/reviews record, every problem an rnd/review-findings record, and an approve verdict is what moves the subject to the next stage.
---

# recording-reviews

## What you are doing

You judge one record — a design doc, a change request, a plan, a prototype, a test run, a code change — and leave an `rnd/reviews` record with one `rnd/review-findings` record per problem. When you approve, you move the subject's status forward. That status is the gate the next stage reads.

A change request's lifecycle has a review after every stage, and `dt next` on the request names it: the design doc while it is draft · the request's acceptance lines once the design is active · the plan while it is draft · the code once the plan is done · the proof once the test stage stamped `tested_on` · the live check once `deployed_on` is set. `dt next rnd/change-requests/<id> --json` gives the open gate's binding, whose description names the kind and the subject.

## Before you start

```bash
dt get <subject>                                   # the record under review, whole
dt get rnd/design-docs/<spec>                      # for a plan or a change: the design it argues from
dt list rnd/reviews --filter subject=<subject>     # earlier reviews: do not re-raise what was closed
dt get rnd/change-requests/<id>                    # in a request's lifecycle: its `reviews` lists every earlier one
```

For code, read the diff from the base commit to the head, the plan's `review_focus` lines, and the spec.

## Do this

1. Open the review:
   ```bash
   dt add rnd/reviews --name "<subject> — <lens>" --kind design|acceptance|code|ux|test|security|compliance|other \
     --subject <collection>/<id> --change_request rnd/change-requests/<id> --product rnd/products/<id> \
     --reviewer agents/<harness> --reviewed_on <date> --round 1
   ```
   `change_request` goes on EVERY review in a request's lifecycle, whatever the subject — the request itself included — so all of a request's reviews are referenced from its `reviews`; the design doc, the plan and the test list theirs by `subject`. A design doc's or a plan's review is kind `design`. A code review is subject the plan and sets `repo` and `change_ref` (the branch, the pull request, the commit range). A change request is reviewed with kind `acceptance`: its acceptance lines, each one failable and naming something a person sees — and again after deploy, the live check: each line seen on the running thing, not in the suite. A review of one task of a plan: subject the plan, the task number in `name`. `round` is 2 for the review after a fix pass. The review of a plan also writes the plan's held-out tests — one `--visibility held-out` `rnd/tests` record per input class the plan's `## Held-out` section names, `covers` the change request (or the plan) — so the builder never sees them. The body holds the scope — what you looked at and what you did not — the method, and the summary. Re-run what the evidence claims: a test the builder says passed is run again here, never trusted.
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
6. Close it — the reviewer, never the builder. On `approve`, `dt set rnd/reviews/<id> status=closed` once no finding is `open` (a minor left for later is `accepted`). On `changes-requested` the review stays `open` until the builder has answered every finding; the reviewer of round N+1 closes round N when every finding has a final status. On `approve`, move the gate — the stamp is yours, as the reviewer, never the stage's you judged. A design doc: `status=active`. A change request: `status=accepted`, `accepted_by` and `accepted_on`. A plan: `status=approved`, keeping the `execution` the plan proposed — the person may change it before the build starts. A code review: `code_approved_on=<now>` on the plan. A test review: `verified_on=<now>` on ONE record — the change request when the plan has one, else the plan. The live acceptance review after deploy: `status=implemented` on the request. **And move the request's `stage` in the same step** — its column on the change-request board, the gate it now waits on: a design doc approved → `dt set rnd/change-requests/<id> stage=acceptance` (still `suggested`) or `stage=plan` (already `accepted`), committed with the design doc by id; a change request accepted → `dt set rnd/change-requests/<id> status=accepted accepted_by=<you> accepted_on=<now> stage=plan`, and on `reject` → `status=rejected stage=rejected`; a plan approved → `dt set rnd/change-requests/<id> stage=implement`, committed with the plan by id; a code review approved → `dt set rnd/change-requests/<id> stage=test`, committed with the plan by id; a test review approved on the request → `dt set rnd/change-requests/<id> verified_on=<now> stage=deploy` — `stage=live-check` when `deployed_on` is already set (a deployed request sent back and verified again); the live acceptance review → `dt set rnd/change-requests/<id> status=implemented stage=done`. A review that clears `verified_on` (a change landed after it) sends the request back: the send-back below. Every one of these follows rule (a), below. On `changes-requested`: the stage that built the subject gets one fix pass on the findings, then a `round: 2` review; a second `changes-requested` is a person's decision, and before stopping on it you write an `rnd/open-questions` record of kind `needs-decision` whose `blocks` names the subject and whose body names both reviews — the stop is a record a person finds, not a silent end.
7. Commit the review, its findings and the subject by id.

## The stage — rule (a), the send-back, and the gates

**Rule (a).** Write `stage` only on a request that already carries a `stage` or whose `$repo` in `dt get rnd/change-requests/<id> --json` is `.` (the workspace's own root) — read from the workspace the step writes from; on any other request, one a record layer holds whose home has not filled it, leave `stage=…` out and write the rest. When a `dt set` carrying `stage` is refused for an unknown field `stage` (the request's home runs an rnd without it), run the same `dt set` again without `stage`. A `changes-requested` verdict moves no stage: the request waits in the review's column while the builder answers and the next round runs. A step whose moving field lives on another record (the design doc, the plan) writes that record, then the request's `stage`, and commits both together by id.

**The send-back.** A step that sends a request back — a stale plan returned to `/rnd:plan`, `verified_on` cleared because a change landed after it, `tested_on` cleared, a release rolled back — after its own write reads `dt next rnd/change-requests/<id> --json` (plain `dt next` prints `/rnd:review` without saying which review), takes the bindings whose state is `available`, maps each through the table below, and writes the **earliest** of those stages: `dt set rnd/change-requests/<id> stage=<that stage>`. A deployed request whose `verified_on` is cleared opens both the test (or its review) and the live check, and stands at the earlier — the work to redo. `implemented` is `done`; `rejected` is `rejected`.

| binding (`dt next --json`) | stage |
|---|---|
| `rnd--design--change-requests` | `design` |
| `rnd--review--change-requests--design` | `design-review` |
| `rnd--review--change-requests` | `acceptance` |
| `rnd--plan--change-requests` | `plan` |
| `rnd--review--change-requests--plan` | `plan-review` |
| `rnd--implement--change-requests` | `implement` |
| `rnd--review--change-requests--code` | `code-review` |
| `rnd--test--change-requests` | `test` |
| `rnd--review--change-requests--test` | `test-review` |
| `rnd--deploy--change-requests` | `deploy` |
| `rnd--release--change-requests` | `deploy` |
| `rnd--review--change-requests--deploy` | `live-check` |

`dt check` warns when a request's `stage` is not this table's answer, or contradicts its own status, dates and links; `migrate-change-request-stage` fills or repairs it. Never set `stage` by hand outside a step.

## Don't

- Don't list findings as bullets in the body. A bullet cannot be filtered, assigned or closed.
- Don't grade a finding by whether the spec named the input. Grade the effect, within the ask: outside the acceptance lines and stories it is `minor` at most, with a proposed line.
- Don't close a review while a finding is `open`, and don't close one as the builder: the reviewer opens it, sets the verdict and closes it; the builder answers findings and asks for the next round.
- Don't hide real work in `resolution`. A fix that is work of its own is an `rnd/issues` or `rnd/change-requests` record, linked from the finding.
- Don't approve a design in the same breath you wrote it. A separate pass with fresh eyes, or an agent, is the floor.
- Don't set `verdict` on a review that names a `human_reviewer`. The findings are yours; the verdict is theirs.
- Don't close a review of anything customer-facing, security-relevant or visual without a `human_reviewer`. Those are the verdicts people keep for themselves.

## Done when

The review is `closed` with a verdict and its `change_request` set when it belongs to one, every finding has a final status, and on `approve` the gate moved: `dt next` on the request (or the subject) now names the next stage.
