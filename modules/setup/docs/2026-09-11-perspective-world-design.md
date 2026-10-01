# perspective/world — the observed world, in the same shape as the real one

**Status:** designed and built 2026-09-11 in one unattended pass. Supersedes the abandoned
`perspective-overlays` branch (`c88a225`, `f500043`), which attempted the same goal by MERGING the
observed collections into the real ones and stopped at 61 test failures.

## the ask

> another major change in extensions perspective — create a world namespace inside perspective,
> extend all world modeling entities: users, projects, activities, tasks — the retrospective models
> the observed world in the same structure that the real world is expressed. it also models the world
> conceptually into classified concepts, pointing to objects from 'the real world' (one way relation
> to any object, soft). refactor as necessary. ensure the entire retro skill and blast radius correct

## the problem, stated once

`modules/projects` and `modules/users` model a world: **users** do **activities** inside **projects**,
and carry **tasks**. `modules/perspective` reconstructs that same world from evidence — and invented
its own nouns for it: `perspective/collaborators`, `perspective/activities`, `perspective/projects`,
`perspective/goals`. Two vocabularies for one world, no `tasks` at all (a ticket was read, counted and
dead-ended), no real `goals` collection to be the other half of the last one, and no way to say "this
observed effort looks like *that* project".

## the shape landed on

A **`perspective/world` namespace** holding the observed world, expressed with the real world's nouns:

| observed | what it is | mirrors |
|---|---|---|
| `perspective/world/users` | a person the evidence shows | `users` |
| `perspective/world/projects` | an effort the evidence shows | `projects` |
| `perspective/world/activities` | a piece of work the evidence shows | `activities` |
| `perspective/world/tasks` | a commitment the evidence shows | `tasks` |
| `perspective/world/goals` | an outcome the evidence shows was pursued | `goals` (new, in `modules/projects`) |

Each carries **`real`** — a one-way, soft reference to the real-world record it appears to be.

## fork 1: parallel objects, not `extends:` overlays — and the branch that measured why

**Agreed with the reading, on three grounds, in ascending order of force.**

1. **The module's loudest rule.** `extends:` merges by collection NAME into the base. A retrospective's
   `activities` record would then be indistinguishable from one a person authored into the plan — and
   the module's own contract is *NOTHING HERE IS AUTHORED TRUTH; every record is what a run FOUND.*
   The distinction cannot survive a merge, because after the merge there is one collection and one
   `status` enum for two different epistemic states (`planned` is authored; `unknown` is observed).

