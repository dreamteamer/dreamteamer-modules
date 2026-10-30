---
name: rnd-plan
description: plan the build — an rnd/implementation-plans record an engineer who never saw the codebase can build from, and the tests it promises
argument-hint: <rnd/change-requests/id | rnd/design-docs/id>
---
load the `rnd-plan` skill. for $ARGUMENTS: read the spec and the repo, write the plan with the header as fields and the tasks in the body, one `rnd/tests` record per promised proof, read it back as the builder, commit by id, and queue `/rnd-review`.
