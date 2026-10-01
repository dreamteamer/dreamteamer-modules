# changelog

## unreleased

**Engine 0.31.0 spellings.** The lean core moved two things this package names out of the engine.

- **`notebook restore` runs an `export` source as `npx dreamteamer notebooklm …`**, not
  `… export notebooklm …`. The verb and the `notebooklm` harness (`NOTEBOOKLM.md`) now come from
  the `@dreamteamer/notebooklm` extension: `npm i -D @dreamteamer/notebooklm` in the workspace before
  restoring a record with an `export` source. The notebooks README, the `using-notebooklm` skill and
  the `notebooks` descriptor say so.
- **The `hq` image comments name `dt-host start container … --template hq`** and `dt-host list
  images`: the container verbs are the standalone `@dreamteamer/host` binary now.
- The structure gate's core set is the engine's nine collections: `worktrees` and `proofs` are gone
  from core, and `proofs/` is no longer a source kind a module may carry without
  `@dreamteamer/workflows`.

## 0.12.0 — 2026-09-13

**One word meant two things, twice — and both cost a consumer something real.** Requires engine
**>=0.25.0**, which is what makes the second half expressible at all.

⚠ **BREAKING, and both halves ship a migration or a guarantee. Read before upgrading.**

- **`rnd/projects` is DELETED, folded into `rnd/products`.** This pack shipped TWO collections that
  both meant "a project" — the plan module's `projects` (phases, gates, seats, risks, decisions) and
  R&D's `rnd/projects` (a bounded initiative delivering products). A name collision across two
  modules of one pack is the shape that leaves a workspace permanently stale, and one consumer had
  already diverged on its own to resolve it. Settled the smaller way: **a product IS the effort, and
  the plan that delivers it is `projects`.** `company` and `media_folder` moved onto `rnd/products`
  because they had nowhere else to go; `rnd/products.project` and `rnd/research-docs.project` now
  point at `projects` as a **peer, with no mirror** — a mirror would write a field into a module
  `rnd` does not own — and `rnd` declares the peer, so it stays installable without the plan module.
  **A workspace WITHOUT the plan module now has nowhere to put a plan**: `plan` stays empty and a
  design doc is done at the prototype. That is stated in `building-from-references` rather than left
  to be discovered.
  ⚠ **If you hold `rnd/projects` records, do not take this release until you have somewhere to put
  them.** There is no migration, deliberately: where they go depends on whether you install the plan
  module, and a script cannot decide that for you.

- **`code` becomes `slug` on `tasks`, `decisions`, `goals` and `deliverables`, and becomes
  OPTIONAL.** The same field name meant two different things. `activities.code` (`a-01`) and
  `risks.code` (`rk-01`) are identifiers a room says out loud and reads in ORDER — they are codes,
  they stay required, and they are untouched. On the other four the field existed for exactly one
  reason: a name in any script has to produce a readable, typeable id, because the engine's `slug`
  filter returns a hash when a value has no latin characters in it. That is a slug. Calling it a
  code made a workaround look like a domain concept — and made it REQUIRED on every record of four
  collections, which is what 0.11.0 did and what a consumer with 141 existing tasks then had to
  price.
  It is optional again because engine 0.25.0 let `id.generate` take an **ordered list**: the slug
  when a record carries one, the name otherwise. Before that a missing field threw before any
  fallback could run, so forcing the field was the only way to guarantee a latin id.
  **`npx dt-extensions migrate-code-to-slug`** renames the key on every affected record.
  ⚠ **IDS DO NOT CHANGE** — the new template renders the same value from the same field, so not one
  reference anywhere needs rewriting. That is why this is a key rename and not a `dt rename` sweep.
  Run it BEFORE `dreamteamer check`: the moment the descriptor drops `code`, a record still carrying
  that key fails validation as an unknown field, hard. The migration refuses to run if it finds
  `activities` or `risks` already stripped of their codes, rather than half-migrating a tree it does
  not understand.

## 0.11.0 — 2026-09-12

**The plan learns what can go wrong, who is not human, and how to survive a non-Latin name.**
Carried back from a consuming workspace that ran a live client engagement on these modules for a
week — every change below was paid for there first.

- **`risks` (projects):** a named exposure with an owner, evidence, likelihood/impact — where
  `unassessed` is a VALUE ("the sources do not support a number"), not a blank — documented
  mitigation, and a `gate` whose pass is the only road to `closed`. The founding register had 29
  rows in a note: unqueryable, unlinkable, ownerless.
- **agents are users (users):** `kind: human|agent` and a required `human_owner` — the babysitter.
  An agent holds seats and leads like anyone; an unowned agent, or an agent owning an agent, is
  refused by the guard. The plan tracks the work, not the species; gates stay human-judged.
- **the slugOrHash fix, everywhere ids meet Hebrew:** `perspective/terms` are keyed by a latin
  `key` (22 of 35 terms hashed to `x000w6xq` on the first real write), and `code` drives the id on
  `decisions`, `goals`, `deliverables` and `tasks` (`tasks.code` is now REQUIRED — the one breaking
  change, and the CI smoke follows it).
- **`decisions.external_decider`:** the client's calls are often the most consequential on an
  engagement, and `decider` (users) could not hold them. A `contacts` reference, no mirror.
- **`rnd/screens`:** one page of a product as a record — route, `source`
  (reference-observed | scope-required | both), states, `build_status`, the reference frame behind
  every claim. **`rnd/user-stories`** gain `key`, `screen`, `journey` + `step` (a journey is the
  stories in step order, deliberately not a collection) and a direct `product` link.
- **perspective `init` no longer crashes after writing:** the generated back-link it tried to set
  is generated; the refused write left runs half-done with a stack trace.


## 0.10.0 — 2026-09-12

**A `search` module, and an effort ladder whose every rung was measured before it was built.**
`npx dt-extensions find <question>` and a `/find` command. Where `wiki ask` searches ONE assembled
corpus of prose, this searches the workspace's own RECORDS — different in the one way that matters:
records carry references, so a question about them is often a question about the graph rather than
about the prose. That is why rung 3 exists here and nowhere else.

Measured over a 300-document corpus, with questions worded the way an asker phrases them BEFORE
knowing the corpus's vocabulary, plus a control fixture worded in the corpus's own words:

| rung | | recall / MRR | cost |
|---|---|---|---|
| 0 | lexical | 0.22 on paraphrase · **MRR 1.00 on a known phrase** | **9 ms** |
| 1 | vector | 0.80, best MRR (0.62) and recall@1 (0.48) of any single backend | ~300 ms |
| 2 | structured, one call | recovers BOTH questions scoring 0.00 on every single-shot backend | ~1 model load |
| 3 | + graph | **4 of 4 where retrieval tops out at 3 of 4** | **+0.347 s** |

