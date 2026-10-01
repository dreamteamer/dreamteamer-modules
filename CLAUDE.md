# dreamteamer-modules — house rules

One repo, one npm package per module under `modules/<id>/`, each published as `@dreamteamer/<id>`
and versioned on its own. The root is a private npm workspace and is never a dreamteamer workspace.

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
4. **A peer is a collection name** and may be provided by a module not in this repo yet; the
   structure test's `PROVIDED_ELSEWHERE` names each one until that module arrives.
5. **A module ships only what its `files` list names.** Tests live in `modules/<id>/test/`, never
   inside a skill, because compile copies a skill folder into every harness.
6. **Skill scripts are run from the workspace root as `.dreamteamer/skills/<skill>/bin/<script>`.**
   That path is the same whether the module came from npm, a copy or a clone.
7. **A module that states a rule ships the script that enforces it** (`users/bin/check-records.mjs`).
8. **Publishing is the operator's act.** Nothing is pushed, tagged or published from a session
   without an explicit go.

## carrying a module in from dreamteamer/extensions

The source of truth for the first wave was `dreamteamer/extensions` at `2f4bf1a`. To carry the next
one: copy it verbatim in one commit (so every change after is a reviewable diff), then rename the
package to `@dreamteamer/<id>`, spell its dependencies in full, fix `<extensions>/modules/…` paths to
`.dreamteamer/skills/…`, move tests out of skills, write its README with the exact install line, and
remove the entries it now provides from `PROVIDED_ELSEWHERE`. `npm test` exit 0 on the published
engine and on the engine checkout is the bar.
