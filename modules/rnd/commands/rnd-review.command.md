---
name: rnd-review
description: review it — one rnd/reviews record, one finding per problem, and on approve the subject moves to its next stage
argument-hint: <rnd/design-docs/id | rnd/change-requests/id | rnd/implementation-plans/id | rnd/prototypes/id> [--kind design|code|ux|test]
---
load the `recording-reviews` skill. for $ARGUMENTS: dispatch the `qa-manager` agent where you have an Agent tool — review is a service, separate from whoever built the subject — and otherwise do it yourself as a separate pass: open the review, write each problem as a finding with its failure scenario and evidence, receive the findings like an engineer, close with a verdict, and on `approve` move the subject's status. commit by id and say what `dt next` answers now.