⚠ **RUNG 0 IS NOT A FALLBACK.** On a question asked in the corpus's own words, lexical scores MRR 1.00
in 9 ms and the full re-ranked pipeline scores the same in ~22,900 ms — **2,500× for an identical
rank-1 answer** — and vector alone is WORSE there (0.81), because embeddings blur a literal string
FTS5 matches exactly. When you know the phrase, reaching for retrieval is a pure loss.

⚠ **RUNG 2 IS A HEDGE, NOT A SMARTER QUERY**, and the ablation is why. The two questions no backend
answers fail for OPPOSITE reasons and are rescued by OPPOSITE lanes: a vocabulary gap goes lex 1 /
vec 3, an abstraction gap goes lex MISS / vec 1. Neither lane wins both, and the asker cannot tell
which they have — not knowing the corpus's words is WHY they are asking. So `--lex`, `--vec` and
`--hyde` go in ONE invocation, which is what makes hedging affordable when cost is dominated by
per-invocation model load. The caller writes the lanes: only someone who knows the domain can.

⚠ **RUNG 3 IS A ROUTE, NOT A RANK.** For a question whose answer set is defined by a REFERENCE
("what's broken in X"), retrieval returned 1 of 4 plain and 3 of 4 structured **with ten slots
available for four answers**, and could not close it at any rung — the fourth record is not less
similar by mistake, it is a different thing that shares a parent. Similarity is the wrong relation, so
the ladder stops ranking and asks the graph. The expansion key is DERIVED from the hits agreeing on
it, never known in advance, and it **refuses rather than expanding through a weak plurality**: a
confident set built on one coincidence is worse than no set, because it looks like an answer.

**No command-binding, deliberately.** A binding gates a slash command on a RECORD's field state so
`dt next` can answer "what is the next move on this one". Search is not record-scoped, so a binding
would be a gate nothing could ever open.

**`qmd` stays OPTIONAL.** Without it rung 0 still works and the rest report unavailable — the doctor
warns, nothing fails.

**Nothing here synthesises.** Every rung prints `file:line` LOCATIONS, because a paraphrase is what
makes an answer uncheckable — the failure the citation was the fix for.

⚠ **One defect found by walking the live flow with every unit test green.** The expansion took its
collection from the FIRST hit, which was a document carrying no reference field — so it filtered the
wrong collection, the engine exited non-zero, and the rung reported "the hits agree on no reference":
**a refusal that reads as principled and is a bug.** `collectionOfAgreeing` now takes it from the
records that CARRY the agreed reference, with a regression test that goes red against the old
behaviour in three places.

**The CI roster now asserts this module ships**, and that assertion was verified before it was
written: it was an open question whether a module with NO collections appears in `dt status` at all,
and asserting it blind would have gone red at release. Walked in a throwaway workspace — `dt status`
lists it, the command and skill are injected, and the module is described in **all four harnesses**
(CLAUDE.md, AGENTS.md, GEMINI.md, `.cursor/rules`) from the descriptor alone.

## 0.9.0 — 2026-09-11

**`projects` grows `decisions`, `deliverables` and `phases`, and the observed world grows with them.**
A decision folds the agent's own log and observed human decisions into ONE table with `decided_by`
marking which — because "who decided" is the question that makes the two worth storing together, and a
separate table per author would answer it by filename. `phases` deliberately has no `order`: `starts`
IS the order, and a second one would let them disagree. `deliverables` splits `delivered` from
`accepted` as two states, with `accepted_by` pointing at `contacts` — acceptance is the receiving
side's act. The observed halves sit under `perspective/world` in the same shapes, and
`world/decisions.decided_by` carries the extra value `unknown`, which is exactly the difference in
authority between a thing you were told and a thing you inferred.

**A wiki lives in the repo now — a corpus is source, and it is versioned like source.** `wikis/<id>/`
holds markdown only, every file with frontmatter, `index.md` at the root (the old `wiki.yaml` manifest
is gone). That is what makes a `<file>:<line>` citation reviewable in a diff and openable from a bare
clone. ⚠ The exception is narrow and holds: scraped PDFs, recordings and scans stay under
`${env:FILES_FOLDER}`, and a source links to its original only when restoring it would cost real
effort. The cost is stated rather than discovered — a corpus is megabytes of text in every clone,
forever, so split a large one by subject rather than growing one.

**`qmd` is OPTIONAL, and an earlier claim in this repo is withdrawn.** A commit in this cycle made it a
hard prerequisite of the notebooks capability on a comparison that was not fair — one single-shot
lexical query against a full hybrid pipeline, written up as "grep cannot find it". Run the way an agent
actually greps, the same passage comes back in three informed passes. `wiki search` is grep and needs
nothing installed; `wiki ask` needs `qmd` and the doctor WARNS rather than failing. Measured over 300
markdown records, 15 questions worded the way an asker phrases them before knowing the corpus's
vocabulary: lexical recall 0.22, vector 0.80, hybrid 0.72, full re-rank 0.85. Real gap, still not a
prerequisite.

⚠ **And the test shape that hid it, which is the part worth carrying.** The prerequisite commit added a
test asserting a missing `qmd` is `bad`, contradicting one already in the file asserting no notebooks
check may be. Both were green: the new assertion sat behind `if (c.state !== 'ok')`, and on a machine
with `qmd` installed that is false, so it never ran. CI has no `qmd` and went red. **A conditional
around an assertion is a test that reports on the machine, not on the code.** The replacement forces
the absent case by editing `PATH` inside the test, so it asserts unconditionally — verified green with
`qmd` present and absent, and red in both when mutated back.

**Also:** the `notebooks` module description carried a corrupted duplicated fragment that rendered into
every consumer's CLAUDE.md, and three places still said `wiki.yaml`. Both fixed.



**`activity-lanes` — the bands a plan is read in, as a record rather than a second free-text field.**
A lane is the swimlane a board draws and the row-group a gantt stacks by; `activities.lane` points at
it and the lane gains the rungs in it. ⚠ **The whole argument is ORDER, and it is the only thing that
survived the `gates` test.** `gates` was deleted as a collection the day before and folded into
`kind: gate`, because a gate is the same KIND of object as an activity — a rung, in the list. A lane
is not a rung; it is the axis the list is read on, and a board draws its bands top to bottom while a
free-text `phase` has no order but its own spelling (Discovery → Build → Hardening → Launch bands as
Build · Discovery · Hardening · Launch). The number is a property of the BAND, and with many
activities per band the only place it can live without being restated on every row is a record. So
`order` is REQUIRED — an unordered lane would be `phase` with extra ceremony.

