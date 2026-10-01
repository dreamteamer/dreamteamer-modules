# @dreamteamer/projects

The plan and everyone in it: projects, the phases and lanes they are read in, activities and gates,
decisions, deliverables, risks and teams. Every owner, lead and seat field points at `users`.

```bash
npm install @dreamteamer/projects @dreamteamer/users
npx dreamteamer compile
```

| alone | with others |
|---|---|
| the plan, its views (`/plan/by-lane`, `/plan/by-person`, the gantt) and the plan guard | **tasks** hangs small commitments off a project or an activity · **contacts** names who accepts a deliverable or owns an outside gate |

Chain the plan guard into `npm run check` (`npx dt-setup setup` offers to):
`node node_modules/@dreamteamer/projects/bin/check-records.mjs`. Migrations from the old pack:
`node node_modules/@dreamteamer/projects/bin/migrate-plan.mjs` and `…/migrate-code-to-slug.mjs`.

## what a descriptor cannot say

**A gate is an activity.** One collection holds both, because a plan reads as one ordered list and
splitting it made every question ask twice — "what happens in February" and "what blocks us" are the
same list filtered two ways. `kind` separates them and `/plan/gates` is a saved filter, so gates
stayed addressable without being a second object.

**The fold is only honest because of `bin/check-records.mjs`.** A shape that can lie is worse than two
collections: nothing in JSON Schema stops a `work` row carrying `passes_when`, or a gate reaching
`done` with nothing behind it. The guard refuses both, and refusing a passed gate with no evidence is
the single rule the object exists for. Chain it after `dreamteamer check`, as the perspective module's
guard is chained.

**`external_owner` points at `contacts`, not `users`, and that asymmetry is the design.** Every other
owner field names one of ours; this one names the person outside who actually holds the gate — the
client approving, the partner supplying an environment, the regulator. It is the answer to "what
schedule risk do we not control", measured on a real plan where 12 of 21 gates were held by someone
else, and typing it as a user would have quietly claimed them as staff.

**A gate needs no activity feeding it.** On the plan this was folded from, 4 of 21 gates had no
activity at all — they existed precisely because nobody on the delivery side does work toward them.
That is a fact about the plan, not a gap in it, so nothing here requires a feed.

**`phase` is free text and `estimate` carries its own unit.** Every shop names its phases differently
and prices in different units; a closed enum or a number field would have been right for exactly one
workspace. `estimate_basis` is the honesty check — an estimate without one is a hand-wave.

**A lane IS a collection, and a gate is NOT — the same test, opposite answers.** A gate was the same
KIND of object as an activity: a rung with a date, a lead, a position in code order, drawn on the
same gantt. It belonged in the list, so it folded in as `kind: gate`. A lane is not a rung; it is the
AXIS the list is read on, and exactly one property earns it a record — **order**. A board draws its
bands top to bottom and a free-text value has no order but its own spelling, so a plan running
Discovery → Build → Hardening → Launch bands as Build · Discovery · Hardening · Launch. The number is
a property of the band and there are many activities per band, so the only place it can live without
being restated on every row is a record. Three consequences come free and none would have justified
the collection alone: a typo is refused rather than drawn as a fourth band; `project` is OPTIONAL, so
an empty one IS the workstream that crosses two plans (an activity has one project and cannot say
this); and the body has somewhere to state what the band excludes. The whole argument, with what was
proposed and refused, is `docs/2026-09-11-activity-lanes-design.md`.

**`lane` and `phase` are two axes, not two spellings of one.** `lane` is which TRACK, `phase` is
WHEN. Using both as the grouping axis gives a plan two disagreeing ways to band, so a workspace that
has been using `phase` as a swimlane should move those values into lanes — nothing forces it, and
`phase` is not deleted, because consumers hold records that set it.

**The lane rule the schema cannot express:** a rung may not sit in a band belonging to another plan.
Both fields are typed and both resolve, so `dreamteamer check` passes and the board draws this plan's
rung inside somebody else's swimlane. `bin/check-records.mjs` refuses it, naming both plans.

**A user is not a contact, and merging them is the mistake this module exists to prevent.** A contact
is someone you have a relationship WITH; a user is someone work is assigned TO. The same human is
routinely both, which is why `users.contact` joins them instead of one collection trying to be both —
and why a workspace with no CRM installed still has somewhere to hang an assignment.

**A user is not an account.** Nothing here authenticates anybody, holds a credential, or grants
access. It is an identity the plan can address, so a solo workspace still has exactly one user and
`assignee` can stay empty to mean "me".

**`teams` exists, and it came BACK — this paragraph said the opposite until 2026-09-11.** It was
dropped on 2026-09-10 ("a person is the unit work is assigned to; a group that owns nothing is a tag
on the work") and restored the same day on the operator's second look, because membership lives on
the TEAM: somebody joins by editing one record and their own page gains the mirror for free. The
rule that survived both passes is the one that matters: **a team is never the assignee.** A task and
an activity go to a PERSON; `activities.team` says which team CARRIES a rung, and `seats` still names
the individuals.
