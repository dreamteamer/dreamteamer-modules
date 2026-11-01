# @dreamteamer/rnd

What a workspace builds and investigates: products, design docs, user stories, screens, prototypes,
issues and features in its own repos, outside research and the questions it could not settle,
experiments, and the personas a product is built for — panels of real people grounded in their own
words, and the roles a product serves.

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

**No design skill ships here.** `lib/prototype/` ships demo furniture only (a player, a metadata layer, a
catalogue, the tools that check them), themed by the prototype; the product's own screens and chrome are
never rnd's.

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

Nine commands move a product's work from an idea to a release, each bound to the record it acts
on so `dt next <record>` says what runs now: `/rnd:design` (brainstorm → `design-docs`, with the
stories and open questions it leaves), `/rnd:review` (one `reviews` record, one `review-findings`
record per problem; `approve` moves the subject on), `/rnd:prototype` (the first `prototypes` record
with a live URL, or a round of feedback on it), `/rnd:change-request` (what changes, against which
design, with the evidence that would accept it), `/rnd:plan` (an `implementation-plans` record and the
`tests` it promises), `/rnd:implement` (task by task, the record as the progress marker),
`/rnd:test` (every covering test run and set from its output), `/rnd:deploy` (checked live,
`deployed_on` stamped) and `/rnd:release` (a `releases` record walked plan → cut → published, the cut
a person's tag, the publication stamping `deployed_on` on every change request it carries). Every stage ends in a review, and on a change request `dt next` names exactly
one verb at a time — the review when a stage has just ended, the next stage once it approved; each
review names its request (`change_request`), which lists them all. Each command loads one plainly written skill of the same name, five headings
each: what you are doing · before you start · do this · don't · done when.

Two agents ride on them. `rnd-agent` walks the stages for one record in the lifecycle's order (`dt next`
lists every command a record is eligible for, not the one to run next) and stops twice by design — after
the plan is approved (the person says go, or changes the execution) and before the deploy (merging is
theirs; for a request in a release, at the release's cut — the tag is theirs) — and sooner on a blocker, a second `changes-requested` (written first as an `open-questions`
record of kind `needs-decision` that blocks the subject, so the stop is a record a person finds), or a
review that names a `human_reviewer`. `qa-manager` reviews as a service: it reads everything, re-runs the
evidence, writes the `held-out` tests at the plan review and runs them at the test review, owns the review
record from verdict to close, and writes nothing else, by contract rather than by a tool wall, so the
builder never grades its own work. A finding is graded by its effect within the ask: a `major` or
`blocker` names the acceptance line or story it breaks; one outside them is `minor` at most, with a
proposed line. The superpowers skills stay useful where they add depth — the stage skills name
them — but nothing here needs them installed.

**A change request shows how far it got.** Its free `tags` carry four stage tags — `designed`,
`implemented`, `tested`, `deployed` — each added by its stage's skill when the work is done, beside any
tag a person keeps. The `tags` field declares how a surface draws them (`display.viewer: stage-checks`):
per stage one check when tagged, two when a review of the matching kind exists, green when it approved
with no open finding, orange when it left remarks, its description on hover; a surface without the
viewer draws chips. `dt check` warns — never fails — when `deployed` and `deployed_on` disagree, on an
engine that has the warning channel (`CHECK_WARNINGS`); on one without it the rule is silent.

**A change request is on a board.** Its `stage` names the gate it waits on — the verb `dt next` names, from
`design` to `live-check`, then `done` or `rejected` — and the **Board** view (`rnd-change-requests-board`)
draws the requests as kanban columns by it. The lifecycle writes it as it moves a request, never a person;
`dt check` warns when it disagrees with the request's own record, and `migrate-change-request-stage` fills
it on an upgrade and repairs one that drifted.

## the software factory

rnd ships one workflow, `software-factory`, at `data/workflows/software-factory.workflow.md`: the
meeting intake (calendar, recordings, transcripts, summaries, commitments, critiques, engagements),
then references, the change requests the calls asked for, and each change designed, reviewed,
prototyped where it asks, planned, built, proved and deployed — the lifecycle above, in the
`rnd-agent`'s order, with its two stops. It runs with `/workflow:run software-factory`, which the
`workflows` collection brings (`@dreamteamer/core` carries it). Its meeting steps name core's commands,
so it installs only where both are compiled: `npx dt-workflows install software-factory` refuses
otherwise, naming each command it lacks.

## the prototype harness

