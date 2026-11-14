# @dreamteamer/worktrees

A second checkout of a [dreamteamer](https://github.com/dreamteamer/dreamteamer) workspace, and the way
its committed records come home. Cut a worktree, work there in parallel, then land it.

```bash
npm install --save-dev @dreamteamer/worktrees
npx dreamteamer compile
npx dreamteamer install --print-adapters   # includes the WorktreeCreate / WorktreeRemove hooks to merge
```

`dt` below is the dreamteamer CLI: `npx dreamteamer worktree …`, `npx dreamteamer land …`.

| verb | what it does |
|---|---|
| `dt worktree add --name <n> [--path <dir>] [--base <ref>] [--temp]` | cut a linked worktree on `worktree-<n>` and install it; its path is the last line printed |
| `dt worktree list` · `get <name\|path>` · `rm <name\|path> [--force]` | observed from `git worktree list`; `rm` refuses a tree holding dirty records or commits nothing else holds |
| `dt land <name\|path> [--keep] [--dry-run] [--branch <name>]` | rebase a copy of the worktree's branch onto the primary, check, fast-forward, recompile, retire; any conflict stops it with every tree unchanged |
| `dt worktree add --hook` · `dt worktree rm --hook` | the WorktreeCreate and WorktreeRemove hook forms, reading the harness's JSON on stdin; `rm --hook` removes the tree under `rm`'s guard |

Every verb refuses a flag it does not know. `--json` (on `add`, `list`, `get` and `land`) gives one JSON
value on stdout. A new worktree loads the same engine and modules: every symlinked direct dependency
is mirrored into it. The module needs no setup; merging the two hooks into your coding agent's own
settings file is your step, and `install --print-adapters` prints the snippet.

The `working-in-worktrees` skill carries the method: the lifecycle, the landing and the merge policy.
Engine `>=0.33.0`. Apache-2.0.