**Five authored fields, and the refusals are asserted by name.** `name`, `order`, `project`, `tags`,
`content`, plus the provenance quad. No `color` (the gantt already colours by `status`, and a second
colouring authority fights the first), no `lead` (a third answer to "who owns this", beside
`activities.lead` and `projects.lead`), no `status` (the work in a band completes; the band does
not), no `code` (the id is the handle). `tests/plan-model.test.mjs` fails if one comes back.

**`project` is OPTIONAL, and empty IS the cross-project workstream** — the second thing a field on
the activity cannot express, since an activity has exactly one project. The price is a flat id
(`{{ name | slug }}`), because the engine's id generator throws on a missing field and an optional
field therefore cannot be an id segment: lane names are unique across the workspace, and two plans
that both want "Discovery" either share one band or name them apart.

**`phase` stays, as the OTHER axis.** `lane` is which TRACK, `phase` is WHEN. Both used as the
grouping axis is what gives a plan two disagreeing ways to band, so the descriptions now split the
job and a workspace using `phase` as a swimlane should move those values into lanes. Nothing is
deleted — consumers hold records that set `phase`, and retiring a field is a migration.

**One rule the schema cannot express, in `modules/projects/bin/check-records.mjs`:** a rung may not
sit in a band belonging to another plan. Both fields are typed and both resolve, so `dreamteamer
check` reports zero violations while the board draws this plan's rung inside somebody else's
swimlane. A lane with no `project` matches everything, by design.

**`perspective/world/activity-lanes` is the observed half**, written by the `projected` stage —
stage 5, not stage 4: a band cannot be named until the activities that reveal it exist, and
`projected` is already the stage that writes a structure OVER activities and then fills a field on
each one. `order` is OPTIONAL there and required on the real collection, which is the same
distinction the layer already draws with `starts`/`started`: a planner DECIDES an order, a run READS
one, and a run that cannot tell leaves it empty rather than inventing a number.

⚠ **The layer rule is now pinned GENERALLY, over every collection in `perspective/world`.**
`tests/world-model.test.mjs` walks every field of every collection in the namespace and refuses any
reference to a real-world noun except `real` — legal targets are `perspective/…`, or a peer the
observed world has no half of (`companies`, `contacts`, `meetings`, `repos`) — and asserts each world
collection crosses through exactly `['real']`. It was asserted per field before, which is why
`world/activities.lane` could have pointed at `activity-lanes` and compiled clean. The next
collection added to that namespace cannot get it wrong quietly.

**`/plan/by-lane`** is the swimlane board, banded by `lane` with the unlaned rungs shown as the
residue. `/plan/gantt` still bands by `phase`, so a plan that never grew lanes keeps the view it had.

**Migration: none.** No consumer holds a lane record, nothing is renamed and no id changes, so
`bin/migrate-world.mjs` is untouched and needs no run. A consumer runs `npm install` and
`npm run compile`, and nothing else. Presentation only: the `projects` nav shifted `activities` 9→10
and `goals` 10→11 so `activity-lanes` sits at 9, between `projects` and `activities`.

**Two stale lines fixed in passing.** The `running-retrospectives` skill labelled its clustering pass
"stage 5" and its role pass "stage 10" — off by one against its own numbered table since the model
grew from twelve stages to thirteen, and the first of those now collided with the stage that writes
lanes. And `modules/projects/README.md` still claimed there is no `teams` collection; it came back on
2026-09-10 and the paragraph never followed.


## 0.8.0 — 2026-09-11

⚠ **This release shipped without a changelog heading and the entries below sat under
`unreleased` until 0.9.0 was cut.** They are 0.8.0's, restored to their own section rather than
left to look like part of the next release.

**The observed world moves into a namespace of its own, `perspective/world`, and is expressed in the
real world's nouns.** `world/users` · `world/projects` · `world/activities` · `world/tasks` ·
`world/goals` mirror the shapes `users` and `projects` ship. `perspective/collaborators`,
`perspective/activities`, `perspective/projects` and `perspective/goals` are the first four,
renamed; `world/tasks` is new.

⚠ **They are PARALLEL objects, never `extends:` overlays, and the reason is the module's loudest
rule.** An overlay merges by collection NAME, which would make a record a retrospective FOUND
indistinguishable from one a person WROTE — and nothing in perspective is authored truth. The two
cannot even share an id shape: the real world keys on a name slug, the observed world on
`<contributor>/<slug>`, and that first segment is what makes a second retrospective UPDATE a person's
model instead of copying it. An earlier attempt merged them and stopped at 61 failures, 44 of them
id-shape. Parallel also keeps the module standalone — it declares no hard dependency, so a
retrospective still runs in a workspace that owns no plan at all.

**Each observed object carries `real` — a ONE-WAY, SOFT reference to the record it appears to be.**
One-way (no `x-inverse`) because the real world must never gain a field pointing at a finding. Soft
in two senses, with one existing engine mechanism each and no new keyword: the target COLLECTION may
not be installed (a declared peer, so compile stamps `unresolved_peers` and `check` reports the
count), and the target RECORD may be gone (`x-reference-soft`, the keyword the engine's own
`modules.peer_dependencies` carries). ⚠ `real` is a PROPOSAL a person confirms, exactly like
`contact`: no script and no model pass ever sets it, and `bin/check-records.mjs` reports a `real`
that resolves to nothing as a warning — soft must not mean silent.

**Several contributors on one project get several observed copies of the same real thing, on
purpose.** The world objects are contributor-keyed, so four runs over one shared plan produce four
views rather than one merged record; a shared record would mean four runs writing one file and the
last one silently winning. Where two views disagree, the disagreement is the finding. `real` is what
joins them — "who else observed this" is a filter on it.

**`concepts` classifies both worlds, in two fields.** `classifies` points at the observed world
(ours, so hard, and mirrored as `concepts` on each world collection); `related_to` points at the real
one (peers, so soft, and never mirrored). Two fields rather than one union because a single soft
union would have given up the dangling-reference check on records this module writes itself.

**`goals` becomes a real-world collection in the `projects` module.** A goal is a thing the real
world has — an outcome somebody is trying to make true, with `done_when`, the observable test that
says it happened. It earns its own collection rather than folding into `activities` the way `gates`
did in 0.6.0, on three counts: it has no position in the ordered plan and no date it is judged on;
it is many-to-many with projects where an activity's `project` is a required scalar; and `done_when`
has no counterpart on an activity (`passes_when` is gate-only and is judged once, on a day, by a
named person). `perspective/world/goals` is its observed half, and spells `done_when` and `status`
the way the real collection does — they were `statement` and `horizon`.

