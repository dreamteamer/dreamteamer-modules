# Updating @dreamteamer/users

One section per release, newest first. Each says what you have to **do** in a workspace that
installs this module; most of the time it is `dt compile`, then `dt check`.

```bash
npm install @dreamteamer/users@latest
npx dreamteamer compile
npx dreamteamer check
```

---

## 0.2.1 — the pairing with projects is declared

Nothing changes in what users ships. Its package.json now says, in npm's own `peerDependencies`,
that it breaks `@dreamteamer/projects` below 0.4.0 — optional, so npm never installs projects for
you. The "upgrade both at once" below is no longer only prose:

- **npm refuses the half-upgrade.** `npm install @dreamteamer/users@^0.2.1` beside projects 0.3.x
  stops with `ERESOLVE` and `peerOptional @dreamteamer/projects@">=0.4.0"`, and nothing in
  `node_modules` changes. Install both at once (below) and it resolves.
- **`dt compile` refuses it too**, on an engine after 0.41.0, wherever the modules came from — a
  `dt-setup link` clone, a copy under `modules/`, an install that went around npm's check:
  `module "@dreamteamer/users" 0.2.1 needs "@dreamteamer/projects" >=0.4.0 (its peerDependencies) —
  this workspace has 0.3.1, …` and the fix, instead of the `teams` name collision.

```bash
npm install @dreamteamer/users@^0.2.1 @dreamteamer/projects@^0.4.1
npx dreamteamer compile
npx dreamteamer check
```

**One exception: an install from a tarball or folder spec** (`file:…`). there npm 11 overrides an
optional peer with a warning and removes projects from `node_modules`. Install from the registry.

## 0.2.0 — teams ships with users

`teams` — a named group of users, with its `members`, its `lead` and the `teams` and `led_teams`
mirrors on each person — moved here from `@dreamteamer/projects`. A team is a group of people and
needs nothing but the people, so a workspace with users and no projects can now group them. No field
was added, removed or renamed, records stay where they are (`data/teams/`), and nothing needs
migrating.

What you do depends on what else you install:

| your workspace | what to do |
|---|---|
| users without projects | nothing but `dt compile`: `teams` appears, and `dt add teams --name … --members users/<id> --members users/<id> --lead users/<id>` groups people |
| users with projects | upgrade **both at once**, to users 0.2.0 and projects 0.4.0 — see below |
| `@dreamteamer/core` | nothing: core composes both and re-releases them together (core 0.7.0) |

**Upgrade users and projects together.** Each half on its own breaks the workspace:

- users 0.2.0 beside projects 0.3.x or older: two modules ship `teams`, and compile refuses with
  `name collision on collection "teams"`. Install projects 0.4.0.
- projects 0.4.0 beside users 0.1.x: compile passes, but no module provides `teams` any more —
  compile drops the collection, and `dt check` reports
  `peer collection "teams" is declared but not installed` and `unknown field "teams"` /
  `"led_teams"` on every user who is in a team. Install users 0.2.0; the same records then check
  clean.

```bash
npm install @dreamteamer/users@^0.2.0 @dreamteamer/projects@^0.4.0
npx dreamteamer compile
npx dreamteamer check
```

**An overlay of yours.** If your own module overlays `teams` (`extends: "@dreamteamer/projects/teams"`),
point it at the new owner, `"@dreamteamer/users/teams"`, and declare `@dreamteamer/users` as its
dependency.

## 0.1.1 and earlier

No upgrade notes.
