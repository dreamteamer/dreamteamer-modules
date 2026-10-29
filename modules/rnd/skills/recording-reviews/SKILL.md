---
name: recording-reviews
description: use when anything built is reviewed in a workspace with the rnd module — superpowers:requesting-code-review, superpowers:receiving-code-review, a code review, a per-task reviewer gate in subagent-driven development, a design or prototype critique, "review this PR". Every review is an rnd/reviews record and every problem it raises is an rnd/review-findings record tracked to a final status; this skill says which fields carry what, and how feedback is received.
---

# recording reviews

**core principle:** a finding nobody can list is a finding that will be re-raised or lost. Review — or
receive a review — as the superpowers skills say; this skill only makes the sitting and each problem a
record, so "what is still open from that review" is a query.

## the review

```bash
dt add rnd/reviews --name "<subject> — <lens>" --kind code|design|ux|security|compliance|test|other \
  --subject <collection>/<id> --product rnd/products/<id> --reviewer agents/<harness> --reviewed_on <date>
```

`subject` is the record reviewed — a design doc, an implementation plan, a prototype, a screen. A code
review sets `repo` and `change_ref` (the pull request URL, the branch range or the commit) and, when it
gates one task of a plan, `subject: rnd/implementation-plans/<id>` with the task number in `name`. The
body holds the scope (what was and was NOT looked at), the method and the summary.

## each finding

One `rnd/review-findings` record per problem, never a bullet list in the review's body:

| field | carries |
|---|---|
| `key`, `review` | the id — `<review id>/<key>` — so a review's findings sit in one folder |
| `name` | the claim alone, one line |
| `severity` | `blocker` · `major` · `minor` · `nit` |
| `location` | `file:line` for code, a field for a record, a state for a screen |
| `failure_scenario` | the concrete inputs or state and the wrong outcome — what makes it checkable |
| `evidence` | the quoted line, the output, the screenshot path |
| `subject` | the narrower record, when the finding is about one part of the reviewed subject |
| `category` | free, lowercase (`dt values rnd/review-findings category` shows the vocabulary in use) |

## receiving it

Per superpowers:receiving-code-review, verify each finding before acting on it, then set its `status`:
`accepted` (agreed, not yet fixed) · `fixed` (only once the change that fixes it exists — name it in
`resolution`) · `wontfix` (the technical reason in `resolution`) · `duplicate` (`duplicate_of` set). A fix
that is real work of its own is an `rnd/issues` or `rnd/change-requests` record, linked from `issue` or
`change_request`.

The review is `closed` when every finding has a final status, with `verdict` `approve`,
`changes-requested` or `reject`. Commit the review and its findings by id.
