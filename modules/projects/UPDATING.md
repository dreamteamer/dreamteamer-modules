# Updating @dreamteamer/projects

One section per release, newest first. Each says what you have to **do** in a workspace that
installs this module; most of the time it is `dt compile`, then `dt check`.

```bash
npm install @dreamteamer/projects@latest
npx dreamteamer compile
npx dreamteamer check
```

---

## 0.4.0 — teams moved to @dreamteamer/users

`teams` is no longer shipped here: the collection, and the `teams` and `led_teams` mirrors on users,
are `@dreamteamer/users` 0.2.0's. What projects keeps is `projects.teams` (a project is staffed with
teams, unchanged) and the one field a team gains from the plan, the generated `teams.projects`,
declared here as an overlay of teams. `teams` is now in projects' `peer_collections`. No field was
added, removed or renamed, and no record moves.

**You now need users 0.2.0 for teams.** projects has always depended on `@dreamteamer/users` —
compile refuses projects without it — but the teams collection now comes from users, not from here.
Upgrade both at once:

```bash
npm install @dreamteamer/users@^0.2.0 @dreamteamer/projects@^0.4.0
npx dreamteamer compile
npx dreamteamer check
```

- projects 0.4.0 beside users 0.1.x: compile passes, but no module provides `teams` — the
  collection is gone from the workspace, and `dt check` reports
  `peer collection "teams" is declared but not installed` and `unknown field "teams"` /
  `"led_teams"` on every user in a team. Install users 0.2.0.
- users 0.2.0 beside projects 0.3.x: compile refuses, `name collision on collection "teams"`.
  Install projects 0.4.0.

On `@dreamteamer/core` there is nothing to do: core 0.7.0 composes both.

**An overlay of yours.** If your own module overlays `teams` with
`extends: "@dreamteamer/projects/teams"`, change it to `"@dreamteamer/users/teams"` and declare
`@dreamteamer/users` as the dependency.

## 0.3.1 and earlier

No upgrade notes.
