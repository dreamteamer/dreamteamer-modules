---
name: writing-implementation-plans
description: use when an implementation plan is being written in a workspace with the rnd module — superpowers:writing-plans, "plan the build of X", turning an agreed rnd/design-docs record into tasks. The plan is an rnd/implementation-plans record whose spec is the design doc, never a file under docs/; the tests it promises are rnd/tests records. Says how the writing-plans header maps onto fields, how tasks are counted and when the plan is approved.
---

# writing implementation plans

**core principle:** the plan is a COMMITMENT about how the design gets built, and its tests are the
claims that will prove it. Write the plan exactly as `superpowers:writing-plans` says — header, file
structure, tasks with **Files**, **Interfaces** and checkbox steps, self-review. Its location rule is
overridden here: the plan is an `rnd/implementation-plans` record, the spec it cites is an
`rnd/design-docs` record.

## the record

```bash
dt add rnd/implementation-plans --name "<feature>" --spec rnd/design-docs/<id> --product rnd/products/<id> \
  --goal "<one sentence>" --architecture "<two or three sentences>" --tech_stack "<a>" --tech_stack "<b>" \
  --repo repos/<id>
```

| writing-plans header | field |
|---|---|
| Goal | `goal` |
| Architecture | `architecture` |
| Tech Stack | `tech_stack`, one entry each |
| Spec | `spec` — the design doc, so the doc lists the plan back |
| Global Constraints | `global_constraints`, one line each, values verbatim from the spec |
| Review Focus | `review_focus`, one line each |

The header is ALSO written at the top of the body, as writing-plans lays it out, so the plan reads whole;
the fields are what a list and a filter see. The tasks are the body. Set `tasks_total` to the number of
`### Task` blocks, `tasks_done: 0`, `status: draft`.

## the tests the plan promises

Each test the plan names that proves something a person would ask about — a story works, a change
request is accepted, a defect stays fixed, a Review Focus line holds — is an `rnd/tests` record:
`key`, `name` (what it proves), `product`, `covers` (the stories, change requests or issues), `kind`,
`repo`, `runner` (the exact command from the plan's step), `expected`, `status: planned`. A unit test of
a helper does not need a record; a test someone will ask "is this covered" about does. Name the test's
id in the step that writes it, so the executor can update it.

## approval

When the plan has been reviewed and the way to run it chosen, set `execution` (`subagent-driven` or
`native`) and `status: approved`, and point the design doc's `plan` at the record where no plan module
is installed. Commit the plan and its test records by id. Execution is the
`executing-implementation-plans` skill.
