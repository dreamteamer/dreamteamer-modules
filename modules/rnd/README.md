# @dreamteamer/rnd

What a workspace builds and investigates: products, design docs, user stories, screens, prototypes,
issues and features in its own repos, outside research and the questions it could not settle,
experiments, and panels of real people scored against what they actually said.

```bash
npm install @dreamteamer/rnd
npx dreamteamer compile
```

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

## working with superpowers

Four skills move the superpowers workflow's output from files into these records, each owning one
hand-off: `writing-design-docs` (brainstorming → `design-docs`, plus the stories and open questions it
leaves), `writing-implementation-plans` (writing-plans → `implementation-plans`, and the `tests` the plan
promises), `executing-implementation-plans` (executing-plans and subagent-driven development read the
plan record and tick it; test runs update `tests`; defects become `issues`) and `recording-reviews`
(requesting and receiving code review, per-task gates and design critiques → `reviews` and
`review-findings`). Research and what it could not settle stay in `research-docs` and `open-questions`.

## 0.2.0 — migrating from 0.1.0

`rnd/product-design-docs` is renamed `rnd/design-docs` (records under `data/rnd/design-docs/`, suffix
`.design-doc.md`), and every link to a design doc is spelled `design_doc`: `screens.product_design_doc`
and `user-stories.product-design-doc` are renamed. Move the files, rename the two keys and rewrite
`rnd/product-design-docs/<id>` references to `rnd/design-docs/<id>`, then `dt compile` and `dt check`.
An overlay of the old collection is renamed with it. Everything else in 0.2.0 is additive.

Product planning includes `rnd/product-user-personas` (user roles, separate from research panels), `rnd/user-journeys` (typed cross-product journeys) and `rnd/change-requests` (explicit source-grounded change decisions). User stories retain their legacy journey handle and add typed journeys, personas, change requests and acceptance evidence.