A clickable prototype that plays its journeys keeps three things apart: WHAT happens (the records — a
journey's `steps`, each on a screen, with its story, role, caption, rule ids and open questions), HOW the
demo shows it (the prototype's playback module per journey: the demo user, the anchor, the actions on its
own store), and the furniture that plays one with the other. rnd ships the furniture:

- **The browser half** — `player.js`, `playback.js`, `meta.js`, `catalog.js`, `dom.js`, `harness.css` —
  is copied into the prototype by `npx dt-prototype vendor` (a static prototype cannot import from
  `node_modules`), each file stamped with the package version and a hash of its body. A stamped file
  edited in place is a fork; `vendor` refuses to overwrite it, and `check` and `play` report it.
- **The Node half** runs from the package: `npx dt-prototype init · vendor · export · check · play · shoot ·
  walk`, from the prototype's folder, reading its `harness.config.mjs`. `export` writes the prototype's
  `journeys.js` and `meta.js` from `dt list --json` — it parses no record body and copies no row.
  `playwright-core` is resolved at run time, never a dependency.

The prototype keeps its world, its store and fixtures, its playback modules, its chrome and a small
adapter (the config and the init options). A screen's portal is its `product`; one product with several
windows reads it from a field (`portal: { from: 'field' }`) or a tag (`portal: { from: 'tag', prefix }`).
An identifier — a story key, a question id — is never scrubbed: one the prototype's `scrub` would change
fails the export, so the record is renamed. The `rnd-prototype` skill holds the contract.

## 0.8.0 — from 0.7.0

rnd ships no session bindings. The three on change requests that 0.6.0 added — design, build, review —
are gone, so a workspace's instructions, `dt sessions open` and `dt next` show the lifecycle once, as
command bindings; the rnd-agent and the qa-manager no longer claim a request. Core's session-bindings
kind and verbs stay, for a workspace that declares its own. `bin/migrate-session-bindings.mjs` unbinds the
session records the old bindings opened, so `dt check` stays green. `UPDATING.md` has the commands.

## 0.7.0 — from 0.6.0

Change requests carry stage tags. `rnd/change-requests` gains `tags`; four of its values —
`designed`, `implemented`, `tested`, `deployed` — are set by the stage skills when a stage's work is
done, beside any tag a person keeps, and the field declares `display.viewer: stage-checks` for a
surface that draws them as checks. `dt check` warns, never fails, when `deployed` and `deployed_on`
disagree, through rnd's extension entry, on engine 0.43.0 or later (`CHECK_WARNINGS`); on an older
engine the rule is silent, so the engine floor stays `>=0.38.0`. `UPDATING.md` has the commands.

## 0.6.0 — from 0.5.2

Releases: a product's versions, each listing the changes it ships. `rnd/releases` holds one release of
one product — `version`, `package` (when one repo ships several), `repo`, `tag`, `status` (`planned` ·
`cut` · `published` · `rolled-back`), `cut_on`, `published_on`, `published_to`, the notes as its body —
under the id `<product>/<version>` or `<product>/<package>/<version>`. A change request or an issue
names its `release`, and the release lists them back; a product lists its releases newest first, and
the change-request list shows `release`. `/rnd:release` is three `dt next` answers on a release —
plan, cut (a person's: tagging is publishing, and the rnd-agent stops there), publish, and a stamp
step that resumes the publication's last half while a carried request or issue is unstamped, and a
rollback step that moves what a rolled-back release still carries off it — and a
request in a release is deployed by its publication: `deployed_on` is stamped from `published_on`,
and its live acceptance review never opens before. `dt check` refuses a second release of one product
and version through rnd's own extension entry (`lib/extension.mjs`, named in `compose.json`), which
wraps the composed notebooklm one. Where `@dreamteamer/core` 0.8.0 or later is installed, three
session-bindings on change requests — design, build, review — let the rnd-agent and the qa-manager
claim a request for a stage (`dt session start`); without core they are ignored and rnd compiles
alone. `UPDATING.md` has the commands.

## 0.5.2 — from 0.5.1

A review after every stage of a change request, and every record lists its reviews. `rnd/reviews`
names the request it belongs to (`change_request`), and the request's generated `reviews` lists every
review of its lifecycle; design docs, plans, tests, issues and features list theirs by `subject`. Six
review gates are bound on the request — the design doc, the acceptance lines, the plan, the code, the
proof, the live check — so `dt next` names exactly one verb at every stage, and the rnd-agent stops at
any review it cannot hand to the qa-manager. New marks: `code_approved_on` and `tested_on` on a plan,
`tested_on` on a request; `verified_on` and `implemented` are now the reviewer's. The request's page
declares the lifecycle as a stage map (`display.record.options.stages`). `UPDATING.md` has the
commands for records in flight.

**The R&D module has a page: activity beside counts by status.** rnd ships ten ui-views: `modules-rnd`,
a page view (`display.list.layout: page`) for the module itself (`options.module: rnd`), nesting the
module's activity feed (`modules-rnd-activity`, layout `activity`) beside a column of counts
(`modules-rnd-counts`) — change requests, issues, features, tests, reviews, design docs and
implementation plans, each by status (`rnd-<collection>-by-status`, layout `counts`, `group_by:
status`). An editor that draws module pages opens it when the R&D folder is clicked, scoped to a record
layer's records inside that layer; elsewhere they are ordinary views at their routes. Tasks are not
counted: `tasks` is not rnd's, and the views must check clean where rnd is installed alone.

## 0.5.1 — from 0.5.0

Nothing to do. `change-requests` reads as a list: the descriptor now says `name` is a handful of
words, `description` one line and the body the rest, and its default list shows `created` ·
`status` · `name` · `products`, newest first. `UPDATING.md` (shipped from this version) says how to
bring an existing record to that shape, and why an `acceptance` list of sentence fragments means one
`--acceptance` flag was split on its commas — repeat the flag per entry.

## 0.5.0 — from 0.4.0

Additive. `rnd/user-journeys` gains `steps` (the journey's order, one item per step) and `failures`;
`rnd/user-stories.journey` and `step` are legacy. A workspace that ordered its stories with them runs
`node node_modules/@dreamteamer/rnd/bin/migrate-journey-steps.mjs --dry-run`, then `--write` (add
`--screen-rules <field>` when rule ids sit in a screen field of their own), then
`npx dreamteamer relations rebuild rnd/user-journeys` and `npx dreamteamer check`. The prototype
harness (above) is new.

## 0.4.0 — from 0.3.0

Additive. `software-factory` ships in `data/workflows/` (above) and `workflows` is a declared peer.
Nothing in a workspace changes until the workflow is installed.

## 0.3.0 — from 0.2.0

rnd now composes `wikis` and `notebooklm` (above). A workspace that had `@dreamteamer/wikis` or
`@dreamteamer/notebooklm` installed beside rnd uninstalls them — `npm uninstall @dreamteamer/wikis
@dreamteamer/notebooklm`, then `npx dreamteamer compile` — and keeps its records, folders and
`dreamteamer.harnesses` entry as they are: the collections, the commands and the `dt notebooklm` verb
are the same, delivered from this package. A workspace that pointed at the origin's script by path
(`node_modules/@dreamteamer/wikis/bin/wiki.mjs`) now names `node_modules/@dreamteamer/rnd/bin/wikis-wiki.mjs`;
`npx dt-wiki` and `npx dt-notebook` are unchanged.

**One persona collection.** `rnd/product-user-personas` is folded into `rnd/personas`, which gains a
required `kind` with no default — `panel` (real people, verbatim quotes; `segment_rule` and `members`
are required of it) or `product-role` (a product user role: `key`, `products`, `goals`, `permissions`,
`restrictions`, `evidence_status`; `products` is required of it) — and lists back the `journeys` and
`user_stories` that name it. `rnd/persona-probes` is dropped: the held-out questions a panel was scored
against keep no collection; `fidelity` still says how a panel scored, and the questions live in its body
or beside it. `user-stories.personas` and `user-journeys.personas` now point at `rnd/personas`. Migrate
with `node node_modules/@dreamteamer/rnd/bin/migrate-personas.mjs --dry-run` (the plan, ending in
`records N · refs M`) and then `--write`: it moves every role to `data/rnd/personas/<id>.persona.md`
with `kind: product-role`, stamps `kind: panel` on every persona already there, rewrites
`rnd/product-user-personas/<id>` to `rnd/personas/<id>` in every text file under `data/`, deletes
`data/rnd/persona-probes/` — copy out anything you want to keep first — and reports every
`rnd/persona-probes/…` reference for you to resolve by hand. A role whose id a persona already holds is
a collision the script names and refuses. Then `dt relations rebuild rnd/personas` (a moved role now owns
the generated `journeys` and `user_stories` mirrors) and `dt check`. An overlay of either dropped
collection goes with it.

Additive otherwise. `change-requests` gains `design_docs`, an `implementation_plans` mirror, `accepted_by`,
`accepted_on`, `verified_on` and `deployed_on`; `implementation-plans` gains `change_request`, `issue`,
`verified_on` and a `tests` mirror; `issues` lists its `implementation_plans`; `tests.covers` admits a
plan and `tests.visibility` marks a held-out acceptance test; `reviews` gains `round`, `human_reviewer`
and the kind `acceptance`; `design-docs` lists its `change_requests` and defaults `status` to `draft`. Records compile unchanged.
A paired experiment — one agent walking the lifecycle unattended with `qa-manager` reviews, one without,
on a five-line change request — found that the gate as first written stopped delivery on a tiny ask in
one unattended run, so findings are now scoped to the ask and the stop on a second `changes-requested`
is a record. Three skills are replaced by
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
