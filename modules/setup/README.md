# @dreamteamer/setup

**A shim for one release.** The board this package drew — which optional capability of a workspace
is ready, degraded or unavailable, with the fix on the row — and the in-workspace edits its `setup`
verb made are the engine's own since dreamteamer 0.47: every module declares its setup as a **unit**,
`dt status` is the board, `dt doctor` the rows, and `dt setup <unit>` the repair. Nothing here knows a
module any more.

```bash
npm install --save-dev @dreamteamer/setup
npx dt-setup doctor      # → dt status (the setup section is the board); --strict → dt doctor --strict
npx dt-setup setup       # → dt setup [<unit>] [--input id=value]… [--allow <kind>]…
```

Both print one line on stderr saying where they went, and run the engine's verb. On an engine before
0.47 they refuse with the upgrade line rather than drawing a board the engine disagrees with.

| verb | what it does |
|---|---|
| `dt-setup doctor [--strict] [--json]` | `dt status` (and `dt doctor --strict` under `--strict`) |
| `dt-setup setup …` | `dt setup …` |
| `dt-setup link <clone>` · `unlink` | preview a local clone of dreamteamer-modules in place of the published modules, as `git_modules/dreamteamer-modules`; a pre-commit guard refuses record commits while it is on — unchanged, and staying |

A workspace that depends on this package can drop it once its scripts say `dt status` and
`dt setup`. Engine `>=0.47.0`. Apache-2.0.
