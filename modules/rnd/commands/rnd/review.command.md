---
name: rnd/review
description: review it — one rnd/reviews record, one finding per problem, and on approve the gate moves to the next stage
argument-hint: <rnd/change-requests/id | rnd/design-docs/id | rnd/implementation-plans/id | rnd/prototypes/id | rnd/tests/id> [--kind design|acceptance|code|ux|test] [--round N]
---
load the `recording-reviews` skill. for $ARGUMENTS: dispatch the `qa-manager` agent where you have an Agent tool — review is a service, separate from whoever built the subject — and otherwise do it yourself as a separate pass. given a change request, review the gate its state names — `dt next <it> --json` gives the binding: its design doc while draft, its acceptance lines once the design is active, its plan while draft, the code once the plan is done, the proof once `tested_on` is set, the live check once `deployed_on` is set — and set `change_request` on the review whatever its subject. open the review, write each problem as a finding with its failure scenario and evidence, receive the findings like an engineer, close with a verdict, and on `approve` move the gate. commit by id and say what `dt next` answers now.
