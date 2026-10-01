# @dreamteamer/notebooklm

Everything NotebookLM. `dt notebooklm` renders a [dreamteamer](https://github.com/dreamteamer/dreamteamer)
workspace as a bounded set of sources and, given a notebook, syncs them; the `notebooklm` harness
keeps `NOTEBOOKLM.md`'s configuration block current on every compile; and a `notebooks` record is the
spec a live notebook can be rebuilt from on any Google account.

```bash
npm install @dreamteamer/notebooklm
npx dreamteamer compile
npx dreamteamer notebooklm --help      # export the workspace
npx dt-notebook restore <id>           # rebuild a NotebookLM notebook from its record
npx dt-notebook capture <id>           # write a record from a notebook that already exists
npx dt-notebook persona <id>           # apply NOTEBOOKLM.md's persona in one safe call
```

Add `notebooklm` to `dreamteamer.harnesses` in `package.json` for the harness. Syncing and the
three `dt-notebook` verbs need the `notebooklm` CLI and one login; rendering the sources locally and
writing the record need neither. Engine `>=0.31.0`.

| alone | with others |
|---|---|
| the export, the harness, `notebooks` records and the three verbs | **wikis** is the local corpus a notebook points at (`notebooks.wikis`), and `wiki pull` mirrors a live notebook's sources into one · **companies** lets a client corpus say whose it is |

**What never travels:** collections marked `sensitive: true`, fields marked `x-sensitive: true`, and
references to records that were withheld. Prose inside a record is not scanned; keep secrets out of it.

## what a descriptor cannot say

**`account` is a string, not a reference.** The workspace this was cut from types it as a reference
into an accounts collection; this package ships none, and the structure gate refuses a reference
nobody provides. The fact survives, as an address or a label; a workspace with an accounts collection
re-types the field in an overlay.

**The vendor skill is a dependency, and it is installed by the vendor.** `notebooklm skill install`
writes `~/.claude/skills/notebooklm/SKILL.md`; `using-notebooklm` here defers to it for every flag
and adds only this workspace's rules. Editing the vendor copy is how it drifts on the next upgrade.

**The record is a spec, and `chat` is write-only by nature.** `sources` and `chat` are what
`restore` plays against a fresh notebook; `capture` can fill `sources` from the live list but never
`chat`, because NotebookLM exposes no read of the persona and a bare `configure` CLEARS it (measured
2026-09-08, twice). So the persona lives on the record (or in `persona_file`) and flows one way. A
`file` source is a `${env:FILES_FOLDER}/…` template: the record never carries a machine path.

**Which adapter answers is DERIVED, not defaulted.** `notebooks.adapter` has no default: a record with
a `notebook_id` is served upstream, one without is served by its wikis. The field exists only to
override that, needed exactly once, when a notebook restored upstream should stop being answered
from there.

**Tests** run `tests/*.test.mjs` against the engine in the repo's devDependencies, or the checkout
`DT_ENGINE_DIR` names. No test reaches the real `notebooklm` CLI: every spawn runs with a PATH whose
only `notebooklm` is a stub.
