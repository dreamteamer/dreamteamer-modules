# Updating @dreamteamer/core

One section per release, newest first. Each says what you have to **do** in a workspace that
installs this module; most of the time it is `dt compile`, then `dt check`.

```bash
npm install @dreamteamer/core@latest
npx dreamteamer compile
npx dreamteamer check
```

---

## 0.7.0 — teams comes from users (users 0.2.0, projects 0.4.0)

Nothing to do but compile. `teams` moved from `@dreamteamer/projects` to `@dreamteamer/users` in
the small modules, and core composes both, so a workspace on core has the same collections, the same
`teams` fields in the same order, and the same mirrors (`users.teams`, `users.led_teams`,
`teams.projects`). Your team records check exactly as they did.

What changed is provenance: `compose.json` lists the base descriptor at
`collections/users/teams.collection.yaml` (from `users`), and `collections/projects/teams.collection.yaml`
is now an overlay carrying only `teams.projects`. The manifest's description reads `users` with
`teams`, `roles` and `responsibilities`, and `projects` with `decisions` and `risks`; a harness file
your compile writes from it (the orientation block in `CLAUDE.md`, `AGENTS.md`) changes by that line.

**An overlay of yours.** If your own module overlays `teams` with `extends: "@dreamteamer/core/teams"`,
it keeps working — core still owns teams.

## 0.6.0 and earlier

See the small modules' READMEs; core carried no upgrade notes before 0.7.0.