2. **The overlay makes the module non-standalone.** `extends:` needs the base module installed, so
   `perspective` would hard-depend on `projects` and `users`. `c88a225` did exactly that ("the module
   hard-depends on projects"). A retrospective must run in a workspace that owns no plan at all —
   which is the first thing a retrospective is FOR. Parallel + peer keeps `compiles-alone` green with
   nothing else installed.

3. **The id shape, measured.** A merged collection has ONE id shape. The real world keys on
   `{{ name | slug }}` / `{{ code }}`; the observed world keys on `{{ contributor }}/…`, and that
   first segment is the whole reason a second retrospective UPDATES a person's model instead of
   writing a copy beside it (`tests/keying.test.mjs`). `c88a225` hit this head-on: **61 failures, 44 of
   them id-shape**, and its own commit message concludes "merging the collections means deciding what
   a merged id IS, then rewriting every writer."

Parallel objects cost one thing and it is worth naming: **the two worlds can drift.** If `projects`
grows a field, `world/projects` does not. That is accepted deliberately — the observed collection
carries thirty fields the real one never will (`tokens_total`, `correction_ratio`, `lifecycle_stage`),
because measuring is what observing IS. What must not drift is the NOUN SET and the RELATION SPINE,
and those are pinned by `tests/world-model.test.mjs`.

## fork 2: the soft one-way reference — two existing mechanisms, no new keyword

`real` is spelled the same on all five collections:

```yaml
real:
  type: string
  x-reference: projects        # the real collection
  x-reference-soft: true
```

plus the target named in `modules/perspective/package.json` → `dreamteamer.peerDependencies`.

There are **two independent absences** and the engine already has one mechanism for each:

| what is missing | mechanism | what happens |
|---|---|---|
| the whole target COLLECTION (no `projects` module installed) | `peerDependencies` → compile stamps `unresolved_peers` on the descriptor → `check.js` `softTargets` | the ref is counted and reported: `⚠ peer collection "projects" is declared but not installed — N references unresolvable` |
| the target RECORD (the project was deleted) | `x-reference-soft: true` → `ref.js` `refIsSoft` | `check.js`: "resolve if present, ignore if absent" |

Both were read out of the engine rather than invented: `x-reference-soft` exists for
`modules.peer_dependencies`, whose descriptor states the exact case — "a module names the collections
it references but does not own, and the normal state of a module opened on its own is that those
collections are not installed."

**Why soft on the second row too, and not just the first.** The correspondence is a JUDGEMENT a run
made on a date ("this observed effort appears to be that project"), not a link this module maintains.
Hard-validated, deleting a real project would turn a whole workspace's `check` red over a record whose
own fields are innocent — the finding dictating to the real world, which is backwards. So the engine
ignores it and **`bin/check-records.mjs` reports it as a WARNING instead**, which is the right home:
the module's own guard, chained after `dreamteamer check`, already carries every rule the schema
cannot express.

**One-way, always.** No `x-inverse` on any `real`. The module already holds this rule for
`collaborators.contact` and `activities.meetings` — *a peer excuses a REFERENCE, never a MIRROR* —
and here it is also what the operator asked for: the real world must not gain a field pointing at a
finding.

**Why `real` and not `project` / `user` / `task`.** `collaborators.contact` set the precedent of naming
the field after its target, and it is kept. But five collections asking ONE question want one name: a
guard, a view and a reader all have to find it, and `world/activities.activity` reads as nonsense.
`real` is the shortest true word for "the record in the world this is a picture of".

## fork 3: what concepts gain — two fields, because the two halves differ

`perspective/concepts` already had `related_to`, a peer union. It is split in two, because one of the
two target sets is OURS and the other is not, and a single `x-reference-soft: true` over a mixed union
would make the owned half soft as well — losing the dangling-reference check on records this module
writes itself.

| field | targets | hard/soft | mirror |
|---|---|---|---|
| `related_to` | `contacts · companies · meetings · tasks · repos · users · projects · activities · goals` — the REAL world | soft | none (peers) |
| `classifies` | `perspective/world/{users,projects,activities,tasks,goals}` — the OBSERVED world | hard (we own them) | `concepts` on each |

`classifies` is what "models the world conceptually into classified concepts" means as a schema: a
concept already carries `kind` (what sort of thing the term names — `system`, `role`, `process`, …),
and `classifies` is what it names. The mirror is stamped because the fan-in is small and the read is
genuinely useful: a world project's own page answers "what vocabulary is this effort discussed in".

`related_to` gains `users`, `projects`, `activities` and `goals`, and loses `perspective/projects`, which moved.

## fork 4: `started`/`ended` are NOT renamed to `starts`/`ends`

The real `activities` and `projects` spell their dates `starts`/`ends`; the observed ones spell them
`started`/`ended`. **Kept different, on purpose, and the descriptors now say why:** `starts` is a plan,
written ahead; `started` is the first date evidence exists for. Aligning the spelling would assert that
the two mean the same thing when the tense is the one place the difference is visible for free. It
would also change `world/activities`' id template (`{{ started | date }}`), for nothing.

Same reasoning for `collaborators` (the field on `world/activities` and `world/projects`) against the
real world's `seats`: a seat is ALLOCATED by a planner; a collaborator is OBSERVED in the evidence. The
field keeps its name and gains a sibling `lead`, which the real world spells identically because it
means identically the same thing.

## what is retired — nothing, and that is the headline

The three old collections are **renamed into the namespace, not replaced**:

- `perspective/collaborators` → `perspective/world/users`
- `perspective/projects` → `perspective/world/projects`
- `perspective/activities` → `perspective/world/activities`
- `perspective/goals` → `perspective/world/goals`

Every id keeps its exact shape (`<contributor>/<slug>`, `<contributor>/<date>--<slug>`). That is the
whole reason the namespace design was chosen over the overlay: **there is no id migration**, so the
133-of-205 records a model pass or a person authored survive without a re-run.

`perspective/tickets` is NOT subsumed by `world/tasks` and stays exactly as it is. A ticket is
EVIDENCE — a row a reader found, counted and never judged, the same tier as `activity-weeks`. A
`world/tasks` record is the MODEL — what the run concluded was a commitment. The same split
`activity-weeks` ⟷ `activities` already runs on.

Nothing else moves. `topics`, `decisions`, `workflows`, `goals`, `findings`, `insights`, `assumptions`,
`concepts`, `conversations`, `threads`, `deliverables`, `sources`, `questions`, `proposals`, `gates`,
`perspectives` are not world objects — no module models them — and a namespace they do not belong in
would be one more thing to explain.

## what `world/tasks` costs, and what evidence says anyone will use it

It is the one NEW collection, so it owes the leanness questions.

- **Does the engine read it?** No. A module collection.
- **Is this a recipe creeping into core?** No — it is in a module, in a namespace, in one package.
- **Could a module do it instead?** It IS a module.
- **Correctness is not usage — who uses it?** The evidence is already on disk and already dead-ends:
  a measured consumer workspace held **933 ticket records**, every one of them a real commitment with a
  title, an assignee handle, a status and dates, and NOTHING in the module turned them into anything.
  `world/tasks` is written by a **mechanical** script (`bin/derive-tasks.mjs`), not a model pass — one
  record per ticket that a clustered activity already cites — so the first run on that corpus produces
  records rather than an empty collection. That is the usage claim, and it is falsifiable: if a run
  writes zero tasks, the collection was wrong.

## fork 5: `goals` is a real-world collection, and it does NOT fold into `activities`

Amended into this design by the operator mid-build: *"also noted that goals decision (remove gates),
goals all belong in extensions/projects"*. So `modules/projects` gains `goals`, and
`perspective/goals` becomes `perspective/world/goals` like every other world object.

**The precedent it is measured against.** 0.6.0 REMOVED a `gates` collection by folding it into
`activities` as `kind: gate` — "a plan reads as ONE ordered list and splitting it made every question
ask twice". The same test, applied to goals, comes out the other way, on three counts:

1. **A goal has no position in the ordered list.** A gate has a date, a lead, a position in code
   order, and it is drawn on the same gantt as the work either side of it. A goal has no `code`, no
   date it is judged on, and nowhere to sit in a plan. Folding it in puts a row on the gantt that
   belongs at no point on the axis.
2. **A goal is many-to-many with projects; an activity is not.** `activities.project` is a REQUIRED
   SCALAR — a rung belongs to exactly one plan. One goal is served by several projects and one
   project serves several goals. Folding would mean widening the plan's own shape for something that
   is not in the plan.
3. **`done_when` has no counterpart on an activity.** The nearest is `passes_when`, which is
   gate-only and is judged ONCE, on a day, by a named person. A goal's test is judged whenever
   anybody asks.

**The question it answers that activities cannot:** *why is this work being done, and how will we
know it worked* — across several projects, with no date.

The observed half keeps the apparatus that says it is a FINDING (`standing`, `evidence_count`,
`needs_confirmation`, `inferred_from`) and those stay on `world/goals` alone rather than spreading to
every world object. The reason, and it is the fork in this design most open to argument: every other
world object is reconstructed from evidence that NAMES its constituents — a commit exists, a ticket
exists, a handle exists — while a goal is read out of the SHAPE of what was done and nothing in the
evidence ever says "the goal was X". `world/projects` is also called inferred, and the line between
"inferred from records that name it" and "inferred from the shape of the work" is a judgement rather
than a measurement. It is written into the descriptor so the next reader can disagree with it.

Two field renames follow from "same structure": `statement` → **`done_when`** and `horizon` →
**`status`**, the real collection's own words for the same slots. The VALUES of `status` stay
different (`reached` where the real one says `met`), for the same reason `world/tasks.status` has
three where `tasks` has five: `met` is a person's verdict against a test they wrote, `reached` is
what the evidence shows. Same field, same question, different authority — and spelling the field
alike is what makes the difference in the values visible.

⚠ **`perspective/gates` survives, and it is not a plan gate.** The operator's message put gates back
in play, so it was re-examined rather than assumed. It stays, on three differences now written into
its own descriptor so nobody conflates the two again: it is RUN-LAYER, keyed by the run
(`<run>/<gate>`) and never by a contributor, so it is not a world object and never enters
`perspective/world`; its `gate` enum is a closed list of twelve conditions on THIS MODULE'S OWN
PROCEDURE (`activities-named`, `findings-counted`, `interview-minimum`), not on anybody's delivery;
and it has no position in an ordered list, because it is judged at a stage BOUNDARY, which is not a
rung. Nothing folds, in either direction.

## fork 6: `sources` becomes many-to-many with the run — and only `sources`

Also amended in mid-build: *"sources m2m retrospectives"*. `sources.retrospectives` is a list with
its mirror on the run; **both** old scalars retire.

**Why both, rather than keeping one.** `retrospective` ("the run that FIRST wrote this") and
`last_seen_in` ("the most recent run that confirmed it") are a workaround for a many-to-many, and
they fail on the third run: first and last are kept and everything between is lost. The array does
not merely replace them, it makes them derivable — **a run id begins with its own start date**
(`YYYY-MM-DD--<contributor>`), so a sorted `retrospectives` gives first-seen, last-seen and every run
between, from one field. That is derivation from the ID, not from array order, so nothing rests on
insertion order being preserved. Keeping either scalar beside the list would be a fact stored twice,
which the module's own rule says is the next thing to delete.

**Why ONLY sources, and why that is one convention rather than two.** The whole family was examined:
`conversations`, `activity-weeks`, `tickets`, `threads`, `deliverables` and every model collection
carry the same scalar pair. They are not the same RELATION. A source is **durable** — the repo, the
transcripts tree, the mailbox exist independently of any run, and every run re-reads them, so "which
runs saw this" is a real recurring question. Every other record is **produced** by a run: a
conversation is condensed once, an activity reconstructed, a finding concluded. The runs in between
did not *see* those records, they re-derived them — so "which run wrote it" and "which run last
confirmed it" are the two questions anybody asks, and a list would grow unboundedly with every run
for a question nobody has posed. Two cardinalities for two relations is not two conventions; the
descriptors and `tests/run-link.test.mjs` both say so, in place.

Cost, stated: this is a DATA migration on four workspaces, and it is folded into
`migrate-world` — the two scalars become the list, in the order `retrospective` then `last_seen_in`,
which is the order a sorted list would produce anyway. ⚠ Doing it by hand with `dt` would be wrong:
array fields split on commas, so a single flag carrying two refs becomes two elements by accident and
a ref containing a comma splits (measured on 0.21.0). The migration edits the frontmatter directly.

## fork 7: four contributors, one project — four observed worlds, joined by `real`

The run that is actually coming is four retrospectives over one shared engagement: four people in the
same meetings, on the same 52-row plan, in each other's activities. Two readings were possible and
the design picks one explicitly.

**Each contributor gets their own observed record. The REAL record is the join.** Four observed
activities may point at one `activities/a-07`, and that is not duplication — it is four views.

- **A shared world object cannot survive the contributor key**, and the contributor key is
  load-bearing: it is the first segment of every world id and it is what makes a SECOND retrospective
  update a person's model instead of copying it (`tests/keying.test.mjs`). Share the record across
  four runs and four runs write one file — each with a different name, a different date range, a
  different `status` — and the last one silently wins. That is precisely the failure the contributor
  key was introduced to fix, re-introduced along a different axis.
- **The disagreement is the finding.** If three contributors reconstruct the same plan rung with
  different dates or a different status, that is the most interesting output the whole exercise has.
  Merging destroys it before anybody reads it.
- **`real` stays unambiguous under it**, and only under it: the correspondence is MANY-TO-ONE by
  construction — several observed copies, one authored record, and never the reverse. That is also
  why it must not be mirrored: `activities/a-07` would otherwise grow a four-element list of other
  people's findings.
- **The cross-contributor query exists BECAUSE they are separate**: "who else observed this" is
  `dt list perspective/world/activities --filter real=activities/a-07`.

⚠ **And the honest limit: that query only works where `real` is set, which is a person's judgement.**
Without it, four views of one activity are four unrelated records. In a multi-contributor workspace
`real` is the highest-value field in the module, and it is also the one no script may fill.

**On that workspace's evidence, checked rather than assumed.** Its evidence is meetings and
hand-written notes, not repositories. `sources.kind` already admits `meetings` (there is a
`read-meetings` reader, and `world/activities.meetings[]` cites the peer collection directly) and
`obsidian` for a notes tree, so a meeting-shaped source has an honest value and needs no schema
change. **The gap that IS real, and is not papered over:** the 52-row plan of `activities` and gates
was DICTATED by a person — it is not evidence at all, and no reader reads a workspace's own plan.
`init.mjs` reads the workspace's VOCABULARY (its collections and skills) and its decision log, not
its records. So for that run the plan is not re-derived, which is correct, and the payoff of this
whole design is what happens instead: the model pass at `projected` and `clustered` reconstructs what
the MEETINGS show, and `real` points each reconstruction at the dictated rung it appears to be. An
inferred goal that lines up with a declared one is corroboration; one that does not is the most
interesting thing a retrospective can find. No reader is shipped for the plan in this change, and
that absence is a fact about the source rather than about anybody's work.

## the migration table

⚠ **`dt rename collections/<old> <new>` cannot be the instrument here**, and this is not a preference.
`src/schema-ops.js` refuses it outright: *"ships from node_modules — a write there is erased by the
next `npm install`."* A package-shipped collection must be migrated by the package. That is why
`bin/migrate.mjs` exists for the 0.1.x→0.2.0 move, and why this move ships
**`bin/migrate-world.mjs`**, wired as `npx dt-extensions migrate-world`.

| collection | action | ids | suffix on disk |
|---|---|---|---|
| `perspective/collaborators` | **renamed** → `perspective/world/users` | unchanged | `.collaborator.md` → `.user.md` |
| `perspective/projects` | **renamed** → `perspective/world/projects` | unchanged | `.project.md` unchanged |
| `perspective/activities` | **renamed** → `perspective/world/activities` | unchanged | `.activity.md` unchanged |
| `perspective/goals` | **renamed** → `perspective/world/goals`, and TWO FIELDS renamed with it: `statement` → `done_when`, `horizon` → `status` | unchanged | `.goal.md` unchanged |
| `perspective/sources` | **reshaped in place** — `retrospective` + `last_seen_in` fold into the list `retrospectives`, in that order | unchanged | unchanged |
| `perspective/world/tasks` | **new** | — | no records exist anywhere |
| `goals` (real, `modules/projects`) | **new** | — | ⚠ collides with a workspace that owns its own `goals` — see below |
| `perspective/concepts` | **reshaped in place** — `related_to` retargeted, `classifies` added | unchanged | unchanged |
| `perspective/{activities,projects,decisions,goals,workflows,perspectives,tickets}` | **reshaped in place** — reference TARGETS repointed; the migration rewrites the VALUES | unchanged | unchanged |
| every other perspective collection | **left alone** | | |

**What a consumer runs, in order:**

```bash
git status --porcelain                      # must be clean — the migration refuses a dirty tree
npm install @dreamteamer/extensions@latest
npx dt-extensions migrate-world --dry-run   # the plan: files moved, refs rewritten, per collection
npx dt-extensions migrate-world             # does it, then runs compile + check itself
npx dreamteamer check                       # and read THAT, not the migration's own summary
node node_modules/@dreamteamer/extensions/modules/perspective/bin/check-records.mjs
```

A workspace with no perspective records runs nothing: `migrate-world` exits 0 saying so. A workspace
still on 0.1.x runs `npx dt-extensions migrate` ALONE — it folds both moves, because the intermediate
state (records under `data/perspective/activities`, which no collection claims any more) fails the
`dreamteamer check` that migration ends by running.

⚠ **A CONSUMER THAT ALREADY OWNS A `goals` COLLECTION.** Two modules cannot own one collection name,
so `projects` shipping `goals` is a compile error in a workspace whose own module declares one.
Compile names the collision; it does not choose. Three ways out, and the consumer picks:

| if their `goals` is… | do |
|---|---|
| the same concept, differently shaped | `extends: goals` in their own descriptor — keep only the fields they added, and the base's `done_when` becomes required on their records |
| a different concept | `dt rename collections/goals <new-name>` — the engine's own rename, which carries the records and rewrites every inbound reference in one write. Theirs is a workspace-module collection, so this verb WORKS (it refuses only a package-shipped one) |
| not wanted at all | `"dreamteamer": { "disable": ["projects/goals"] }` |

**What the migration actually does**, and nothing else: moves three record directories, re-suffixes
the `collaborators` files, and rewrites three reference prefixes in every record's frontmatter AND
body across the whole `data/` tree. It renames no field, drops no field and touches no id — which is
why it is 200 lines rather than `migrate.mjs`'s 600.

**Why re-running the retrospective is still the wrong instrument**, restated from `f500043` because it
binds here too: a consumer counted 205 records by writer — 72 were script output and come back, 133
were a model pass or rows a person dictated and do NOT. A re-run destroys more than it rebuilds, at
the cost of the original run. The reason it does not matter this time is that **nothing needs
re-deriving**: no id changes, so `dt`'s own reference-carrying rename is not needed either.

## the thirteen stages — none disappears

| stage | before | after |
|---|---|---|
| 3 `read` | writes `collaborators` | writes `world/users` |
| 4 `clustered` | writes `activities`, `topics` | writes `world/activities`, `topics`, **`world/tasks`** |
| 5 `projected` | writes `projects` | writes `world/projects` |
| 7 `inferred` | writes `goals` | writes `world/goals` |

Stage 4 gains one script, run after `attach-evidence.mjs` and before `rollup-metrics.mjs`:

```
node $SK/bin/derive-tasks.mjs --retrospective <ref> [--dry-run]
```

It is **mechanical**, per the skill's rule 5 (*mechanical beats judged*): for every ticket of this
contributor it writes one `world/tasks` record — name from `title`, status mapped from the ticket's
own, `assignee` from the ticket's already-matched `assignee`, and `activity`/`project` joined from
whichever clustered activity cites that ticket. Nothing is judged, so nothing can be invented.

## blast radius

Everything named here was walked; `npm test` is the gate.

- `modules/perspective/package.json` — `namespaces` gains `perspective/world`; `peerDependencies`
  gains `users`, `projects`, `activities`, `goals` (`tasks` was already there); the 13-stage
  description re-spells the moved collections, names `world/tasks`, and states the world namespace's
  contract.
- **five** descriptors under `collections/perspective/world/` — four moved (`activities`, `projects`,
  `collaborators`→`users`, `goals`) and one new (`tasks`). `compile` enumerates `collections/`
  RECURSIVELY, so a namespaced descriptor is supported and `schema-ops` derives the nested path from
  the name.
- `modules/projects/collections/goals.collection.yaml` — the real-world collection, NEW.
- twelve sibling descriptors re-point their `x-reference`s; `concepts` gains `classifies` and
  retargets `related_to`; `sources` becomes m2m and `retrospective-sessions` declares the mirror;
  `gates` states what it is not.
- `skills/running-retrospectives/SKILL.md` — a new core rule (the world namespace and the
  four-contributor case), the stage table, the clustering brief, the identity section, the
  what-NOT-to-do table.
- `commands/run-retrospective.command.md` — the several-contributors paragraph.
- `bin/check-records.mjs` — collection resolution becomes longest-prefix (a two-segment name broke
  `path.relative(root, file).split('/')[0]`, which silently switched off every guard on the world
  collections), the peer table gains the five real collections, and the `real` guard is new.
- `skills/running-retrospectives/bin/derive-tasks.mjs` — NEW; `lib/records.mjs` gains `writeSource`;
  thirteen source writers and ~fifteen scripts re-pointed.
- five `ui-views`, plus two stale `activities_count` templates fixed in passing (deleted in 0.2.0,
  still named in `timeline` and `timeline-decisions`, rendering an empty token that reads as data).
- `bin/migrate-world.mjs` NEW + `bin/migrate.mjs` (folds the world move for a 0.1.x consumer) +
  `bin/extensions.mjs` (the verb) + `README.md` + `CHANGELOG.md`.
- tests: `stage-model`, `keying`, `run-link`, `contributor-and-identity`, `relations`, `nav-order`,
  `view-columns`, `migrate`, `check-records`, `idempotency` and twelve script suites; plus new
  `tests/world-model.test.mjs`, `tests/migrate-world.test.mjs` and
  `skills/running-retrospectives/tests/derive-tasks.test.mjs`. `icons`, `modules-structure`,
  `compiles-alone`, `leak-gate` and `skill-flags` needed no change and are what proves the boundary.

**`.github/workflows/{ci,release}.yml` need no change — checked, not assumed.** Their hard-coded
roster is `assets contacts projects meetings recordings perspective`, and the MODULE SET is
unchanged: this release moves collections inside one module, adds one collection to another, and
adds no module.

## what the first real consumer found — three defects, none visible to a fixture

The branch was run against a live workspace on 2026-09-11 (`✔ 0 violations (464 records across 63
collections)`; the world namespace came up with 12 users, 9 activities, 1 project, 4 goals, 1 task).
All three defects below were found by RUNNING it, and each is now a test.

**1. The migration swept records and ignored the consumer's own SOURCES.** The workspace shipped its
own overlay carrying `extends: perspective/perspective/activities`, and a ui-view carrying
`collection: collections/perspective/activities`. Neither is a record, so nothing swept them — and
after the rename `compile` hard-fails with *"every descriptor declares 'extends' — no base found"*, a
message naming a compile internal rather than the file anybody has to edit. **The workspace was
bricked until a human found the file by reading the wrong error.**

`scanSources` now walks the workspace's own source tree (`modules/`, plus the flat source kinds at
the root; never `node_modules`, `git_modules` or `data`) for any `perspective/<moved>` not followed
by another name character — which matches a bare `extends:` target, a `collection:` line and a full
record reference alike, and never matches `perspective/activity-weeks`. It runs inside `plan()`,
which is the first thing `main()` does and the whole of what `--dry-run` does, **because a check that
runs after the first compile never gets to print.**

