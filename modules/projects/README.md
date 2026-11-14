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
| `projects`, `decisions`, `deliverables` and `risks`, each project listing its own (`projects.decisions`, `.deliverables`, `.risks`), and the plan guard; `projects.teams` staffs a project with users' teams, and each team lists back the projects it is staffed to | **tasks** hangs the work off a project (`tasks.project`) · **contacts** names who accepts a deliverable or made an outside decision · **companies** says whose project it is |

| needs | for |
|---|---|
| `@dreamteamer/users` (0.2.0 or later) | every owner, lead and decider, and the `teams` a project is staffed with |

The module ships no commands, skills or views of its own, and needs no setup: the four collections
appear in the navigation, and the guard below is the one script. Chain it into your workspace's
`check` script, after `dreamteamer check`:
`node node_modules/@dreamteamer/projects/bin/check-records.mjs`.

## what a descriptor cannot say

**`bin/check-records.mjs` holds the rules that depend on a value.** A schema cannot make one field
required because of what another holds, so the guard refuses: a decision that does not say who made
it (`decided_by: person` needs `decider` or `external_decider`, `agent` needs `agent`, `unknown`
needs `source` — and none may carry another's field), or one that supersedes itself; an `accepted`
deliverable with no `accepted_by`, or one accepted before it was delivered; and a `closed` or
`accepted` risk with no `mitigation` behind it. Exit 0 clean, 1 with violations, 2 on a usage error;
`--json` gives the result as data.

**One table holds an agent's fork and a person's call.** `decisions.decided_by` says which, so "why
was it done that way" is one list whoever decided. A decision is never edited into its opposite: the
later record names the earlier one in `supersedes`, and the earlier gains `superseded_by`.

**`external_decider` and `accepted_by` point at `contacts`, not `users`.** Every other owner field
names one of yours; these two name the person outside who actually made the call or said yes: the
client approving a scope, the partner choosing an environment. Typing them as users would claim
those people as staff.

**A deliverable is accepted, not done.** Handing something over is your act and `delivered` asserts
it; `accepted` is the receiving side's, which is why the guard wants a name beside it.

**The work is not here.** Activities, lanes, phases and the plan views left in projects 0.3.0: the
work is planned as `tasks`, which point at their project. A project is the effort they hang off.

**A team is never the assignee.** Membership lives on the team, so somebody joins by editing one
record and their own page gains the mirror. A task still goes to a person; `projects.teams` says
which teams are staffed to the effort.

**`teams` is a peer, not a collection of this module.** It ships with users, which projects depends
on; projects declares only the far side of its own field, `teams.projects`, as an overlay. Naming
`teams` in `peer_collections` is what lets that overlay wait for the collection rather than fail. A
users older than 0.2.0 has no teams, so projects floors users at `>=0.2.0` in its npm
`peerDependencies`: npm refuses that install, and `dreamteamer compile` (engine 0.42.0 or later)
refuses the pair by name on every channel. Only an older engine, given an install that went around
npm, still compiles it, and then `dreamteamer check` names the missing peer.