**`perspective/gates` stays exactly where it is, and its descriptor now says why it is not a plan
gate.** It records whether a RETROSPECTIVE stage boundary was met, with the measurement behind the
verdict: run-layer, keyed by the run, over a closed list of twelve conditions on this module's own
procedure. Nothing folds, in either direction.

**`perspective/sources` becomes MANY-TO-MANY with the run.** `retrospectives` is a list; the scalar
`retrospective` and its companion `last_seen_in` are both gone. A source is DURABLE — the repo, the
transcripts tree, the mailbox exist independently of any run and every run re-reads them — so the
first/last pair lost every run in between from the third run onward. Nothing is lost by the change:
a run id begins with its own start date, so a sorted list gives first, last and everything between
from one field. ⚠ **Only `sources` changes.** Every other contributor-keyed record is PRODUCED by a
run rather than seen by it, so first-and-last is the honest shape there and stays.

**`check-records.mjs` no longer reports success while checking nothing.** Run from a workspace root
with the module linked for preview, it printed `✔ perspective records: 0 checked, 0 violations` and
exited 0 over a workspace holding 173 of them — the data root resolved from the SCRIPT, which under
preview lives outside the workspace. It resolves from the CURRENT DIRECTORY now, and **refuses with
exit 2 when there is no workspace there** rather than reporting a clean zero. `0 checked` stays legal
for a genuinely empty workspace: the refusal keys on "no workspace root", never on "no records".

**Two relations were declared on both sides, warning on every compile in every consumer.**
`perspective/sources.retrospectives` and `rnd/prototypes.design_doc` now declare the mirror on the
target only (`x-inverse-of`), which compiles identically and emits nothing. A permanent warning
teaches people to skim the warning block, which is how the next real one goes unread;
`tests/modules-structure.test.mjs` is the gate that keeps it out.

**Stage 4 gains one mechanical script, `derive-tasks.mjs`** — one `world/tasks` record per ticket a
clustered activity cites, joined through the activity and never through a date. A measured consumer
workspace held 933 ticket records that nothing in the module ever turned into anything.

### migrating

```bash
git status --porcelain                      # must be clean — it refuses a dirty tree
npm install @dreamteamer/extensions@latest
npx dt-extensions migrate-world --dry-run   # ⚠ BEFORE you compile — see below
npx dt-extensions migrate-world             # then compile + check, and READ those
```

⚠ **Run it before the first compile, because your OWN sources may name a moved collection.** An
overlay's `extends:`, a view's `collection:` — these are not records, so the record migration does
not sweep them, and `compile` fails on them afterwards with *"every descriptor declares 'extends' —
no base found"*, which names a compile internal rather than the file to edit. (Measured: it bricked
the first real consumer.) `migrate-world` now checks for exactly this before touching anything and
prints the file, the line and the exact edit; `--rewrite-sources` applies them. It refuses rather
than rewriting by default because in that real case both files were obsolete for their own reasons,
and only reading them said so.

⚠ **No id changes.** Only the folder, one suffix (`.collaborator.md` → `.user.md`), four field names
and every reference to a moved collection. That is deliberate and it is why the namespace was chosen
over the overlay: a consumer counted its 205 perspective records by writer and found 133 of them
were a model pass or rows a person dictated, which a re-run destroys rather than rebuilds. Nothing
here is re-derived.

A workspace still on 0.1.x runs `npx dt-extensions migrate` ALONE — it folds both moves, because the
intermediate state fails the `check` it ends by running.

⚠ **A workspace with its own `goals` collection in its workspace module** now collides with the one
`projects` ships: two modules cannot own one collection name. Three ways out — rename yours
(`dt rename collections/goals <new>`, which carries the records), turn the shipped one off
(`"dreamteamer": { "disable": ["projects/goals"] }`), or make yours an overlay (`extends: goals`) and
keep only the fields you added. Compile names the collision; it does not choose for you.

## 0.7.0 — 2026-09-11

**`users` becomes its own module, so it renders at the ROOT of the nav.** Every owner, lead, seat,
assignee and attendee field in every other module points at it, so it belongs to nobody and must not
sit inside anybody folder. Nothing renames: the collection is still `users`, its records still live
in `data/users/`, and every reference is unchanged — only the module that ships it moved.

⚠ **Why a module split and not a namespace.** The extension folds a default-namespace collection under
its owning module only when that module owns TWO OR MORE of them (a folder of one costs a click and
shows nothing), so a module owning `users` alone renders at the root for free. Namespacing the plan
instead — `projects/activities`, `projects/tasks` — would have given the same nav at the cost of
renaming collections in every consumer that had just migrated onto the bare names. Same picture, no
migration.

The resulting nav: **users · assets · notebooks · repos · agents** at the root, then **Contacts**
(contacts, companies), **Meetings** (meetings, preps, summaries, analyses, and recordings filing under
it as a dependent single-collection module), **Projects** (projects, teams, tasks, activities), and the
namespaced **R&D** and **Perspective**.

**`rnd/media-packs` is retired; media is a `media_folder` template on the record it belongs to.**
`rnd/projects`, `rnd/draft-docs`, `rnd/research-docs` and `rnd/product-design-docs` each gain a
`media_folder` — a full `${env:FILES_FOLDER}/rnd/<collection>/<id>/media` template, inert on disk and
rendered per machine by `dt resolve`, exactly like `references.screenshots_folder`. A whole collection
whose job was to say "there is a folder of videos over there" earned one thing a folder does not: the
corpus each piece was generated from. That pinning moves into the owning record's BODY, where a reader
already looks to decide whether the media still reflects what the project knows. No consumer held a
media-pack record, so nothing migrates.

**Preview mode: `dt-extensions link <clone>` / `unlink`.** A schema change can now be reviewed in a
real workspace before it is a release — the verb symlinks `git_modules/extensions` at a local clone,
which the engine's own three-channel discovery unpacks and prefers over the installed copy, then
recompiles so the runtime and the CLI never disagree about which schema is live. ⚠ It is
WORKSPACE-GLOBAL, not process-scoped: every session and editor window on that workspace sees it.
So `link` installs a **pre-commit guard** that refuses a commit carrying records or the regenerated
`CLAUDE.md`/`AGENTS.md`/`GEMINI.md` while a clone is linked — the package ships first, then the
records that need it, and a record written against an unreleased collection is one no other clone can
compile. The hook runs the LINKED clone's guard, not the installed package's, and is a true no-op
once unlinked.

