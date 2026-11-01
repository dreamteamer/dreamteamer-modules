# Updating @dreamteamer/rnd

One section per release, newest first. Each says what you have to **do** in a workspace that
installs this module; most of the time it is `dt compile`, then `dt check`.

```bash
npm install @dreamteamer/rnd@latest
npx dreamteamer compile
npx dreamteamer check
```

---

## 0.6.0 — releases: a product's versions, each listing the changes it ships

A new collection, `rnd/releases`, and a new command, `/rnd:release`. Nothing is removed or renamed and
every record compiles as it is. Three things to do: compile; look for the one id collision below; and
decide, for change requests already verified and waiting to deploy, whether they ship in a release.

```bash
npm install @dreamteamer/rnd@0.6.0
npx dreamteamer compile
npx dreamteamer check
```

**What a release is.** One release of one product: `version` (semver, no `v`), `product`, `package`
when the product ships several packages from one repo on separate version lines, `repo` and `tag`,
`status` (`planned` · `cut` · `published` · `rolled-back`), `cut_on`, `published_on`, `published_to`
(one URL per registry), the notes as its body, and the change requests and issues it ships —
generated from a new `release` field on each. The id is `<product>/<version>`, or
`<product>/<package>/<version>`:

```bash
dt add rnd/releases 0.6.0 --product rnd/products/<p> [--package <short-name>]
dt set rnd/change-requests/<id> release=rnd/releases/<p>/0.6.0   # schedule a change into it
```

**One release per product, package and version.** `dt add` refuses the id twice, and `dt check` now
refuses a release whose id does not name its own product, package and version — a hand-written copy,
or `dt set … version=` on a record, which leaves the id behind — naming both claimants. The check is
rnd's own extension: `compose.json` names it (`extension: ./lib/extension.mjs`), so the package's
`dreamteamer.extension` is that entry, which wraps
the `dt notebooklm` verb and harness unchanged and adds the check. Re-versioning a planned release is two
writes, in this order: `dt set rnd/releases/<id> version=<new>`, then `dt rename rnd/releases/<id>
<product>/<new>` (which moves every `release` pointing at it) — `dt check` flags it between the two.
A cut or published release is never re-versioned.

**A request in a release is deployed by the release.** With `release` set, `dt next` on a verified
request names `/rnd:release`, not `/rnd:deploy`; the release's publish step stamps `deployed_on` with
its `published_on`, and the live acceptance review opens then — never while the release is planned,
cut or rolled back, even with `deployed_on` written by hand. A request with no `release` deploys as
before. The stage map's deploy stage draws `release` beside `deployed_on`.

**`/rnd:release` is a `dt next` answer per step on a release**: plan (planned, no notes — schedule the
changes, write the notes from their bodies), cut (planned, notes written — the repo's release gates
with their exit codes, then a PERSON tags: tagging is publishing, and the rnd-agent stops there),
publish (cut — the registries answer the exact version; `published_on`, `published_to`, and
`deployed_on` on every request carried) — and, once published, a fourth answer while any request it
carries has no `deployed_on` or an issue no `fixed_in`: stamp (the publish step's last half, resumable on its
own); and once rolled back, while it still carries an accepted request or an issue: rollback (move each off
it, clearing `deployed_on` and `fixed_in`) — a request on a rolled-back release answers `/rnd:release` until
it is moved. A cut needs
`repo`, `tag` and `cut_on`; `published` needs `published_on` and `published_to` — a write without
them is refused.

What that does to records you have:

- **A request verified and not yet deployed** answers `/rnd:deploy` as before. To ship it in a release
  instead, set its `release`; it then answers `/rnd:release`.
- **A request already deployed** is untouched: with no `release`, its live review is open as it was.
  Setting `release` on it afterwards closes that review until the release is `published` — file the
  release as published first.
- **Releases already shipped** are filed as `published` records with the date they were cut and
  published (`created` set to the cut, so the newest-first order holds), each request they carried
  given its `release`. Then rebuild the mirrors once and check:
  ```bash
  dt relations rebuild rnd/releases && dt relations rebuild rnd/products && dt check
  ```

**Sessions on the lifecycle, where `@dreamteamer/core` 0.8.0 or later is installed.** rnd ships three
session-bindings on change requests — design (no design doc and no plan yet), build (an approved
plan) and review (built, not yet verified) — each one session at a time, and the rnd-agent and the
qa-manager claim a request with `dt session start` before a stage and end it after. Nothing to do: a
workspace with core gets them at compile; without core the `session-bindings/` folder is in rnd's
`ignore`, so rnd still compiles alone and no binding exists. A workspace that binds change requests
itself disables rnd's three by id (`session-bindings/change-requests--design` and so on).

**Collisions to look for first.** A workspace with its own `rnd/releases` collection, a `release` field
on its change requests or issues, a `releases` field on its products, or its own `rnd-release` skill or
`rnd/release` command now collides with the shipped one — rename or delete its copy before you compile. A workspace that
installed `@dreamteamer/notebooklm` beside rnd was already refused (one verb twice); nothing changes
there.

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

**The R&D module has a page: activity beside counts by status.** rnd now ships ten ui-views — the
page `modules-rnd` (activity beside the counts of change requests, issues, features, tests, reviews,
design docs and implementation plans by status) and the views it nests. Nothing to do beyond
`dt compile`. One collision to look for first: a workspace that authored a view with one of these ids
(`modules-rnd`, `modules-rnd-activity`, `modules-rnd-counts`, `rnd-<collection>-by-status`) in its own
module now fails compile on the duplicate id — delete its copy, or keep it and add the shipped one to
`dreamteamer.disable` (`"ui-views/<id>"`).

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
