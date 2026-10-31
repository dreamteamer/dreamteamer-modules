# Updating @dreamteamer/rnd

One section per release, newest first. Each says what you have to **do** in a workspace that
installs this module; most of the time it is `dt compile`, then `dt check`.

```bash
npm install @dreamteamer/rnd@latest
npx dreamteamer compile
npx dreamteamer check
```

---

## 0.5.2 — a review after every stage, and every record lists its reviews

Nothing is removed or renamed, and every record compiles as it is. Two things to do — rebuild the new
mirrors, because `dt check` reports a design doc, plan, test, issue or feature whose `reviews` is
stale until you do (`reviews: stale — run: dreamteamer relations rebuild …`), and read what `dt next`
answers on records already in flight before you run the lifecycle again.

**Every review names its change request.** `rnd/reviews` has a new `change_request` field: the
request a review belongs to, whatever it judged — the request itself, its design doc, its plan, its
code, its tests. The request's new `reviews` field is generated from it, so every review of a
request's lifecycle is listed on the request. Design docs, plans, tests, issues and features list
theirs by `subject`, also generated. Fill both on the records you have:

```bash
# each review in a request's lifecycle — including one whose subject IS the request
dt set rnd/reviews/<id> change_request=rnd/change-requests/<request>
# then regenerate the mirrors, once, and check
dt relations rebuild rnd/change-requests
for c in rnd/design-docs rnd/implementation-plans rnd/tests rnd/issues rnd/features; do dt relations rebuild $c; done
dt check
```

`dt set` moves the request's mirror as it writes, so the rebuild is only for the `subject` mirrors
on reviews written before this version.

**A review after every stage.** A change request names exactly one next verb at every stage — the
review when a stage has just ended, the next stage once that review approved:

| stage ends | the review `dt next` names | its `approve` |
|---|---|---|
| design (doc `draft`) | the design doc, kind `design` | doc `active` |
| — (design `active`, request `suggested`) | the request, kind `acceptance` | request `accepted` |
| plan (plan `draft`) | the plan, kind `design` | plan `approved` |
| implement (plan `done`) | the plan, kind `code`, `change_ref` the branch | plan `code_approved_on` |
| test (request `tested_on`) | the request, kind `test` | request `verified_on` |
| deploy (request `deployed_on`) | the request, kind `acceptance` — the live check | request `implemented` |

Three new datetime marks carry it: `code_approved_on` on a plan and `verified_on` (now the
reviewer's) are stamped by the reviewer on `approve`; `tested_on` on a request — or on a plan with no
request — is stamped by the test stage when every covering test passed. `/rnd:implement` now reaches
a request's approved plan from the request.

What that does to a record in flight:

- **A request still `suggested` with no design** answers `/rnd:design`, not `/rnd:review`: the
  acceptance review waits for an active design. **An accepted request with no design and no plan**
  answers `/rnd:design` too — `/rnd:plan` now needs an active design (a change too small for one is
  an issue on the quick path).
- **An accepted request with no design and a plan already** is not sent back to design: `/rnd:design`
  is offered only while the request has no plan, so it answers by its plan's state — `/rnd:implement`,
  the code review, `/rnd:test` — exactly one. Write the design later if you want it on record.
- **A request with a draft design AND a plan** answers by the plan too; the draft design's review is
  on the design doc itself (`dt next rnd/design-docs/<id>`), never a second verb on the request.
- **A plan already `done`** answers `/rnd:review` (the code review) until `code_approved_on` is set.
  If its branch was reviewed before this version, stamp it from that review:
  `dt set rnd/implementation-plans/<id> code_approved_on=<the review's date>` and set the review's
  `change_request`.
- **A request with `verified_on` set** answers `/rnd:deploy` until `deployed_on` is set, then the
  live acceptance review, and nothing once `implemented` — the code review and the test stage are
  never offered again. One verified before this version has no `tested_on`; leave it empty.
- **A request deployed before this version** is `implemented` already (the deploy stage set it) and
  answers nothing. One deployed from now on stays `accepted` until the live acceptance review; a
  `rejected` request with `deployed_on` is offered nothing.
- **A second plan or design beside a dead one** (a plan `abandoned` next to a new `draft`, a design
  `superseded` next to a new `draft`) answers the new record's review: a dead record never counts
  as the stage done. A request whose only plan is `abandoned` answers nothing — give it a new plan
  by hand (`dt add rnd/implementation-plans … --change_request <it>`), the known limit.

**The stage map.** `rnd/change-requests` declares its lifecycle under
`display.record.options.stages`: design · plan · implement · test · deploy, each with the fields that
hold its records, which of the request's reviews belong to it, and the bindings whose states are its
gate. A surface that knows the option draws it on the request's page — an empty stage drawn as empty,
not left out; any other ignores it.

## 0.5.1 — change requests read as a list: a short descriptive name, a one-line description, the rest in the body

Nothing breaks: no field was added, removed or renamed, and every record compiles as it is. What
changed is what the descriptor **says** about three fields, and how the collection lists.

**The three sizes.** A change request is read in a list before it is read in full, so its fields
have one size each, never mixed:

| field | size | example |
|---|---|---|
| `name` | a handful of words — what changes, the way a row reads it | `Activity page loads instantly` |
| `description` | one line — what changes, for whom | `The Activity page shows its first 20 entries as each repo answers instead of waiting for every history.` |
| body (`content`) | everything longer: the paragraph, the ask in the source's own words, what is out of scope, what it touches by id, the phases | — |

**The list** shows `created` · `status` · `name` · `products`, newest first (`sort: -created`),
instead of `name` · `description`. A name written as a sentence now overflows its column, which is
the point: the row is where you see that the name is too long.

**`acceptance` on the CLI.** It is a list. Pass one `--acceptance` per entry:

```bash
dt add rnd/change-requests --key activity-first-page --name "Activity page loads instantly" \
  --products rnd/products/editor --description "The Activity page shows its first 20 entries as each repo answers." \
  --acceptance "the first page asks for 20, bounded per repo" \
  --acceptance "the first repo to answer is on screen before the slowest has returned"
```

One flag holding several lines is split on its **commas** — `--acceptance "a, b and c"` becomes
three entries, cut mid-sentence. If a record of yours shows an acceptance list of sentence fragments,
that is what happened; rewrite the list, one entry per piece of evidence.

**Bringing an existing record to shape.** For each change request whose name is a sentence or whose
description is a paragraph:

1. Move the long text into the body under a heading (`## Why`, `## The ask`, `## Out of scope`,
   `## Phases` — whatever it is), keeping the source's own words.
2. Set `description` to one line and `name` to a few words:
   ```bash
   dt set rnd/change-requests/<id> name="<a few words>" description="<one line>"
   ```
3. Re-enter `acceptance` with one `acceptance=` per entry — repeated keys, the way `--acceptance`
   repeats on `add`; a single value is split on its commas, a repeated key keeps them:
   ```bash
   dt set rnd/change-requests/<id> acceptance="the first page asks for 20, bounded per repo" \
     acceptance="the first repo to answer is on screen before the slowest has returned"
   ```
4. `dt check`, then `dt commit rnd/change-requests/<id>`.

The `rnd-change-request` skill writes new records in this shape from now on.

## 0.5.0 and earlier

See the README's release notes (`## 0.5.0 — from 0.4.0`, `## 0.4.0 — from 0.3.0`).
