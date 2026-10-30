# @dreamteamer/rnd

What a workspace builds and investigates: products, design docs, user stories, screens, prototypes,
issues and features in its own repos, outside research and the questions it could not settle,
experiments, and panels of real people scored against what they actually said.

```bash
npm install @dreamteamer/rnd
npx dreamteamer compile
```

## wikis and notebooks ride along

This package also carries `@dreamteamer/wikis` and `@dreamteamer/notebooklm`, composed in the way
`@dreamteamer/core` is composed from the small modules: `compose.json` names the two origins and
lists every copy with its hash, `scripts/compose-core.mjs rnd` in the modules repo regenerates them,
and a test fails when a copy drifts from its origin. So one install brings the `wikis` collection and
`working-with-wikis`, the `notebooks` collection with `/restore-notebook`, `/capture-notebook-sources`,
`exporting-to-notebooklm` and `using-notebooklm`, the `dt notebooklm` verb (this package is the
extension — `src/` is notebooklm's), and the `npx dt-wiki` and `npx dt-notebook` commands
(`bin/wikis-wiki.mjs`, `bin/notebooklm-notebook.mjs`). A workspace that installs rnd must NOT also
install `@dreamteamer/wikis` or `@dreamteamer/notebooklm`: two modules shipping `wikis` is a name
collision, and the engine refuses the same extension verb twice.

Fields that point at captured files (`reference_file`, `screenshots_folder`, `media_folder`) hold
`${env:FILES_FOLDER}/…` templates. Declare `FILES_FOLDER` in your `package.json` `dreamteamer.vars`
and set it in `.env` before `dt resolve` can render them.

## what a descriptor cannot say

**The commercial funnel is not referenced, on purpose.** Every workspace models its funnel
differently, so this package points a feature's `for_client` and a product's `company` at
`companies`, the one organisation record every workspace has. A workspace with a funnel adds its own
field in an overlay.

**People inside a persona are plain strings, not references.** A panel's `members[].person`,
`quotes[].speaker` and `dissent[].person` carry a `<collection>/<id>` shape but are not validated: the
people a panel is built from may live in another workspace, and a reference that `check` would refuse
is worse than a string that stays greppable.

**No design skill ships here.** A prototype record is the brief and the pointer; how the mockup gets
drawn is the harness's business.

**Specs and plans are records.** A brainstormed design is a `design-docs` record; the plan that
implements it is an `implementation-plans` record whose `spec` points at the design, its body in the
writing-plans shape (a header of goal, architecture, tech stack, global constraints and review focus,
then tasks with files, interfaces and checkbox steps). The R&D paper trail is searchable with the same
verbs as everything else.

**A review is a record, and so is each thing it finds.** `rnd/reviews` holds one review of a design, a
prototype, a screen, a plan or a change in a repo, with its verdict; `rnd/review-findings` holds one
problem per record, stored in its review's folder, with `severity`, `location`, a `failure_scenario` and
a `status` tracked to `fixed`, `wontfix` or `duplicate`. A finding that becomes work links the
`issues` or `change-requests` record that carries it.

**What is built is proved and styled by records too.** `rnd/tests` names what each test `covers` (a
story, a change request, an issue), and each of those lists its tests back. `rnd/design-systems` is a
folder per system — `index.md` is the spec, the designer's files sit beside it verbatim — and products
and design docs name the `design_system` they ship under.

**A reference is evidence, not a design.** `rnd/references` holds what was studied — a competitor's
surface, a recording, a standard — and its `prd` is written as the PROMPT that would regenerate it, with
no opinion in it; judgement goes in the body. Our design is the `design-docs` record that cites
it in `references`, in our `branding`; the clickable thing is the `prototypes` record whose `design_doc`
points back. `plan` on the design doc is a `<collection>/<id>` string — `projects/<id>` where the plan
module is installed. The chain is bound, so `dt next` on a design doc names the missing hop, and
`building-from-references` is the procedure. ffmpeg is the one binary this module shells out to
(`extract-frames.mjs`), and `npx dt-setup doctor` says whether it is there.

## the lifecycle

Eight commands move a product's work from an idea to a deployment, each bound to the record it acts
on so `dt next <record>` says what runs now: `/rnd:design` (brainstorm → `design-docs`, with the
stories and open questions it leaves), `/rnd:review` (one `reviews` record, one `review-findings`
record per problem; `approve` moves the subject on), `/rnd:prototype` (the first `prototypes` record
with a live URL, or a round of feedback on it), `/rnd:change-request` (what changes, against which
design, with the evidence that would accept it), `/rnd:plan` (an `implementation-plans` record and the
`tests` it promises), `/rnd:implement` (task by task, the record as the progress marker),
`/rnd:test` (every covering test run and set from its output) and `/rnd:deploy` (checked live,
`deployed_on` stamped). Each command loads one plainly written skill of the same name, five headings
each: what you are doing · before you start · do this · don't · done when.

Two agents ride on them. `rnd-agent` walks the stages for one record and stops twice by design — after
the plan is approved (the person says go, or changes the execution) and before the deploy (merging is
theirs) — and sooner on a blocker, a second `changes-requested`, or a review that names a
`human_reviewer`. `qa-manager` reviews as a service: it reads everything, re-runs the evidence, runs the
`held-out` tests, and writes only the review, by contract rather than by a tool wall, so the builder
never grades its own work. The superpowers skills stay useful where they add depth — the stage skills name
them — but nothing here needs them installed.

## 0.3.0 — from 0.2.0

rnd now composes `wikis` and `notebooklm` (above). A workspace that had `@dreamteamer/wikis` or
`@dreamteamer/notebooklm` installed beside rnd uninstalls them — `npm uninstall @dreamteamer/wikis
@dreamteamer/notebooklm`, then `npx dreamteamer compile` — and keeps its records, folders and
`dreamteamer.harnesses` entry as they are: the collections, the commands and the `dt notebooklm` verb
are the same, delivered from this package. A workspace that pointed at the origin's script by path
(`node_modules/@dreamteamer/wikis/bin/wiki.mjs`) now names `node_modules/@dreamteamer/rnd/bin/wikis-wiki.mjs`;
`npx dt-wiki` and `npx dt-notebook` are unchanged.

Additive otherwise. `change-requests` gains `design_docs`, an `implementation_plans` mirror, `accepted_by`,
`accepted_on`, `verified_on` and `deployed_on`; `implementation-plans` gains `change_request`, `issue`,
`verified_on` and a `tests` mirror; `issues` lists its `implementation_plans`; `tests.covers` admits a
plan and `tests.visibility` marks a held-out acceptance test; `reviews` gains `round` and
`human_reviewer`; `design-docs` lists its `change_requests` and defaults `status` to `draft`. Records compile unchanged. Three skills are replaced by
stage skills — `writing-design-docs` by `rnd-design`, `writing-implementation-plans` by `rnd-plan`,
`executing-implementation-plans` by `rnd-implement` — so a workspace that named one of them in its own
skills or commands updates the name.

## 0.2.0 — migrating from 0.1.0

`rnd/product-design-docs` is renamed `rnd/design-docs` (records under `data/rnd/design-docs/`, suffix
`.design-doc.md`), and every link to a design doc is spelled `design_doc`: `screens.product_design_doc`
and `user-stories.product-design-doc` are renamed. Move the files, rename the two keys and rewrite
`rnd/product-design-docs/<id>` references to `rnd/design-docs/<id>`, then `dt compile` and `dt check`.
An overlay of the old collection is renamed with it. Everything else in 0.2.0 is additive.

Product planning includes `rnd/product-user-personas` (user roles, separate from research panels), `rnd/user-journeys` (typed cross-product journeys) and `rnd/change-requests` (explicit source-grounded change decisions). User stories retain their legacy journey handle and add typed journeys, personas, change requests and acceptance evidence.
