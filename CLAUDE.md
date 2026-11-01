# dreamteamer-modules — house rules

One repo, one npm package per module under `modules/<id>/`, each published as `@dreamteamer/<id>`
and versioned on its own. The root is a private npm workspace and is never a dreamteamer workspace;
its `"dreamteamer": {}` key exists only so a clone can be previewed as a bundle (`dt-setup link`).

1. **NO PERSONAL DATA.** No real names, emails, domains, ids, home paths or company names in any
   file, example, comment or commit message. Use the synthetic cast: Dana Oren and Sam Diaz,
   Northwind, Harbor Mutual, Priya Raman, Tom Whitfield, `*.example` addresses. `npm test` runs the
   public half of the leak gate; the private half (real client and colleague names) runs from the
   operator's vault before anything is pushed.
2. **Every module compiles alone** with only its declared dependencies, on both channels. A module
   that needs a sibling it did not declare is not a module.
3. **A dependency is spelled as the full package name**, `"@dreamteamer/users"`. The engine keys a
   module by its package name for `dependencies` and `extends`, and strips the scope only for display
   and `disable`.
   **A floor on a sibling is an npm `peerDependencies` range**, top level, `>=x.y.z` — never inside
   `dreamteamer`: strict on a module the declarer lists in `dreamteamer.dependencies`, optional
   (`peerDependenciesMeta`) on any other, so npm never installs a module nobody asked for. npm refuses
   the install below it and `dt compile` (engine 0.42.0 or later) refuses it on every channel; a floor
   the sibling in this repo does not meet, or one on a module a composition leaves out, fails
   `tests/dependency-floors.test.mjs`.
4. **A peer is a collection name.** Every official module lives here, so the structure test's
   `PROVIDED_ELSEWHERE` is empty and a peer nothing here provides is a typo.
5. **A module ships only what its `files` list names.** Tests live in `modules/<id>/test/` — a skill's
   tests in `test/<skill>/` — never inside a skill, because compile copies a skill folder into every
   harness. Design history lives in `modules/<id>/docs/` and is not shipped.
6. **A script a person runs has its own entry.** Realpath both sides of the main guard, resolve the
   workspace by walking up to `package-lock.json` and skipping a folder directly inside
   `git_modules/` (`lib/workspace-root.mjs`, one copy per module). A skill script is run from the
   workspace root as `.dreamteamer/skills/<skill>/bin/<script>`; a module script as
   `node node_modules/@dreamteamer/<id>/bin/<script>`, or through the module's npm `bin`.
7. **A module that states a rule ships the script that enforces it** (`bin/check-records.mjs` in
   users, projects and perspective), and `dt-setup setup` chains each into `npm run check`.
8. **A module declares every npm package its shipped code imports** (`js-yaml`, `express`). The
   repo's devDependencies are not there for a consumer.
9. **Code modules need engine 0.31** (`dreamteamer.extension`); content modules are tested on 0.30.
   The floor in each manifest is the oldest engine the suite runs it on, never a guess.
10. **Publishing is the operator's act.** Nothing is pushed, tagged or published from a session
   without an explicit go. A release is one `<id>-v<version>` tag.
11. **Historical documents keep the spellings of their day.** `docs/extensions-*` and every
   `modules/*/docs/` file describe what happened under the old names; a rename never rewrites them.

## where this repo came from

Carried in on 2026-10-01, each verbatim first so every later change is a reviewable diff:
`dreamteamer/extensions@2f4bf1a` plus the two perspective fixes merged there the same day
(`8e4202d`), `dreamteamer-tools@3df18b4` (workflows, http, host), and the operator's vault at
`2b29374b8` (notebooklm). `workflows` was split into `proofs` and `worktrees`; `host` became
`docker-workspaces` with the command `dt-docker`; the pack's root CLI became `setup`; `tasks` left
`projects`. Later the same day, by the test "does some module need part of this one without the
rest": `companies` and `tags` left `contacts`, `notebooks` became `wikis` plus the notebook spec
folded into `notebooklm`, the screenshots ingest moved from `recordings` to `meetings`, and the
prep/summary/critique pipeline left `meetings` as `meeting-docs`. A mirror across modules is declared
ON THE OWNER (`x-inverse`), never as `x-inverse-of` on the target, so it exists only when the owner
is installed. Neither source repo is consumed from here, and nothing syncs back.
