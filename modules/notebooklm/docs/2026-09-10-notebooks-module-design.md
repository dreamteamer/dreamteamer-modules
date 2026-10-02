# notebooks — the seventh module: a NotebookLM notebook as a record

**Status:** designed 2026-09-10, approved the same day; built against this document. Records the
decisions that are not visible in the tree.

**Since engine 0.31.0 (2026-09-30):** the exporter and the `notebooklm` harness left core. The verb is
`dt notebooklm` (no `export`), and both come from the `@dreamteamer/notebooklm` extension installed in
the workspace; `notebook restore` runs an `export` source as `npx dreamteamer notebooklm …`. The rest of
this document is as decided on the day, including where it calls them engine core.

## the ask

Port the dogfood vault's NotebookLM pieces — the `notebooks` collection, the `using-notebooklm`
skill and the persona-apply script — into this package as `modules/notebooks`, scrubbed, gated,
installable and cherry-pickable like the other six.

## where the source lives, and which copy is the base

Two copies exist upstream. `dreamteamer/recipes` carries a `notebooks` collection and a
`using-notebooklm` skill inside its `toolbelt` recipe — already scrubbed, but frozen at the
2026-08 shape: seven fields, three rules, `media/` as the download folder. The dogfood vault's copy
is newer by two rules and one trap, all measured on 2026-09-08: `configure` replaces the whole
configuration and `--mode` discards the persona; `ask` exits 0 with an empty answer when a broad
question is scoped with `-s`; `source add --title` keeps the file name instead. **The vault's copy is
the base**, and the scrub is done here, hunk by hunk, under the leak gate.

The persona script is the vault's `bin/apply-notebook-persona.mjs`. The exporter itself is NOT
here and never was a module concern: the vault decided on 2026-09-07 that `dt export notebooklm` is
an engine core verb, and engine 0.23.0 ships it together with the `notebooklm` harness that writes
`NOTEBOOKLM.md` on every compile. This module sits on top of both.

## three decisions the operator made

1. **`account` is a plain string, not a reference.** The vault types it `x-reference:
   services/accounts`; this package ships no services module, and the structure gate refuses a
   reference nobody provides. The FACT survives — a notebook is invisible from the wrong Google
   login, and nothing can derive which one — as a string holding an address or a label. A consumer
   with an accounts collection re-types it in an overlay. The alternatives — drop the field, or port
   a slice of `services` first — were declined: the first loses the one non-derivable fact the
   descriptor exists to hold, the second is a second module's design before the first ships.

