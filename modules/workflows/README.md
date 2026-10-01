# @dreamteamer/workflows

Behaviour proofs and the worktree lifecycle for a [dreamteamer](https://github.com/dreamteamer/dreamteamer)
workspace — the three verbs that left engine core in 0.31.0.

```bash
npm install --save-dev @dreamteamer/workflows   # in the workspace
dt compile                                      # the proofs kind, the proofs collection and two skills arrive
```

It is loaded because the workspace depends on it: nothing else to configure. `dt status` lists it,
`dt help` appends its usage, and `dt install --print-adapters` includes its two hooks. Uninstall it
and a workspace still holding `proofs/` folders fails compile on the unknown kind — deliberately:
a proof nothing validates is a claim nothing checks.

## verbs

| verb | what it does |
|---|---|
| `dt prove <proof>` | run one proof; the answer is the EXIT CODE — 0 pass · 1 fail · 3 unavailable · 4 no-fixture · 5 a `perform` step is owed an actor · 6 vacuous. Evidence lands in `.dreamteamer/.proofs/<id>.jsonl` (per machine, capped at 50 rows) |
| `dt prove <artifact>` · `dt prove --all` | a board over the proofs `about` an artifact, or over all of them; `--strict` makes UNAVAILABLE fatal |
| `dt prove --list [<proof\|artifact>] [--strict]` | runs nothing: availability on this machine and the last verdict per proof, then a tally; `--strict` exits 1 on any FAIL tail |
| `dt prove --list --missing` | the artifacts no proof is about |
| `dt worktree add --name <n> [--path <dir>] [--base <ref>] [--temp]` | cut a linked worktree on `worktree-<n>` and install it; its path is the last line printed |
| `dt worktree list` · `get <name\|path>` · `rm <name\|path> [--force]` | observed from `git worktree list`; `rm` refuses a tree holding dirty records or commits nothing else holds |
| `dt land <name\|path> [--keep] [--dry-run] [--branch <name>]` | rebase a copy of the worktree's branch onto the primary, resolve only the conflict hunks inside a generated block, check, fast-forward, recompile, retire |
| `dt worktree add --hook` · `dt land --hook --dry-run` | the WorktreeCreate / WorktreeRemove hook forms, reading the harness's JSON on stdin |

Every verb refuses a flag it does not know, and every form refuses the other forms' flags — a flag
accepted and dropped is a silent wrong answer. `--json` on each gives one object on stdout.

The two skills it ships carry the method: **proving-artifacts** (writing, running and reading
proofs) and **working-in-worktrees** (the worktree lifecycle, the landing, the merge policy).

## the extension contract it uses

`src/extension.js` default-exports `activate(dt)`, where `dt` is the running engine's public API
(`import('dreamteamer')`'s namespace). Every engine call in this package goes through that binding
(`src/engine.js`); nothing here imports the engine, so it can never disagree with the engine the
operator ran. The contribution:

| key | value |
|---|---|
| `commands` | `prove`, `land`, `worktree` — dispatched in-process with the opened workspace; the return is the exit code |
| `sourceKinds` | `[{ kind: 'proofs', exclude: ['fixtures'] }]` — `proofs/fixtures/<proof>/data/` is records a `writes` proof runs against |
| `analyze` | validates every proof against the merged descriptors, declared var/env names and the compiled artifacts; unsubstituted braces as warnings; the coverage line and the "no proof yet" nudge for new commands, skills and scripts as notes |
| `hooks` | `WorktreeCreate: 'worktree add --hook'`, `WorktreeRemove: 'land --hook --dry-run'` |
| `orientation` | one sentence: before saying an artifact works, run `dt prove <artifact>` and quote its result |

The same `package.json` key makes the package a content module, so compile discovers
`collections/proofs.collection.yaml` and `skills/`.

A checkout this package derives — a new worktree, a `writes` proof's sandbox, a landing's copy —
loads the same engine and extensions: every symlinked direct dependency under `node_modules/` (and
every symlinked `git_modules/` shadow) is mirrored into it, and each compile there goes through
`dt.openWorkspace`.

Engine peer: `dreamteamer ^0.31.0`. Apache-2.0.