⚠ **It REFUSES by default rather than rewriting, and that is the deliberate fork.** These are the
consumer's OWN authored sources, not records. In the real case BOTH files turned out to be obsolete
for independent reasons — discovered only by reading them — and a migration that silently retargeted
them would have carried two dead files forward and said nothing. So the default prints the file, the
line and the exact edit; `--rewrite-sources` applies precisely those edits once you have looked.

⚠ **The scan needs no knowledge of which module belongs to whom**, and that is what makes it
self-correcting: it looks for the OLD names, and after the upgrade only an un-migrated consumer file
still carries one. Running it against this package found six of its own — two icon comments that were
simple renames, and **four in `rnd` that pointed a PLAN at `perspective/projects`**, which since 0.6.0
is wrong for its own reason: a plan lives in the real `projects`, and `perspective/world/projects` is
what a retrospective RECONSTRUCTED. Retargeted, not renamed. The scan earned its place before it ever
reached a consumer.

**2. `check-records.mjs` reported success while checking nothing.** Run from the workspace root with
the module linked for preview, it printed `✔ perspective records: 0 checked, 0 violations` and exited
0 over a workspace holding **173** of them. The default data root came from `lib/vault.mjs`'s `VAULT`,
which walks up from the SCRIPT — and under preview the module lives outside the workspace, so the
walk found the PACKAGE's own root and looked in a tree that has no records by design.

