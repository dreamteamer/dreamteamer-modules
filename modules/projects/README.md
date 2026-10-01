# @dreamteamer/projects

The plan and everyone in it: projects, the phases and lanes they are read in, activities and gates,
goals, decisions, deliverables, risks and teams. Every owner, lead and seat field points at `users`.

```bash
npm install @dreamteamer/projects @dreamteamer/users
npx dreamteamer compile
```

| alone | with others |
|---|---|
| the plan, its views (`/plan/by-lane`, `/plan/by-person`, `/plan/gates`, the gantt) and the plan guard | **tasks** hangs small commitments off a project or an activity · **contacts** names who accepts a deliverable, owns an outside gate or made an outside decision · **companies** says whose project or team it is |

Chain the plan guard into your workspace's `check` script (`npx dt-setup setup` offers to):
`node node_modules/@dreamteamer/projects/bin/check-records.mjs`. Two one-off migrations ship for
workspaces holding records in an earlier shape: `bin/migrate-plan.mjs` turns a free-text
`activities.phase` into `phases` records, and `bin/migrate-code-to-slug.mjs` renames `code` to `slug`
on decisions, goals, deliverables and tasks.

## what a descriptor cannot say

**A gate is an activity.** One collection holds both, because a plan reads as one ordered list:
"what happens in February" and "what blocks us" are the same list filtered two ways. `kind` separates
them, and `/plan/gates` is a saved filter, so a gate stays addressable without being a second object.

**`bin/check-records.mjs` keeps the fold honest.** Nothing in JSON Schema stops a `work` row carrying
`passes_when`, or a gate reaching `done` with nothing behind it. The guard refuses both; refusing a
passed gate with no evidence is the rule a gate exists for. It also refuses a decision that does not
say who made it, an `accepted` deliverable with no `accepted_by`, and a `closed` risk with nothing
quotable behind it. Chain it after `dreamteamer check`.

**`external_owner` points at `contacts`, not `users`.** Every other owner field names one of yours;
this one names the person outside who actually holds the gate: the client approving, the partner
supplying an environment, the regulator. It answers "what schedule risk do we not control", and
typing it as a user would claim those people as staff.

**A gate needs no activity feeding it.** Some gates exist precisely because nobody on the delivery
side works toward them, so nothing here requires a feed.

**`estimate` carries its own unit.** Every shop prices in different units, so the unit travels with
the number as free text. `estimate_basis` says how it was arrived at.

**`lane` is which track; `phase` is when.** A lane is a record because it carries an `order`: a board
stacks its bands top to bottom, and a string has no order but its own spelling. A phase is a record
because it carries its own `starts` and `ends`, so a stretch's span is stated once rather than taken
from whatever rungs point at it. Use one of them as the grouping axis, not both, or the plan has two
disagreeing ways to band. The full argument for lanes is in `docs/2026-09-11-activity-lanes-design.md`
in the source repository.

**The guard checks what crosses records.** A rung may not sit in a lane or a phase belonging to another
project. Both fields are typed and both resolve, so `dreamteamer check` passes, and the board would
draw this plan's rung inside another plan's band. `bin/check-records.mjs` refuses it, naming both
projects.

**A team is never the assignee.** Membership lives on the team, so somebody joins by editing one
record and their own page gains the mirror. Activities and tasks still go to a person;
`activities.team` says which team carries a rung, and `seats` names the individuals.
