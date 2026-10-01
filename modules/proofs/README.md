# @dreamteamer/proofs

Behaviour proofs for a [dreamteamer](https://github.com/dreamteamer/dreamteamer) workspace. A proof
runs a skill, command, command-binding or module script and judges what it did. The answer is the
exit code, so a person or a script can rely on it.

```bash
npm install --save-dev @dreamteamer/proofs
dt compile                 # the proofs kind, the proofs collection and the proving-artifacts skill arrive
```

| verb | what it does |
|---|---|
| `dt prove <proof>` | run one proof: 0 pass · 1 fail · 3 unavailable · 4 no-fixture · 5 a `perform` step is owed an actor · 6 vacuous. Evidence lands in `.dreamteamer/.proofs/<id>.jsonl`, per machine |
| `dt prove <artifact>` · `dt prove --all` | a board over the proofs about one artifact, or all of them; `--strict` makes UNAVAILABLE fatal |
| `dt prove --list [<proof\|artifact>] [--strict]` | runs nothing: availability here and the last verdict per proof |
| `dt prove --list --missing` | the artifacts no proof is about |

A proof with `given.fixture: true` runs in a throwaway checkout under `.worktrees/.tmp-*`, which
this module creates, installs and removes itself. Every other proof runs in the workspace, and a run
whose steps change `data/` FAILS unless `--here` was passed. It needs no other module.

Uninstall it and a workspace still holding `proofs/` folders fails compile on the unknown kind. That
is deliberate: a proof nothing validates is a claim nothing checks.

**What the extension contributes:** the `prove` command, the `proofs` source kind with
`proofs/fixtures/` excluded, an analysis that validates every proof at compile and notes artifacts
with no proof yet, and one orientation sentence. Engine `>=0.31.0`. Apache-2.0.
