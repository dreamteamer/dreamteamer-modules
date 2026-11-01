# Updating @dreamteamer/core

One section per release, newest first. Each says what you have to **do** in a workspace that
installs this module; most of the time it is `dt compile`, then `dt check`.

```bash
npm install @dreamteamer/core@latest
npx dreamteamer compile
npx dreamteamer check
```

---

## 0.8.0 — live sessions: a session starts on a record, claims it, and other agents see it

Nothing to do but compile. To use it, bind a collection and merge the hook:

- **`sessions` gains five fields** — `status` (`running` · `ended` · `abandoned`), `records`,
  `binding`, `host`, `heartbeat` — all optional, so every existing session record checks as before
  (one written by `/session:save` has no `status` and is not live). The list shows `status`.
- **A new source kind and collection, `session-bindings`.** A module writes
  `session-bindings/<id>.session-binding.yaml`; compile refuses a bad one naming the file. Nothing
  binds a collection until a module does — the rnd lifecycle's bindings come with `@dreamteamer/rnd` 0.6.0.
- **New verbs**: `dt session start | end | heartbeat`, `dt sessions open`. A workspace module or an
  extension that already contributes a verb named `session` or `sessions` now collides with core and
  is refused at load, naming both — rename yours or disable one.
- **A session is ended by its own holder.** `dt session end` and `dt session heartbeat <id>` act only
  on a session whose harness session id is the caller's (`$CLAUDE_CODE_SESSION_ID` / `--session-id`) or,
  where none was stored, whose worker is the caller's `--agent`; `--force` is a person's way to free
  a stuck claim. A finished stage — the session's binding no longer opens its record — is named in
  `dt next` and does not block the next stage's start.
- **The Stop hook.** `dt install --print-adapters` now prints `Stop: … session heartbeat --hook`
  beside the engine's `SessionStart`; merge it into `.claude/settings.json` (it sits beside the
  `session-save.mjs` Stop hook if you have one). Another extension hooking `Stop` collides and is
  refused, naming both.
- **The extension entry is `src/entry.js`** (it activates the files entry, `src/extension.js`, beside
  the sessions code). Nothing to do unless you imported core's entry by path.
- **`dt next <ref>` says "in session by …"** only on an engine with the `next` extension contribution
  (engine 0.42.0 or later); on 0.39–0.41 that line is absent and nothing else changes.

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