**A notebook now works on top of a FOLDER, and NotebookLM is demoted to an adapter.** One new
collection, `wikis`, in the `notebooks` module: a wiki is a collection of markdown sources serialised
as a folder — `wiki.yaml`, then `sources/<nn>--<slug>.md` nested into section subfolders — and a
notebook points at many of them. The local adapter is the default and has NO prerequisite: no
account, no login, no network, nothing to install. `notebooklm` is the extra, reached only through
`wiki pull`, which mirrors a live notebook's sources onto disk. Which one answers is DERIVED, not
defaulted — `notebooks.adapter` has no default, because `notebooklm` as one would contradict the point
and `local` as one would silently relabel every existing record. **Nothing migrates:** `notebook_id`,
`sources[]` and `chat` all keep their meaning, `notebook restore` and `capture` are untouched, and a
workspace that never runs a `wiki` verb sees no change.

⚠ **Every source is a file, including one nothing has downloaded yet.** That stub — frontmatter, no
body, `completeness: pending` — is what the whole design turns on: absence is the one state a reader
cannot see, so the inventory is laid out complete-and-empty first and filled second, and a
half-fetched corpus can never pass for a finished one. The marker lives in the frontmatter of the file
it judges and nowhere else, so copying the folder copies the truth. Five states, each separated from
its neighbour by an OBSERVATION: `pending` (nothing attempted) · `failed` (non-zero exit — retry) ·
`empty` (exit 0, under 256 bytes — the route is wrong, not the attempt) · `partial` (exit 0, something
declared it truncated — resume) · `complete`. `npx dt-extensions wiki incomplete` reads them off disk
and **exits 1** while anything is short, so it gates a pipeline; the counts on the `wikis` record are a
labelled cache and `wiki verify` re-derives them from the folder and names the drift.

**Sources are FILES, not records, and that is the modelling call.** A corpus measured for this release
held 129 sources; as records that is 129 version-controlled files indexing a folder that already
indexes itself, and their bytes could never be committed anyway. What is lost is `dt list` over
sources; what replaces it is `wiki incomplete` and `wiki status`, one command each.