This is the worst failure this repo can ship, because it is byte-identical to a pass — and it is
exactly what the module's own `gates` descriptor refuses: *"a verdict without a measurement is
success being reported instead of a result being quoted."* It now resolves from the CURRENT
DIRECTORY (with the same `git_modules/` skip `lib/vault.mjs` carries, for the same measured reason),
and **refuses with exit 2 when no workspace is found** rather than reporting a clean zero. There is
deliberately NO script-relative fallback: that fallback WAS the defect, and a fallback that can
silently answer the wrong question is worse than an error. ⚠ `0 checked` stays legal for a genuinely
empty workspace — the refusal keys on "no workspace root", never on "no records", or it would refuse
every fresh install.

**3. The relation declared on both sides was warning in every consumer's compile, forever.** The
first draft called this tolerated precedent because `rnd/prototypes.design_doc` did the same. That
was wrong, and the reason is not the two lines: **a permanent warning teaches people to skim the
warning block, which is how the next real one goes unread.** Both are now spelling B — `x-inverse-of`
on the target only, which compile rewrites onto the owner and which keeps the mirror visible in the
descriptor a reader actually opens. A full consumer compile now emits **zero** of them.

⚠ Nothing else in the package could see this: `compiles-alone` asserts no `✖` and no `/error/i`, and a
warning is neither. `tests/modules-structure.test.mjs` now walks every descriptor in every module and
fails if any `x-inverse-of` names an owner that also declares `x-inverse`. ⚠ Its first draft read
only the `items` node and passed over an `x-inverse` authored one level up — which is precisely how
both warnings got in — so it reads BOTH nodes, the way compile's own hoist does.

## what a reviewer should distrust

- `world/tasks` has never been run against a real ticket corpus. The script has a fixture; the claim
  that 933 tickets yield 933 tasks is arithmetic, not a measurement.
- It HAS now been run against a live consumer (see the section above) and against a full engine walk
  here, including an overlay and a ui-view. What has still never happened is a second contributor's
  run over the same shared plan — the four-contributor case in fork 7 is argued, not measured.
- The `world/goals` apparatus argument (§ fork 5) draws a line between "inferred from records that
  name it" and "inferred from the shape of the work". That line is a judgement. If it does not hold,
  `standing` and `evidence_count` belong on every world object, and the descriptor says so.
- `classifies` mirrors onto four collections at once through a union `x-inverse`. `compiles-alone`
  proves the engine stamps it; nobody has looked at the resulting field in a UI.
