# @dreamteamer/notebooklm

Renders a [dreamteamer](https://github.com/dreamteamer/dreamteamer) workspace for NotebookLM, a reader
that is not a coding agent. `dt notebooklm` writes the schema, the records and a persona as a bounded
set of sources, and given a notebook, syncs them. The `notebooklm` harness keeps `NOTEBOOKLM.md`'s
configuration block current on every compile.

```bash
npm install --save-dev @dreamteamer/notebooklm
dt compile
```

Add `notebooklm` to `dreamteamer.harnesses` in `package.json` for the harness. Syncing needs the
`notebooklm` CLI and one login; rendering the sources locally needs neither.

**What never travels:** collections marked `sensitive: true`, fields marked `x-sensitive: true`, and
references to records that were withheld. Prose inside a record is not scanned; keep secrets out of it.

The `exporting-to-notebooklm` skill carries the judgment: plans, shard sizes, the persona, and what a
sync did. Engine `>=0.31.0`. Apache-2.0.

**Tests** run `tests/*.test.mjs` against the engine in the repo's devDependencies, or the checkout
`DT_ENGINE_DIR` names. No test reaches the real `notebooklm` CLI: every spawn runs with a PATH whose
only `notebooklm` is a stub.
