# activity lanes — the bands a plan is read in

**Status:** implemented, v0.8.0+1. **Modules touched:** `projects`, `perspective`.

The ask was one sentence and it was cut off mid-way: *"projects model — lets add activity lanes, an
entity grouping activities by logical lanes, add to perspective and retro. activity lane has"*. The
field list never arrived, so **every field below was proposed here, not specified** — the shape is an
argument, and the argument is the deliverable. Correct it and the descriptor follows.

---

## 1. Does a lane earn its own collection?

It has to be asked, because the last release went the OTHER way on a very similar question. `gates`
was a collection on 2026-09-09 and was **deleted** on 2026-09-10, folded into `activities` as
`kind: gate` — the reasoning being that a plan reads as ONE ordered list, and splitting it made every
question ask twice. And `activities.phase` is free text today, already groups, and is what
`/plan/gantt` bands by.

So run a lane through the same test. What does it answer that `phase` cannot?

**One thing, and it is enough: ORDER.**

A board draws its lanes top to bottom. A free-text value has no order but its own spelling, so a plan
running Discovery → Build → Hardening → Launch bands as **Build · Discovery · Hardening · Launch**.
Nothing on the activity can fix that. The ordering is a property of the BAND, and there are many
activities per band, so the only place the number can live without being restated on every row — and
contradicted on the row somebody forgot — is a record of its own. A prefix hack (`1-discovery`)
is a number smuggled into a string, and it renames the lane every time the order changes.

Three more follow from being a record, and **none of them would have been worth a collection alone**:

- **A typo is refused rather than drawn.** `Phase 1`, `phase-1` and `Discovery` are three bands on
  the board and one in somebody's head. A reference is checked; a string is not. The vault's own plan
  is 52 activities — 52 hand-typed strings is where drift is measurable, not theoretical.
- **A lane may span projects.** `project` is OPTIONAL, and empty means exactly that: a workstream
  running across two plans (security, data migration, the thing one team owns everywhere). An
  activity has exactly ONE project, so nothing on the activity can express this.
- **It has somewhere to say what it covers** — and, in the half that earns the body, what it
  deliberately does not, which is the sentence that stops a band becoming the row everything unfiled
  lands in.

**Why this is not the `gates` case.** A gate was the same KIND of object as an activity — a rung of
the plan, with a date, a lead, a position in code order, drawn on the same gantt. It belonged in the
list. A lane is not a rung; it is the axis the list is read on. Folding it in is what `phase` already
is, and `phase` is what has the defect.

**The honest cost, stated rather than discovered.** `phase` and `lane` must not BOTH be used as the
grouping axis, or a plan has two disagreeing ways to band and a view picks one. So the two are given
different jobs in their descriptions — `lane` is which TRACK, `phase` is WHEN — and a workspace that
has been using `phase` as a swimlane should move those values into lanes. **`phase` is not deleted**:
consumers hold records that set it, deleting it is a migration, and it was not what was asked for.

---

## 2. The field set — proposed, not specified

| field | required | why it is here |
|---|---|---|
| `name` | ✔ | the lane header |
| `order` (integer) | ✔ | **the forcing field.** It is the entire argument for the collection, so an unordered lane must not be writable — that would be `phase` with extra ceremony. Verified on the live engine: `dt add activity-lanes --name Nope` exits 1, `must have required property 'order'` |
| `project` | — | optional, and **empty is a meaning**: the cross-project workstream. Mirrors back as `projects.lanes` |
| `tags` | — | the module's convention on every data entity |
| `content` (body) | — | what the band covers, and what it deliberately excludes |

Plus the `projects-provenance` template (`author` · `creation_context` · `source` · `confidence`),
which every data entity in the module stamps.

**Five authored fields.** A lane that carries fields nobody sets is worse than one that carries two.

### What was considered and REFUSED

- **`color`** — a gantt already colours by `status` (`plan-gantt.ui-view.yaml`,
  `color_by_field: status`). A lane colour is a second colouring authority fighting the first, and
  the one a reader needs (is this rung done?) is the one that would lose.
- **`lead`** — would make a band an accountability object beside `activities.lead` and
  `projects.lead`, i.e. a third answer to "who owns this". And a lane spanning two plans with one
  lead is a claim nobody made.
- **`status`** — a lane does not complete; the work in it does.
- **`code`** — the id already is the handle. `activities.code` exists because a plan is read in code
  order; a lane's order is the `order` field.
- **`starts` / `ends`** — a band has no dates of its own; the rungs in it do.

`tests/plan-model.test.mjs` asserts each of those absences by name, so re-adding one is a decision
somebody has to take deliberately.

### The id shape, and its price

`{{ name | slug }}` — flat, so lane names are unique across the workspace.

This is forced: the engine's id generator **throws on a missing field** (no fallback runs), so an
OPTIONAL field cannot be an id segment. `{{ project }}/{{ name | slug }}` would refuse every
cross-project lane, which is half the reason the collection exists. The cost: two plans that each
want a lane called "Discovery" either SHARE one cross-project lane (legitimate) or name them apart.
`dt add` refuses the collision rather than merging silently, which is the failure mode worth having.

### The one rule a schema cannot express

