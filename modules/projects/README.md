# @dreamteamer/projects

The plan and everyone in it: projects, decisions, deliverables and risks. The work itself is
planned as `tasks`; a project is the effort they hang off. Every owner and lead field points at `users`,
and a project is staffed with `teams`, which ship with users (since projects 0.4.0 — see `UPDATING.md`).

```bash
npm install @dreamteamer/projects @dreamteamer/users
npx dreamteamer compile
```

| alone | with others |
|---|---|
| the plan, its views (`/plan/by-lane`, `/plan/by-person`, `/plan/gates`, the gantt) and the plan guard; `projects.teams` staffs a project with users' teams, and each team lists back the projects it is staffed to | **tasks** hangs small commitments off a project or an activity · **contacts** names who accepts a deliverable, owns an outside gate or made an outside decision · **companies** says whose project it is |

Chain the plan guard into your workspace's `check` script (`npx dt-setup setup` offers to):
`node node_modules/@dreamteamer/projects/bin/check-records.mjs`.

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

**`teams` is a peer, not a collection of this module.** It ships with users, which projects depends
on; projects declares only the far side of its own field, `teams.projects`, as an overlay. Naming
`teams` in `peer_collections` is what lets that overlay wait for the collection rather than fail. A
users older than 0.2.0 has no teams, so projects floors users at `>=0.2.0` in its npm
`peerDependencies`: npm refuses that install, and `dreamteamer compile` (engine 0.42.0 or later)
refuses the pair by name on every channel. Only an older engine, given an install that went around
npm, still compiles it, and then `dreamteamer check` names the missing peer.