**Ten new verbs** — `wiki init · list · show · add · status · incomplete · verify · search · outline ·
pull` — behind the same dispatch as `notebook`, with the rules pure in `lib/wiki.mjs`. **What the local
adapter cannot do is stated as a cost, not faked:** no `ask` and no `summary` (both need a model, which
costs an API key and a network call — `wiki search` gives `<file>:<line>` citations and `wiki outline` a
mechanical table of contents, and the agent reading the folder IS the model), no artifact generation and
no web research (Google's, and the `notebooklm` adapter is how you get them), and **no URL fetching** —
this package has zero runtime dependencies, so `wiki add … --kind url` writes a `pending` stub and says
so. `wiki delete` deliberately does not exist.

⚠ **The doctor changed shape for this: nothing under `notebooks` is `bad` any more.** A machine with no
vendor CLI, no login and no `notebooklm` harness now reports DEGRADED rather than UNAVAILABLE, because
the local adapter needs none of them and reporting otherwise would deny the claim on the very machine
it is about. `notebooks` joins the modules that want `FILES_FOLDER` — a wiki's `folder` is a
`${env:FILES_FOLDER}/…` template and every verb refuses rather than guessing when it cannot render it.
Design note: `docs/2026-09-11-local-notebooks-design.md`.

## 0.6.0 — 2026-09-10

**One new module, `projects` — the plan and everyone in it.** Five collections, because they are one
question: what happens, and who does it.

**`users`** is the person every owner, lead, seat and assignee field points at. NOT a contact — a
contact is someone you have a relationship WITH, a user is someone work is assigned TO — joined by
`users.contact` rather than merged, so a person who is both is one record each and a workspace with
no CRM still has somewhere to hang an assignment. Never an account: nothing here authenticates
anybody. **`teams`** groups them, with membership on the TEAM so somebody joins by editing one record
and their own page gains the mirror for free; a team is never the assignee.

**`projects`** is a delivery effort with a start, an end and a lead. **`activities`** is the ordered
plan — and a **gate is an activity with `kind: gate`**, carrying `passes_when` (the test), `evidence`
(what proved it), `blocking`, `gate_kind` and `external_owner`. One collection, because a plan reads
as one ordered list and two made every question ask twice. ⚠ `external_owner` points at `contacts`,
not `users`, on purpose: it names the person OUTSIDE this workspace who actually holds the gate — the
schedule risk you do not control, measured on a real plan where 12 of 21 gates were held by someone
else. A gate needs no activity feeding it; 4 of those 21 had none.

**`tasks` moves here from its own module**, gaining `assignee` → users (it had none, which is why a
person could not be asked what was theirs; empty still means the operator) and optional `project` /
`activity` links, so a task can hang off a plan rung without every task having to.

**`bin/check-records.mjs` is the guard the gate fold requires**, chained after `dreamteamer check`.
Nothing in JSON Schema stops a `work` row carrying `passes_when` or a gate reaching `done` with
nothing behind it, so the guard refuses: a gate with no `passes_when`, a gate `done` with no
`evidence`, a gate spanning more than one day, and any gate-only field on a work row.

**`meetings` uses users too.** `attendees` stays everyone in the room as CONTACTS — what a calendar
invite actually carries — and the new **`ours`** names the subset who are users: the people whose work
the meeting IS. That split is what lets a person's own record answer "what am I in this week" without
pretending every client is a user of this workspace.

**The views are the point:** `/plan/by-person` bands the plan by **`seats`**, not by lead — measured
on a real 31-row plan where one member led 3 rows but sat on 16, so banding by lead hid three quarters
of their work. `/tasks/by-assignee` answers the other half from the same `users` record.
`/plan/gates` is a saved FILTER over the one collection, and `/plan/gates/by-owner` bands gates by
`external_owner` — who you are waiting on. `/plan/gantt` draws a gate as a point, because `starts`
equals `ends` and the guard enforces it.

⚠ **Names are BARE** — `projects`, `activities`, `users`, `teams`, `tasks`. A workspace that already
has a collection by one of those names converts it to an overlay (`extends: 'projects/projects'`) and
adopts the canonical model; this package is the canonical example, not a guest asking for a prefix.
Measured across four consumers before shipping: one has both `projects` and `activities` and needs
exactly that conversion.

### ⚠ Upgrading from 0.5.0 — three ways this breaks a workspace, and they fail differently

Measured on a real consumer before shipping. Read all three: only the first is the one people expect.

1. **A NAME COLLISION.** `projects`, `activities`, `users`, `teams` and `tasks` are bare, and
   same-name collections across modules are a compile error. A workspace with its own `projects` or
   `activities` will not compile until it converts that descriptor to an overlay —
   `extends: 'projects/projects'` — keeping only the fields the package lacks. That is the intended
   path: this package is the canonical model, so the workspace adopts it rather than the package
   working around the workspace.
2. **AN OVERLAY WHOSE BASE MOVED MODULE.** `tasks` used to be its own module, so an overlay on it
   read `extends: 'tasks/tasks'`. That address no longer exists — the base is `projects/tasks` now.
   ⚠ **This is as breaking as a collision and it fails differently**: not "two collections called X"
   but an `extends:` target that resolves to nothing, on a workspace whose own collection names are
   perfectly fine. Retarget the overlay; nothing else about it changes.
3. **A COLLECTION THE FOLD RETIRES.** A workspace with its own `gates` does not collide with anything
   — the package ships no `gates` — but its records belong in `activities` with `kind: gate` now, and
   keeping both means two answers to "what blocks us". Migrate the records, then delete the
   descriptor and re-point its views at `/plan/gates` and `/plan/gates/by-owner`.

The one measured consumer hit all three at once: `projects` and `activities` collided, `tasks` was an
overlay on the moved base, and `gates` held 21 records the fold retires.

⚠ **One more trap, for a workspace whose VALUES are not Latin.** `users`, `teams` and `projects`
generate their id from `{{ name | slug }}`, and the engine's `slug` filter is `slugOrHash` — a Hebrew,
Arabic, Cyrillic or CJK name has no `a-z0-9` to slug, so it falls back to a deterministic `x1a2b3c4`.
The write SUCCEEDS and the id is unreadable, which is worse than a refusal because nobody notices.
Pass `--id` explicitly on those three (`dt add projects --id harbor-rollout --name "…"`). Noted in each
descriptor. ⚠ `{{ code | default: name | slug }}` is not a fix: the id generator has exactly five
filters — `date`, `datetime`, `slug`, `pad`, `basename` — an unknown one throws, and a missing field
throws before any fallback could run. A real fix needs an engine change, filed as an `rnd/features`.

**Every collection has its own valid glyph.** Audited across all 50: eight shared an icon and
`perspective/insights` used `light-bulb`, which is not a codicon — the vocabulary is `lightbulb` — so
it drew nothing and said nothing, the extension's icon layer having no allow-list. `tests/icons.test.mjs`
pins all four rules.

## 0.5.0 — 2026-09-10

**`rnd` becomes a software factory built on references.** A new collection, `rnd/references`: a
product, feature, flow, design or document worth modelling on — the capture (`reference_file`,
`screenshots_folder`, `url`), who makes it, who it serves, and `prd`, the reverse-engineered spec
written as the PROMPT that would regenerate it, with the judgement kept in the body. `product-design-docs`
gains `product`, `references[]`, `branding` and `plan`, and a generated `prototypes` mirror;
`prototypes` gains `design_doc` (the owner of that mirror), `live_url`, `iteration` and `deploy` — the
one command that refreshes the URL. Six commands are bound so `dt next` on a design doc names the
missing hop: `/ingest-reference` → `/write-reference-prd` → `/draft-prd` → `/build-prototype` →
`/iterate-prototype` → `/plan-project`. `building-from-references` is the skill; `extract-frames.mjs`
turns a recording into frames and a contact sheet, and the doctor's new `rnd` capability says whether
ffmpeg is there.

## 0.4.1 — 2026-09-10

**`notebook capture` recovers two more shapes from a live list.** A PDF the web UI fetched from a URL
keeps that URL as its title and is typed `pdf` — 21 of the sources across nine real notebooks — so it
now becomes a `url` source with the URL as `ref`, restorable, instead of a file with nothing to point
at. And a source titled `dt · <collection>` is named for what it is — the engine's `dt export
notebooklm` output — with the instruction to replace the run by ONE `kind: export` entry, rather than
asking for a file path per collection.

## 0.4.0 — 2026-09-10

**A `notebooks` record is now the spec a notebook can be rebuilt from — on any Google account.** Two
new fields: `sources`, the ordered list of what the notebook holds (`kind` · `ref` · `title` ·
`source_id`, where a file is a `${env:FILES_FOLDER}/…` template and a pasted text carries its content
inline), and `chat`, the one `configure` call — `persona` or `persona_file`, or a `mode`, plus
`response_length`. `notebook_id` is no longer required: a record can exist as a spec before any live
copy does, and `notes` stops refusing to be near a source list because the list has a field now.

**Two verbs and two bindings.** `npx dt-extensions notebook restore <id> [--account <label>]
[--title …] [--replace] [--dry-run]` creates a notebook, adds every source in order (`add` → `wait` →
`rename`, or the engine's `dt export notebooklm` for an `export` entry), sends ONE `configure` — never
`--mode` beside `--persona` — and writes `notebook_id`, `account` and each `source_id` back onto the
record. It refuses by field rather than restore something that is not restorable as written, and a
record with a live uuid needs `--account` or `--replace` to say which you mean. `npx dt-extensions
notebook capture <id>` is the mirror for a notebook that existed before its record: it maps the live
list onto record sources and NAMES what the list cannot recover (a file's path, a pasted text, a Drive
id) instead of writing a record that only looks restorable. `/restore-notebook` and
`/capture-notebook-sources` are bound to the collection, so `dt next notebooks/<id>` answers: no
uuid → restore; uuid, no sources → capture.

`chat` is write-only by nature — NotebookLM has no read of the persona (a bare `configure` clears
it), so it flows from the record to the notebook and never back.

## 0.3.0 — 2026-09-10

**An eighth module: `rnd`** — what a workspace builds and investigates. Fourteen collections under the
`rnd` namespace, ported from the dogfood vault and scrubbed hunk by hunk: `products` and the `projects`
that deliver them; `product-design-docs`, `user-stories`, `prototypes`; `features` and `issues` routed
by `repos`; `research-docs` and the `open-questions` reading cannot settle; `experiments`; `personas`
scored cold against `persona-probes`; `draft-docs`; `media-packs`. Two things the vault's copy has are
deliberately not here: the commercial funnel (`projects.engagement` is gone, `features.for_client`
points at `companies`) and the `designing-stuff` skill (`/design` covers it). A brainstormed spec is a
`product-design-docs` record and its plan a `draft-docs` record — the `use_when` on both says so.
`docs/2026-09-10-rnd-module-design.md` has the full table of transformations.

**A seventh module: `notebooks`.** One record per NotebookLM notebook — its uuid, which Google login
opens it, what corpus it holds — and the `using-notebooklm` skill, which carries the rules the vendor
CLI cannot know about itself: `configure` replaces the whole configuration and `--mode` silently
discards the persona; `ask` exits 0 with an empty answer when a broad question is scoped; `source add
--title` keeps the file name. `account` is a plain string here, because this package ships no
accounts collection to point at.

**`npx dt-extensions notebook persona <id>`** applies `NOTEBOOKLM.md`'s persona — the block compile
generates plus the workspace's hand-written additions — in ONE `configure` call, never with `--mode`,
and fails unless the notebook echoes back the same length. It is the CLI's first verb that writes
over the network, and the only one: one setting, to one notebook the operator named.

**The doctor gains `notebooks`**: the vendor CLI on PATH and its version, a session file, the vendor
skill, the `notebooklm` harness declared, `.cache/` ignored — six checks, none of them a network
request. `setup` declares the harness without dropping the engine's default (`["claude-code"]` when
the list is unset — naming only the new one would switch the coding-agent harness off) and appends
`.cache/` where an older workspace lacks it.

## 0.2.7 — 2026-09-10

**The third hole in one gate, and the last of the invalid writes.** `read-git` precomputes a record
path into a variable and writes `writeRecord(g.file, {…})` — so its collaborator write was never
matched by a gate that only looked at `writeRecord(recordPath(…))`, and it wrote 12 records carrying
the run link and no `contributor` at all. `read-obsidian` wrote `deliverables` the same way.

The gate no longer tries to identify which call is which. It reads EVERY `writeRecord(` in every
reader and library, walks to the object literal, and asks it directly. It also no longer treats a
spread as proof of inheritance when that spread can be empty: `...(g.prior ?? {})` inherits nothing
for a record being met for the first time, which is a creation wearing an update's clothes.

Three holes, three real corruptions — 1,429 records, then 913, then 12. A gate scoped to the instance
rather than the class is the same mistake wearing a test.

## 0.2.6 — 2026-09-10

**An upsert that could not repair its own record.** `upsertCollaborators`' update path spreads the
record it matched and adds only what it just derived — so a collaborator written before `contributor`
and `retrospective` became required in 0.2.0 stays invalid for ever: every re-read matches it, merges
handles into it, and leaves it failing `check`. Twelve records on one real workspace were stuck
exactly there, and no amount of re-running could move them. The update path now fills either field
when the record lacks it, and never overwrites one that is present.

## 0.2.5 — 2026-09-10

**The 0.2.4 gate had a hole, and two readers hid in it.** Its pattern scanned the `recordPath(` call
with `[^)]*`, which stops at the first `)` — and the id argument routinely contains one:
`recordPath('tickets', \`${who()}/asana--${slug(ws.name)}/${t.gid}\`, …)`. Those calls were not
merely passed, they were never MATCHED, so `read-asana` went on writing 913 tickets with no
`retrospective` while the gate reported green. `read-claude-transcripts` was hidden the same way.
The gate now walks forward to the balanced closing paren instead of guessing where the call ends.

A gate that silently matches nothing is worse than no gate: it is a green light bolted to a
disconnected sensor.

## 0.2.4 — 2026-09-10

**Five readers wrote records that `check` refuses.** `retrospective` has been REQUIRED on all nineteen
collections since 0.2.0, and `read-git`, `read-gmail`, `read-drive`, `read-obsidian` and
`read-codex-transcripts` all wrote `activity-weeks` without it. Re-reading one real workspace turned a
clean tree into 1,429 violations.

It hid for two reasons worth naming. The MIGRATION inserts a run link into any record that lacks one,
so a workspace migrated from 0.1.x looks clean and only a FRESH read shows the defect. And the gate
that was written for this exact class in 0.2.0 checked `sources` writes only — because `sources` was
where the first instance was found. Every reader writes several collections; the same omission sat in
all the others. One fixed copy is not a fix.

`tests/run-link.test.mjs` now checks every `writeRecord(recordPath('<collection>', …))` in every
reader for both the run link and the contributor, looks for the object KEY rather than the bare word
(every reader has `retrospective` in scope as a variable, which is how two writers passed the first
draft of the tightened gate), and exempts a write that spreads an existing record's fields, since an
update inherits both.

**And SKILL.md named a flag no script accepts.** The v3 rename moved every script from `--session` to
`--retrospective`; the skill kept saying `--session` in four places, including a sentence explaining
the split as though it were still real. The skill IS the procedure an agent follows verbatim, so that
is a stage that cannot run — it surfaced on `rollup-metrics`, which owns every number on an activity
and a project. `tests/skill-flags.test.mjs` reads every documented `bin/<script>.mjs --flag` out of
the skill and its references and asks the script whether it parses it.

## 0.2.3 — 2026-09-10

Why a real workspace's project board showed blank number columns. Three causes, one visible symptom.

- **The project→repo edge had no writer.** A project's code curves are summed from evidence keyed by
  REPO, so a project only gets them if something says which repos it touched. Grep the toolchain for
  a writer of `activities.repos` and the only match was `rollup-metrics` READING it — so the set was
  whatever `repo_names` a person had typed by hand. On one workspace 4 of 8 projects had them and
  showed curves; 4 had none and showed blanks, including one with 244 commits. `rollup-metrics` now
  reads the commits `read-git` already parks in `<scratch>/commits/<base>/<repo>.jsonl`, so a
  project's own commits name its repos.

- **⚠ And the curves are now summed from those commits, not from the repos' weekly totals.** The
  weekly records carry no per-project attribution, so summing them per repo handed every project
  sharing a repo that repo's ENTIRE history: a 6-commit project came out with 1,775,984 lines_new,
  identical to the three other projects touching the same repo. That is worse than the blank it
  replaced. Each commit already carries its own per-file add/del, so the honest sum needs no
  attribution — and uses the same two rules `read-git` uses per week.

- **`rollup-metrics` wrote back `projects.activities_count`,** a field 0.2.0 deleted. `check` does
  not flag an unknown key, so nothing caught it — but `dt set` does, and refuses the whole write, so
  a project that had been rolled up could no longer be edited at all.

**Not a defect, and worth stating plainly:** every token, turn, word and tool-call column is blank on
a workspace whose `claude-transcripts` source is `unavailable`. All of them derive from
`perspective/conversations`, and a contributor whose coding-agent transcripts live on their own
machine has none. The module's own descriptor already says this — "an activity with commits and no
sessions was reconstructed from git alone, and its `active_minutes` being 0 is a fact about the
evidence, not about the work".

## 0.2.2 — 2026-09-10

Two defects found by re-running a full retrospective over a real workspace's evidence.

- **`tickets.assignee` was never written, so the whole ticket↔person relation did not exist.**
  `read-asana` stores `assignee_handle` — the raw email — because at the moment it writes a ticket
  the collaborator records do not exist yet: it creates them in a later pass over the same tasks.
  Nothing ever came back to resolve the handle, so one workspace had 935 tickets carrying an
  assignee's ADDRESS, no ticket carrying an assignee, and every collaborator board showing zero
  tickets. `derive-collaborators` now stamps it from the handle→ref map it already builds for
  activities; an unassigned ticket acquires no person, and re-running changes nothing.

- **`synthesize-perspective` died at its last line on every real workspace.** It still wrote the
  back-link `retrospective-sessions.perspective`, which became a GENERATED MIRROR of
  `perspectives.retrospective` in 0.2.0 — and the engine refuses a direct write to a generated
  field. The whole stage did its work and then failed. It shipped because the guard around that
  write was "does a compiled runtime exist beside the data root", which is false in every fixture,
  so no test ever reached the line. The write is gone; the owning side was always being set.

## 0.2.1 — 2026-09-09

Three defects, all found by running 0.2.0 against real workspaces rather than by reading it.

- **`migrate` no longer reports a clean check after a failed compile.** On the first real workspace
  `compile` refused on a ui-view name collision that had nothing to do with the migration. Everything
  after it then ran against the STALE compiled schema: every `relations rebuild` failed with "unknown
  collection perspective/…", and `check` printed `✔ 0 violations (63 records across 32 collections)`
  for a workspace holding 282 migrated ones. It was not lying — the old schema knew none of the new
  collections, so it validated what it recognised and skipped the rest in silence. The migration now
  stops at a failed compile and says so, and separately refuses to accept a `check` that counted
  fewer records than it just wrote.

- **Two ui-view columns named fields that do not exist**: `projects` asked for `activities_count`,
  deleted in 0.2.0, and `content-perspective-sources` asked for `session`, the retired run link. No
  other gate could see them — the descriptors were right, compile was happy, and `check` reported
  zero violations over 5,521 real records, because a column for a missing field is not a violation of
  anything. It renders as an empty cell, and an empty cell reads as data.
  `tests/view-columns.test.mjs` now checks every column in every module against the fields its
  collection declares, plus the mirrors the engine generates and the columns the engine synthesises.

- **`projects.use_when` still told a reader to list by `activities_count`.**

## 0.2.0 — 2026-09-09

**`introspection` is now `perspective`, and there is no compatibility path.** The rename goes all the
way down: the module folder, the namespace, every collection name, every record suffix, the field
names, and the record ids themselves. No alias, no compat read, no deprecation window — that was the
operator's call, and `tests/no-old-spelling.test.mjs` is what keeps it true a year from now.

**A workspace with records already written moves with one command:**

```bash
npx dt-extensions migrate            # --dry-run first, if you would rather look
```

It refuses on an uncommitted tree, refuses on any frontmatter key no descriptor declares rather than
discarding a field somebody wrote, rebuilds the generated relation mirrors, and ends by running
`dreamteamer check` over the result. That output is the answer, not the script's own summary. It was
proved against all 5,521 live records across three workspaces before release: 0 violations on each,
and byte-identical on a second run.

### what changed, and why

- **One name for the run link.** The run was reached through `introspective` on eleven collections and
  `session` on four. It is `retrospective` on all nineteen now. `session` was the worse of the two,
  because this module also models agent sessions and calls them `conversations`.

- **Records are keyed by the CONTRIBUTOR, in three layers.** Evidence and model records
  (`activities`, `sources`, `concepts`, `goals`, …) begin with the contributor's slug, so a second
  retrospective months later UPDATES that person's operating model instead of writing a parallel copy
  of it beside the first. Only the run log itself and the things that belong to one run —
  `retrospective-sessions`, `questions`, `proposals`, `gates` — stay keyed by the run.

- **`contributor` is a slug, and the schema enforces it.** It was a `perspective/collaborators`
  reference for one day. An id segment cannot be a reference, so every `contributor` field now carries
  `pattern: ^[a-z0-9-]+$` and the engine refuses anything else. The addresses a person appears under
  live in `handles`, spelled and shaped exactly as `collaborators.handles`, and `contact` is a real
  `x-reference: contacts` on both collections.

- **One stage model.** The `stage` enum, the skill's stage table and the module description were three
  different lists (16 values, 13 rows, 12 names); one row set two stages, and `goals` was written by
  no stage at all. They are one list now, `inferred` writes the goals, and a test asserts it.

- **The session says what it read.** `sources` were inventoried and then never recorded on the run, so
  a reader of a finished retrospective could not answer "what did this see" — and nothing at all
  recorded what it could NOT see. Both are records now.

- **Every stage is idempotent, and that is a gate rather than a claim.** Running a stage twice leaves
  the record tree byte-identical apart from a three-entry allowlist.

- **Relations are two-way where that reads.** Four hand-maintained field pairs were deleted in favour
  of `x-inverse` mirrors the engine owns, and counts are counts of real records rather than integers
  somebody remembered to update.

- **New: `assumptions`.** Every observation rests on something the evidence did not settle. An
  assumption record carries a REQUIRED `wrong_if` — the thing that would be observably true in THIS
  world if the assumption is wrong, never a counterfactual — plus a confidence, an impact, and what
  rests on it.

- **New: `gates`.** The twelve conditions each stage boundary has to meet, as records: the verdict,
  what was measured, and — when waived — why. A verdict other than `not-run` without a measurement is
  refused.

- **`concepts` carry a `kind`** (term, system, process, artefact, role, person, place, metric, event,
  tool) and a `related_to` that points out at the consumer's own world — `contacts`, `companies`,
  `meetings`, `tasks`, `repos`, `perspective/projects` — through declared peers.

- **The left nav runs in pipeline order**: the run, then what it could see, then the evidence, then
  the model, then the conclusions, then the answer.

### upgrading

`@dreamteamer/extensions@0.2.0` requires engine **0.24.0 or newer**. A caret on a `0.x` version pins
the minor, so `npm install` alone will not move you off 0.1.x — ask for the version by name.

## 0.1.1 — 2026-09-09

First published release. Six modules — `assets`, `contacts`, `tasks`, `meetings`, `recordings` and
`introspection` — each installable on its own and each compiling alone in a virgin workspace.