2. **The persona script folds into `npx dt-extensions` as `notebook persona <id>`.** Not shipped
   under `modules/notebooks/bin/` as a standalone script (a second resolver, a second entry point),
   and not dropped in favour of `dt export --notebook` alone (the engine verb applies a persona from
   ITS template to the notebook IT exported; a notebook the operator built by hand, or wants
   `NOTEBOOKLM.md`'s hand-written additions applied to, has no path). ⚠ This is the CLI's first verb
   that writes over the network. `doctor` stays read-only by construction and `setup` stays
   in-workspace; `notebook persona` is the deliberate exception, and it is a narrow one: it writes
   ONE setting to ONE notebook the operator named on the command line, and it still never installs
   anything and never logs in. The CLI header says so in those words.

3. **The rest was routine and decided here:** `company` → `companies` as a declared peer (the way
   `contacts.recent_meeting` peers `meetings`); a module-scoped `notebooks-provenance` template (the
   self-containment rule — a template id is an identity entity); one default table view and no nav
   entries (the collection row IS the view); a `notebooks` capability in the doctor; no `/notebook`
   command (the skill tells the session how; a command needs the operator to remember it exists).

## the module

```
modules/notebooks/
  package.json                      title Notebooks · engine >=0.23.0 · peerDependencies [companies]
  README.md                         the account-is-a-string trade; the vendor-skill dependency
  collection-templates/
    notebooks-provenance.collection-template.yaml
  collections/
    notebooks.collection.yaml
  skills/using-notebooklm/SKILL.md
  ui-views/content-notebooks.ui-view.yaml
```

`engine >=0.23.0` is the floor because the module leans on that release's `notebooklm` harness
(`NOTEBOOKLM.md`) and `dt export notebooklm`. The package floor for bundle delivery stays 0.24.0
and is enforced by the doctor, as before.

### the descriptor

Ported field for field from the vault's, with these changes and no others:

| field | vault | here | why |
|---|---|---|---|
| `templates` | `collection-templates/provenance` | `collection-templates/notebooks-provenance` | self-containment |
| `account` | `x-reference: services/accounts` | `type: string` | decision 1 |
| `company` | `x-reference: companies` | unchanged; `companies` declared as a peer | the structure gate |
| `use_when` | "…is a `briefs` record; this is the handle" | "…is a document record elsewhere; this is the handle" | no `briefs` here |

Everything else — `name`, `notebook_id` (required), `description`, `status` enum
`active · archived · throwaway` with its reason, `tags` with the colon convention, `notes` as the
markdown body with its "never a source list or a count" warning, the slug id with no date prefix,
`icon: book`, `list_fields` — carries verbatim. The examples use the synthetic cast.

### the skill

The vault's `SKILL.md` as base, with these edits:

- **generic spelling** — `npx dreamteamer` for every CLI call; "this workspace" for "this vault";
  `.cache/notebooklm/` stays as the download folder, described as the materialised-remote-artifact
  convention without naming a sibling module's cache.
- **the lib setup, as measured 2026-09-10 on notebooklm-py 0.7.3** — installed as a `uv tool`
  (`uv tool install notebooklm-py`) OR `pip install "notebooklm-py[browser]"`; then `notebooklm skill
  install` writes the vendor skill (`~/.claude/skills/notebooklm/SKILL.md` and the Agent Skills copy);
  auth lives under **`~/.notebooklm/profiles/<profile>/storage_state.json`** (the vault's skill names
  the pre-0.7 top-level path, which is stale), `NOTEBOOKLM_HOME` selects a different home per account.
  Preflight stays `notebooklm auth check --test` — the bare check inspects cookie shape only.
- **rule 3 gains the engine verb** — `dt export notebooklm --create "<title>"` makes a notebook over
  the workspace and keeps the id in `.cache/dreamteamer/notebooklm/notebook.json`; it does NOT write
  a `notebooks` record, because core knows no such collection. The record is still yours to add, and
  the moment is the same: when the notebook exists.
- **rule 4 points at the CLI** — the persona lives in `NOTEBOOKLM.md` (written by compile when the
  workspace declares the `notebooklm` harness); `npx dt-extensions notebook persona <id>` applies it.
- **gone:** the deleted-and-restored history paragraph (vault history), the `briefs` and
  `transcribing-recordings` cross-references, the `npm run compile` remedy for a stale runtime (it is
  `npx dreamteamer compile` here, and it is in the engine's own skill).

### the view

`content-notebooks.ui-view.yaml`: `path: /content/notebooks`, `default: true`, table, columns
`name · account · status · tags · last-modified`, sorted by `-last-modified`. Every column is a
declared field or the engine's generated one, which is what `tests/view-columns.test.mjs` asserts.

## the CLI verb

```
npx dt-extensions notebook persona <notebook-id> [--print]
```

`bin/extensions.mjs` dispatches `notebook` to `bin/notebook.mjs`, the way `migrate` dispatches to
`migrate.mjs`, and its unknown-verb message lists the fourth verb. `bin/notebook.mjs` exports the
pure functions and runs `main` only as the entry point:

- `section(md, heading)` — the text between `## <heading>` and whichever comes first: the next
  `## `, or EITHER managed-block marker. ⚠ Both markers. The hand-written additions sit ABOVE the
  generated block, and a capture that stopped only at `## ` once ran through
  `<!-- dreamteamer:begin -->` and applied 1,000 characters of the block's own preamble to a notebook
  as instructions.
- `personaFrom(md)` — the generated `## custom instructions` section first, then the hand-written
  `## custom instructions — this workspace's additions` with its `⚠` lines and the `bin/apply…`
  pointer filtered out; throws, naming compile, when the generated section is absent.
- `main(args, root)` — reads `<root>/NOTEBOOKLM.md`. **Absent: exit 1** with the fix in words
  ("declare `notebooklm` in `dreamteamer.harnesses` in package.json, then `npx dreamteamer compile`").
  Over 10,000 characters: exit 1 naming the count. `--print`: writes the persona to stdout, exit 0,
  no subprocess. Otherwise ONE call — `notebooklm --quiet configure -n <id> --persona <text>
  --response-length longer --json`, **never `--mode`** — and exit 1 unless the echoed persona length
  equals what was sent.

The workspace root comes from `lib/capabilities.mjs`'s `findWorkspace`, which already skips a
candidate directly inside `git_modules/`; `tests/resolvers-skip-git-modules.test.mjs` will pin the
new file the moment it walks to a lockfile.

## the doctor

A `notebooks` capability in `lib/capabilities.mjs`, gated on `has('notebooks')`; `OURS` gains
`notebooks`. Every check is local — the doctor spends no network request, and each of these was
timed at ~0.15 s:

| check | how | state when missing | fix (prose) |
|---|---|---|---|
| `notebooklm` on PATH | `bin('notebooklm')` | bad | `uv tool install notebooklm-py` · or `pip install "notebooklm-py[browser]"` |
| version ≥ 0.7.3 | `notebooklm --version` | warn | `uv tool upgrade notebooklm-py` · or `pip install -U notebooklm-py`; then `notebooklm skill install` |
| signed in | `notebooklm auth check --json` (no `--test`) | warn | `notebooklm login` — opens a browser, a person runs it |
| vendor skill | `notebooklm skill status` | warn | `notebooklm skill install` |
| harness declared | `notebooklm` ∈ `dreamteamer.harnesses` | bad | add it, then `npx dreamteamer compile` — this is what makes `NOTEBOOKLM.md` exist |
| `.cache/` ignored | a line in `.gitignore` matching `.cache/` | warn | add `.cache/` to `.gitignore` — downloads land there |

`setup` offers the two in-workspace edits — the harness declaration and the `.gitignore` line — and
prints the rest. Both are listed under "what setup will do" before any question.

## tests — the assertion that proves each capability

- `tests/notebook-persona.test.mjs`
  - `section` stops at the next `## ` AND at `<!-- dreamteamer:begin`; a fixture with the additions
    above the block yields the additions alone.
  - `personaFrom` orders generated-then-additions, drops `⚠` lines and the `bin/apply` pointer,
    throws on a file with no `## custom instructions`.
  - `main` on a workspace without `NOTEBOOKLM.md` exits 1 and the message names `dreamteamer.harnesses`.
  - `main --print` on a fixture workspace exits 0 and prints exactly `personaFrom(fixture)`.
  - a 10,001-character persona exits 1 and the message carries the count.
  - the CLI's unknown-verb message names `notebook`.
- `tests/capabilities.test.mjs` — new cases on the existing fixture consumer:
  - `notebooks` found on `node_modules`; `OURS` lists seven.
  - harness undeclared → `harness declared` is `bad`; declared → `ok`.
  - `.gitignore` without `.cache/` → warn; with → ok.
  - the module disabled → no `notebooks` capability at all.
- the six package gates run as they are: `modules-structure` (peer `companies`, template inside the
  module, engine range), `compiles-alone` (`notebooks` alone — `perspective` already proves an
  x-reference to an absent peer compiles), `leak-gate`, `view-columns`, `resolvers-skip-git-modules`,
  `nav-order` (untouched: no nav entries).

What a fixture cannot pin, and is smoked by hand instead: the live `configure` call against a real
notebook in the dogfood vault, quoted with the echoed length. `npm test` is quoted by EXIT CODE.

## package changes

- README — a seventh row in "what you get"; the setup table gains "apply a notebook persona".
- CHANGELOG — **0.3.0**: a new module is a minor.
- `lib/capabilities.mjs` — `OURS`, the capability; `bin/extensions.mjs` — the verb, the header, the
  setup steps; `bin/notebook.mjs` — new.
- This document.

The version bump and the tag are NOT part of the build: the tag is the publish (RELEASING.md), and
it is pushed by a person after CI is green on the commit that shipped the module.

## not in scope, and why

- **A `/notebook` command.** Skill vs command: a command needs the operator to remember it; the
  skill triggers on the situation. Nothing here is a one-word job an operator would type.
- **`dt export` writing the `notebooks` record.** Core knows entity kinds and `repos` and nothing
  else, deliberately. The skill closes the gap in one line.
- **Changing the dogfood vault.** It keeps its own copies and does not consume this package. Its
  skill's stale auth path is a carry-back for a later hunk, not this one.
- **The other three sub-projects** the same conversation raised — the `rnd` module (which will drop
  `designing-stuff` now that `/design` exists), the meetings nav fold (which reopens the nav-axis
  decision in the extension), and one client workspace's visibility — each gets its own document.