**A rung may not sit in a band belonging to another plan.** Both fields are typed and both resolve,
so `dreamteamer check` passes — measured on a live workspace: `✔ 0 violations (99 records across 45
collections)` with a `beacon-rollout` rung parked in `atlas-rollout`'s Discovery lane. The condition
lives in a DIFFERENT record, which is what JSON Schema cannot reach. `modules/projects/bin/check-records.mjs`
refuses it:

```
✖ plan records: 1 violation(s) across 3 activities
  a-03: lane `discovery` belongs to project `atlas-rollout` and this rung is in `beacon-rollout`
        — move the rung, or clear the lane's `project` if the band really does span plans
```

A lane with no `project` matches everything, by design.

---

## 3. The observed half, and the rule that governs it

The operator asked directly: *"when extending a collection to create a new one in perspective or
otherwise, need to override all related entities fields?"*

**Yes.** A mirrored collection's references must resolve WITHIN its own layer. `real` is the only
crossing, and it is one-way and soft. If an observed activity's `lead` pointed at the real `users`, a
record a retrospective FOUND would be wired into records a person WROTE, and the two layers would
stop being separable — which is the entire parallel-object design.

So `perspective/world/activity-lanes.project` → `perspective/world/projects` (not `projects`), and
`perspective/world/activities.lane` → `perspective/world/activity-lanes` (not `activity-lanes`).

**This is now pinned as a general rule**, not per field. `tests/world-model.test.mjs` gained a block
that walks every field of every collection in the namespace and refuses any reference to a real-world
noun except `real`:

> a reference target is legal iff it starts with `perspective/`, OR it names a collection the
> observed world has no half of (a peer — `companies`, `contacts`, `meetings`, `repos`), OR the field
> is `real`.

and asserts that each world collection crosses through **exactly** `['real']`. The next collection
added to that namespace cannot get it wrong quietly. Verified negatively: re-pointing
`world/activities.lane` at `activity-lanes` fails the block by name.

**One shape is deliberately NOT copied.** `order` is REQUIRED on the real collection and OPTIONAL on
the observed one. A planner's lane order is a DECISION — deciding it is why the collection exists. An
observed lane's order is a READING of the evidence (earliest first activity first), and a run that
cannot tell leaves it empty, exactly as it leaves `lead` and `ended` empty rather than inventing them.
This follows the precedent already in the layer: `starts`/`ends` → `started`/`ended`, and `kind:
work|gate` dropped entirely because evidence never contains a gate.

---

## 4. Which retro stage writes lanes, and why

**Stage 5, `projected`** — not stage 4, `clustered`.

1. **A lane cannot be named before the activities that reveal it exist.** At stage 4 the model is
   still deciding what the activities ARE, from a candidates file. A band over them is a structure
   one level up.
2. **`projected` is already the stage that writes a structure OVER activities and then fills a field
   on each one.** It writes `world/projects`, then sets `project` on every activity. Lanes are the
   identical move one level down: read the activities of an effort, band them, then set `lane`. Same
   pass, same gate, same receipt.
3. **Stage 4 is a fixed three-script sequence** (`attach-evidence` → `derive-tasks` →
   `rollup-metrics`, "in that order, and none of the three is optional"). Adding a second model
   judgement inside it muddies a stage whose value is that it is mechanical after the naming pass.

The stage table row, `/run-retrospective`, the module's 13-stage description and
`bin/check-records.mjs`'s SUFFIX and REAL_TARGET maps all moved together.

**A lane is not a topic**, and the stage row says so: a topic is what the work was ABOUT, a lane is
the track it ran on, and several topics routinely share one lane. A proposed lane with exactly one
topic IS that topic and gets no record.

---

## 5. Migration

**Nothing to migrate, and `migrate-world` needs no change.** No consumer holds a lane record — the
collection is new. Nothing is renamed, nothing moves folder, no id changes, and no field is deleted.
`bin/migrate-world.mjs`'s `MOVES`, `FIELD_RENAMES` and `scanSources` are untouched; its source-scan
refuses on a consumer overlay or ui-view naming a RENAMED collection, and there is no rename here.

**What a consumer runs: `npm install` (or `npm update @dreamteamer/extensions`), then `npm run
compile`.** Nothing else. Existing plans keep working — `lane` is optional and `phase` is unchanged,
so a plan that never creates a lane is exactly the plan it was, with one more empty column on the
list view and one more empty band-by option.

Two non-blocking notes for a consumer that adopts lanes:

- The `projects` module's nav order shifted by one (`activities` 9→10, `goals` 10→11) so
  `activity-lanes` could sit at 9, between `projects` and `activities`. Presentation only.
- `modules/projects/bin/check-records.mjs` should already be chained after `dreamteamer check`; if it
  is, the new lane rule arrives with it and needs no wiring.

---

## 6. What was NOT done, deliberately

- **`phase` is not deleted or deprecated in the schema.** It is re-described as the time axis.
  Retiring it is a migration over records consumers hold, and a separate decision.
- **`plan-gantt` still bands by `phase`.** A plan that never grew lanes keeps the view it had; the
  new `/plan/by-lane` board is where lanes are drawn.
- **The observed guard has no lane/project agreement rule.** In the observed layer both fields are
  written by the SAME pass in the same stage from the same clustering, so there is no second author
  to disagree with — and the module's rule is that a finding warns rather than refuses. If a run is
  later split across passes, that rule earns its place.
